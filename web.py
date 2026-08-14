"""Opatrip product-audit dashboard — the DEPLOYED, read-only web copy.

This app can read and annotate the audit database. It cannot capture anything.

That is a property of what is in this file, not of a disabled button: the capture loop,
the browser driver, the profile handling and every endpoint that could start a run were
never copied here. `viator.py`, camoufox and playwright are not in requirements.txt. A
crafted request cannot reach them because they do not exist in this deployment.

Why it is built that way: the capture tool signs in to the Viator supplier portal with a
real staff account. Running that from a public server would put portal credentials and an
automated session on shared infrastructure, and the pacing that keeps it unnoticed is
tuned for one operator on one home connection. Captures stay on staff laptops.

What still works here: every report, filter and chart; the change history; manual field
edits with their audit trail; photo uploads; and images served from R2.
"""
import asyncio
import contextvars
import json
import os
import re
import time
from datetime import date
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import (FileResponse, HTMLResponse, JSONResponse,
                               RedirectResponse)
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import auth
import cloud
import config as C
import db
import store

app = FastAPI(title="Opatrip Product Audit")

STATIC_DIR = Path(__file__).resolve().parent / "public" / "static"

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
ALLOWED_IMAGE = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
                 "image/gif": ".gif"}
MAX_IMAGE_BYTES = 12 * 1024 * 1024
_REACH = {"at": 0.0, "val": None}

# Everything under public/ is served by Vercel's CDN and is NOT part of the function
# bundle: only the Python files are shipped to /var/task. An unguarded
# StaticFiles(directory=...) therefore raised at import and 500'd every route, including
# the ones that never touch a file. Vercel's own FastAPI guidance says the same thing —
# do not mount static directories; put the files in public/ and let the CDN serve them.
#
# The mount below exists purely for `uvicorn web:app` locally, where public/ IS on disk.
if STATIC_DIR.is_dir():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# The desktop tool sets this while it is uploading its local photo queue. Nothing here
# has a local queue — images arrive already in R2 — so it is permanently false.
FLUSHING = False


def log(msg):
    """Serverless has no log file; stdout is the platform's log stream."""
    print(f"[audit] {msg}", flush=True)


def _safe_local(_path):
    """There are no local image files on the server.

    The desktop tool serves a captured photo straight off the disk that captured it. Here
    the same rows exist but the files do not, so this always declines and the caller falls
    through to R2 and then the source CDN — the identical chain, minus a step that cannot
    apply. Returning None rather than deleting the branch keeps this file diff-able
    against app.py.
    """
    return None


@app.on_event("startup")
def _check_backend():
    """Fail loudly, at boot, if the database is not configured.

    Without this the storage layer would quietly fall back to a local SQLite file that
    does not exist on a serverless filesystem, and every page would render as an empty
    dashboard — which reads as data loss rather than as misconfiguration.
    """
    if not cloud.pg_available():
        log("FATAL: SUPABASE_DB_URL is not set — set it in the Vercel project settings")
    else:
        log(f"storage: {store.describe()}")


# ------------------------------------------------------------------------- models
class AccountIn(BaseModel):
    viator_account_id: str
    name: str | None = None
    country: str | None = None


class EditIn(BaseModel):
    """Every edit carries the editor's email — that is the whole point of the prompt in
    the UI. Without it we would have a changed value and no idea who changed it."""
    field: str
    value: str | None = None
    editor_email: str
    note: str | None = None


# ------------------------------------------------------- platforms, tours & reporting
class TaskIn(BaseModel):
    task_type: str
    employee_email: str
    quantity: float = 1
    tour_id: int | None = None
    product_id: int | None = None
    platform: str | None = None
    notes: str | None = None
    completed_at: str | None = None


# --------------------------------------------------------------------- who is asking
# Set by the gate below and read wherever a query needs narrowing. A ContextVar rather
# than a FastAPI dependency because the alternative is adding a parameter to all 33
# endpoints and remembering to do it on the 34th — the gate cannot be forgotten.
CURRENT_USER = contextvars.ContextVar("current_user", default=None)

# Everything a browser needs before anyone has signed in.
OPEN_PATHS = {"/api/auth/login", "/api/auth/config"}

# With no Supabase keys the app runs open, exactly as it did before auth existed, so a
# developer on a local SQLite copy still gets a working dashboard.
LOCAL_USER = {"id": None, "email": "", "name": "Local", "role": "admin", "scope": "all",
              "local": True}


@app.middleware("http")
async def gate(request: Request, call_next):
    """One place that decides whether a request is allowed. Static files and the shell are
    public; every /api/ route needs a session, and /api/admin/ needs an admin."""
    path = request.url.path
    if not auth.enabled():
        user = LOCAL_USER
    else:
        token = (request.headers.get("authorization") or "")
        token = token[7:].strip() if token[:7].lower() == "bearer " else ""
        user = auth.user_from_token(token)
        if path.startswith("/api/") and path not in OPEN_PATHS:
            if not user:
                return JSONResponse({"detail": "Please sign in to continue."},
                                    status_code=401)
            if path.startswith("/api/admin/") and user["role"] != "admin":
                return JSONResponse(
                    {"detail": "Only an administrator can do that."}, status_code=403)
    tok = CURRENT_USER.set(user)
    try:
        return await call_next(request)
    finally:
        CURRENT_USER.reset(tok)


def me():
    return CURRENT_USER.get() or LOCAL_USER


# Which accounts may the caller see? None means all of them. A "own" user sees the
# accounts they have actually captured — derived from syncs.operator_email rather than a
# list an admin has to maintain, so it stays true on its own.
_scope_cache = {}


def scope_accounts():
    u = me()
    if u.get("scope") == "all":
        return None
    email = (u.get("email") or "").strip().lower()
    if not email:
        return []
    hit = _scope_cache.get(email)
    if hit and hit[0] > time.time():
        return hit[1]
    with db.session() as con:
        rows = [r[0] for r in con.execute(
            """SELECT DISTINCT a.viator_account_id
               FROM syncs s JOIN accounts a ON a.id=s.account_id
               WHERE lower(s.operator_email)=?""", (email,))]
    _scope_cache[email] = (time.time() + 60, rows)
    return rows


def account_where(account=None, alias="a"):
    """The WHERE clause every data endpoint shares: the account the user picked, AND the
    accounts they are allowed to see at all. Returns ('', []) when nothing constrains it,
    so callers can keep appending ' AND ...' the way they always did."""
    conds, args = [], []
    if account:
        conds.append(f"{alias}.viator_account_id=?")
        args.append(account)
    allowed = scope_accounts()
    if allowed is not None:
        if not allowed:
            conds.append("1=0")          # scoped user who has captured nothing yet
        else:
            conds.append(f"{alias}.viator_account_id IN "
                         f"({','.join('?' * len(allowed))})")
            args += allowed
    return (("WHERE " + " AND ".join(conds)) if conds else "", args)


def may_see_account(acct_id):
    allowed = scope_accounts()
    return allowed is None or acct_id in allowed


def LIMIT_Q(default):
    """A row cap that FastAPI validates before it reaches SQL.

    `limit: int = 300` accepted anything an int could hold and handed it straight to
    `LIMIT ?`. Postgres then raised on a negative value and on one too large for a
    bigint — a 500 from a query string, on three endpoints. `ge/le` turns both into a
    422 with a message, and the cap also stops a single request asking for every row.
    """
    return Query(default, ge=0, le=5000)


def _day(v, name):
    """since/until come from a free-text box in the reports filter, and were passed
    straight into a SQL date cast — one typo 500'd the whole page. Validate at the
    boundary instead, so a bad date is a message the user can act on."""
    if not v or not v.strip():
        return None
    try:
        from datetime import date
        return date.fromisoformat(v.strip()).isoformat()
    except ValueError:
        raise HTTPException(400, f"{name} must be a date like 2026-01-31, not {v!r}")


def conn_state(meta, product=None):
    """Connected / Partially connected / Not connected.

    Option counts only exist on roster entries that carried list detail (20 per page), so
    fall back to the product's own connectionDetails and the roster sync flag — otherwise
    most products showed no connection badge at all.
    """
    c, t = meta.get("connected"), meta.get("options")
    if product:
        c = product.get("connectedOptionCount", c)
        t = product.get("totalActiveOptionCount", t)
    if c is not None and t is not None:
        if c == 0:
            return "Not connected"
        return "Connected" if c >= t else "Partially connected"
    if product:
        cd = product.get("connectionDetails") or {}
        if cd.get("supplierProductCode"):
            return "Connected"
        if cd:
            return "Not connected"
    if meta.get("synced") is not None:
        return "Connected" if meta["synced"] else "Not connected"
    return None


def pending_images(con):
    return con.execute("""SELECT COUNT(*) FROM product_images
                          WHERE r2_key IS NULL AND local_path IS NOT NULL""").fetchone()[0]


@app.get("/favicon.svg", include_in_schema=False)
def favicon():
    """On Vercel the CDN serves this straight from public/ and never reaches the function.
    This route exists so `uvicorn web:app` locally shows the same icon rather than a blank
    tab that looks like a missing file."""
    p = STATIC_DIR.parent / "favicon.svg"
    if not p.is_file():
        raise HTTPException(404, "served by the CDN from public/")
    return FileResponse(p, media_type="image/svg+xml")


@app.get("/", response_class=HTMLResponse)
def index():
    """Only ever reached locally.

    On Vercel `public/index.html` is a static file, so the CDN answers "/" before the
    catch-all rewrite sends anything to this function — which is what we want, because
    the HTML is not in the function bundle to read.
    """
    p = STATIC_DIR.parent / "index.html"
    if not p.is_file():
        raise HTTPException(404, "the dashboard shell is served by the CDN from public/")
    return HTMLResponse(p.read_text(encoding="utf-8"))








# ----------------------------------------------------------------------- accounts
# ------------------------------------------------------------------- sign in / users
class LoginIn(BaseModel):
    email: str
    password: str


class UserIn(BaseModel):
    email: str | None = None
    password: str | None = None
    name: str | None = None
    role: str | None = None
    scope: str | None = None


@app.get("/api/auth/config")
def auth_config():
    """Does this server require a sign-in? Asked before the login screen is drawn."""
    return {"required": auth.enabled()}


@app.post("/api/auth/login")
def auth_login(i: LoginIn):
    try:
        return auth.sign_in(i.email, i.password)
    except auth.AuthError as e:
        # Deliberately vague: saying "no such user" tells an attacker which emails exist.
        raise HTTPException(401, str(e) or "That email and password don't match.")


@app.get("/api/auth/me")
def auth_me():
    return {"user": me()}


@app.post("/api/auth/logout")
def auth_logout(request: Request):
    token = (request.headers.get("authorization") or "")
    auth.forget(token[7:].strip() if token[:7].lower() == "bearer " else "")
    return {"ok": True}


# Names, so the edit history can say "Maniha Hussain" instead of "maniha@opatrip.com".
# Available to anyone signed in — it is only what people are called, no roles and no
# permissions — and cached, because it is read on every dashboard load.
_people = {"at": 0.0, "names": {}}


@app.get("/api/people")
def people():
    if not auth.enabled():
        return {"names": {}}
    if time.time() - _people["at"] > 120:
        try:
            _people["names"] = {u["email"].lower(): u["name"] for u in auth.list_users()
                                if u.get("email")}
            _people["at"] = time.time()
        except auth.AuthError:
            pass                    # keep whatever we had; a name is not worth a 500
    return {"names": _people["names"]}


@app.get("/api/admin/users")
def admin_users():
    return {"users": auth.list_users(), "me": me()}


@app.post("/api/admin/users")
def admin_create_user(u: UserIn):
    try:
        user = auth.create_user(u.email or "", u.password or "", u.name or "",
                                u.role or "member", u.scope or "own")
    except auth.AuthError as e:
        raise HTTPException(400, str(e))
    log(f"{me()['email']} created the user {user['email']} ({user['role']})")
    return {"user": user}


@app.patch("/api/admin/users/{user_id}")
def admin_update_user(user_id: str, u: UserIn):
    # An admin who removes their own admin rights locks everyone out of user management,
    # because only an admin can grant it back.
    if user_id == me().get("id") and u.role and u.role != "admin":
        raise HTTPException(400, "You can't remove your own administrator rights — ask "
                                 "another administrator to do it.")
    try:
        user = auth.update_user(user_id, name=u.name, role=u.role, scope=u.scope,
                                password=u.password)
    except auth.AuthError as e:
        raise HTTPException(400, str(e))
    log(f"{me()['email']} updated the user {user['email']}")
    return {"user": user}


@app.delete("/api/admin/users/{user_id}")
def admin_delete_user(user_id: str):
    if user_id == me().get("id"):
        raise HTTPException(400, "You can't delete your own account while signed in.")
    users = auth.list_users()
    victim = next((x for x in users if x["id"] == user_id), None)
    if victim and victim["role"] == "admin" \
            and sum(1 for x in users if x["role"] == "admin") <= 1:
        raise HTTPException(400, "That's the only administrator — make someone else an "
                                 "administrator first.")
    try:
        auth.delete_user(user_id)
    except auth.AuthError as e:
        raise HTTPException(400, str(e))
    log(f"{me()['email']} deleted the user {(victim or {}).get('email', user_id)}")
    return {"ok": True}


@app.get("/api/accounts")
def accounts():
    # One query, not one-per-account: the old version ran a COUNT per row inside a Python
    # loop, so 25 accounts meant 25 network round trips (~7s against Supabase).
    with db.session() as con:
        rows = [dict(r) for r in con.execute("""
            SELECT a.*,
              (SELECT COUNT(*) FROM products p WHERE p.account_id=a.id) AS product_count,
              (SELECT COUNT(*) FROM changes c WHERE c.account_id=a.id) AS change_count,
              (SELECT COUNT(*) FROM products p WHERE p.account_id=a.id
                 AND p.missing_since IS NOT NULL) AS missing_count,
              (SELECT COUNT(*) FROM products p WHERE p.account_id=a.id
                 AND p.is_draft_stub=1) AS draft_count,
              -- one row per account with its whole lifecycle split, so the Accounts tab
              -- can answer "how is this account doing" without a query per status
              (SELECT COUNT(*) FROM products p WHERE p.account_id=a.id
                 AND p.status_canonical='LIVE') AS live_count,
              (SELECT COUNT(*) FROM products p WHERE p.account_id=a.id
                 AND p.status_canonical='PENDING') AS pending_count,
              (SELECT COUNT(*) FROM products p WHERE p.account_id=a.id
                 AND p.status_canonical='REJECTED') AS rejected_count,
              (SELECT COUNT(*) FROM products p WHERE p.account_id=a.id
                 AND p.status_canonical='REMOVED') AS removed_count,
              (SELECT COUNT(*) FROM products p WHERE p.account_id=a.id
                 AND p.review_count=0) AS no_review_count,
              (SELECT COUNT(*) FROM product_images i JOIN products p ON p.id=i.product_id
                 WHERE p.account_id=a.id) AS image_count
            FROM accounts a ORDER BY a.name IS NULL, a.name""")]
    # A member scoped to their own work must not even see that other accounts exist —
    # the account dropdown is built from this list.
    allowed = scope_accounts()
    if allowed is not None:
        rows = [r for r in rows if r["viator_account_id"] in allowed]
    for r in rows:
        # no browser is ever open on the server — captures run on staff laptops
        r["browser_open"] = False
        # distinguish "never synced" from "synced and genuinely has no products"
        r["synced"] = bool(r["last_sync_at"])
    return {"accounts": rows}


@app.post("/api/accounts")
def add_account(a: AccountIn):
    acct_id = a.viator_account_id.strip()
    if not acct_id:
        raise HTTPException(400, "viator_account_id required")
    with db.session() as con:
        # no profile_dir: a profile is a browser identity, and this app has no browser.
        # The desktop tool fills it in the first time it signs this account in.
        row = db.upsert_account(con, acct_id, a.name, a.country)
    log(f"account added/updated: {acct_id}")
    return dict(row)


# ---------------------------------------------------------------------- dashboard
@app.get("/api/stats")
def stats(account: str | None = None):
    with db.session() as con:
        where, args = account_where(account)
        # A missing value has two very different meanings, and lumping both under
        # "Unknown" made a deliberate design decision look like a data fault.
        #   * on a DRAFT it means "not captured": the client's rule is that drafts are
        #     recorded from the roster and never deep-fetched, and the roster carries no
        #     location at all (that comes from the accelerate page) and option counts for
        #     only some entries. 45% of drafts have no location for exactly that reason.
        #   * on anything else it really is unknown — Viator itself had no value. That is
        #     2 products out of 743.
        # Splitting the bucket makes the chart answer "why is this blank?" on its own.
        by = lambda col: {r[0]: r[1] for r in con.execute(
            f"""SELECT {db.blank_bucket(col)}, COUNT(*) FROM products p
                JOIN accounts a ON a.id=p.account_id {where}
                GROUP BY 1 ORDER BY 2 DESC""", args)}
        totals = con.execute(
            f"""SELECT COUNT(*) n, SUM(p.is_draft_stub) drafts FROM products p
                JOIN accounts a ON a.id=p.account_id {where}""", args).fetchone()
        changes = [dict(r) for r in con.execute(
            f"""SELECT substr(c.detected_at,1,10) d, COUNT(*) n FROM changes c
                JOIN accounts a ON a.id=c.account_id {where}
                GROUP BY 1 ORDER BY 1 DESC LIMIT 30""", args)]
        acc_n = con.execute("SELECT COUNT(*) FROM accounts").fetchone()[0]
        img_n = con.execute(
            f"""SELECT COUNT(*) FROM product_images i JOIN products p ON p.id=i.product_id
                JOIN accounts a ON a.id=p.account_id {where}""", args).fetchone()[0]
        return {"by_status": by("status"), "by_connection": by("connection_state"),
                "by_quality": by("quality_level"), "by_location": by("location"),
                "total_products": totals["n"] or 0, "drafts": totals["drafts"] or 0,
                "accounts": acc_n, "images": img_n, "changes_by_day": changes}


@app.get("/api/overview")
def overview(account: str | None = None):
    """Everything the landing dashboard needs, computed from real rows.

    Deltas are period-over-period against actual timestamps (first_seen_at,
    detected_at) — never invented. Where a comparison isn't computable the delta comes
    back as None and the UI omits the chip rather than showing a made-up number.
    """
    where, args = account_where(account)

    # ONE connection for the whole endpoint. Each helper used to open its own session, so
    # this handler alone made ~15 separate round trips to Supabase (~11s). Reusing the
    # connection also means every figure below comes from a single consistent read.
    _con = {"c": None}

    def one(sql, a=None):
        r = _con["c"].execute(sql, a or []).fetchone()
        return (r[0] if r else 0) or 0

    def rows(sql, a=None):
        return [dict(r) for r in _con["c"].execute(sql, a or [])]

    P = f"FROM products p JOIN accounts a ON a.id=p.account_id {where}"
    C_ = f"FROM changes c JOIN accounts a ON a.id=c.account_id {where}"

    with db.session() as con:
      _con["c"] = con
      # store.days_since(): SQLite has julianday(), Postgres does interval arithmetic
      ago_seen = store.days_since("p.first_seen_at")
      ago_chg = store.days_since("c.detected_at")
      AND = "AND" if where else "WHERE"
      # syncs/tours were counted across ALL accounts while every other figure on the
      # card respected the filter, so a filtered dashboard mixed the two scopes.
      swhere = where
      swhere_done = (f"{where} AND s.status='done'" if where
                     else "WHERE s.status='done'")
      # All ten counters in ONE round trip. Run separately they were ten sequential
      # queries against a database in another region — ~2.5s of pure latency for values
      # the server can compute in a single pass. new30/prev30 are a real period-over-period
      # comparison, so the deltas stay honest rather than invented.
      counts = _con["c"].execute(f"""
          SELECT (SELECT COUNT(*) {P}) AS total_products,
                 (SELECT COUNT(*) {P} {AND} p.is_draft_stub=1) AS drafts,
                 (SELECT COUNT(*) {P} {AND} p.missing_since IS NOT NULL) AS missing,
                 (SELECT COUNT(*) FROM product_images i
                    JOIN products p ON p.id=i.product_id
                    JOIN accounts a ON a.id=p.account_id {where}) AS photos,
                 (SELECT COUNT(*) {P} {AND} substr(p.first_seen_at,1,7)=?)
                   AS added_month,
                 (SELECT COUNT(*) {P} {AND} {ago_seen} <= 30) AS new30,
                 (SELECT COUNT(*) {P} {AND} {ago_seen} BETWEEN 30 AND 60) AS prev30,
                 (SELECT COUNT(*) {C_} {AND} {ago_chg} <= 7) AS ch7,
                 (SELECT COUNT(*) {C_} {AND} {ago_chg} BETWEEN 7 AND 14) AS chprev7,
                 (SELECT COUNT(*) FROM syncs s JOIN accounts a ON a.id=s.account_id
                    {swhere_done}) AS syncs_done,
                 (SELECT COUNT(*) FROM syncs s JOIN accounts a ON a.id=s.account_id
                    {swhere}) AS syncs_all,
                 (SELECT COUNT(DISTINCT t.id) FROM tours t
                    JOIN products p ON p.tour_id=t.id
                    JOIN accounts a ON a.id=p.account_id {where}) AS tours_total
      """,
          # Positional params must follow the ? order above: five account filters, then
          # the month for added_month, then the remaining seven account filters.
          args * 5 + [db.now()[:7]] + args * 7).fetchone()
      total_products = counts["total_products"] or 0
      drafts = counts["drafts"] or 0
      missing = counts["missing"] or 0
      photos = counts["photos"] or 0
      new30, prev30 = counts["new30"] or 0, counts["prev30"] or 0
      ch7, chprev7 = counts["ch7"] or 0, counts["chprev7"] or 0
      syncs_done, syncs_all = counts["syncs_done"] or 0, counts["syncs_all"] or 0
      tours_total = counts["tours_total"] or 0

      def pct(now_v, prev_v):
          if not prev_v:
              return None            # no baseline -> no percentage, not "100%"
          return round((now_v - prev_v) / prev_v * 100, 1)

      if True:
        # SAME bucketing as /api/stats — see db.blank_bucket(). This one still said
        # 'Unknown', so the Dashboard and the Breakdown page disagreed about the same rows.
        # All four distributions in ONE round trip. They were four separate queries, and
        # against a database ~175-360 ms away four trips is most of a second spent waiting
        # rather than computing. Sorting moved to Python for the same reason it always
        # should here: it costs nothing locally and keeps the SQL dialect-free.
        DISTS = [("status", "status_canonical"), ("connection", "connection_state"),
                 ("quality", "quality_level"), ("location", "location")]
        raw = {}
        for r in con.execute(" UNION ALL ".join(
                f"SELECT '{k}' AS k, {db.blank_bucket(col)} AS v, COUNT(*) AS n {P}"
                f" GROUP BY 1, 2" for k, col in DISTS), args * len(DISTS)):
            raw.setdefault(r[0], {})[r[1]] = r[2]
        srt = lambda d: dict(sorted(d.items(), key=lambda kv: -kv[1]))
        dist = {k: srt(raw.get(k, {})) for k, _col in DISTS}
        dist["location"] = dict(list(dist["location"].items())[:8])
        plats, tours = db.platform_matrix(con, account)
        cover = []
        for p in plats:
            c = {"LIVE": 0, "PENDING": 0, "DRAFT": 0, "REJECTED": 0, "REMOVED": 0,
                 "NOT_LISTED": 0}
            for t in tours:
                c[t["platforms"].get(p["id"], {}).get("status", "NOT_LISTED")] = \
                    c.get(t["platforms"].get(p["id"], {}).get("status", "NOT_LISTED"), 0) + 1
            cover.append({"code": p["code"], "name": p["name"],
                          "capturable": p["capturable"], **c})
        series_changes = rows(f"""SELECT substr(c.detected_at,1,10) d, COUNT(*) n {C_}
                                  GROUP BY 1 ORDER BY 1 DESC LIMIT 14""", args)
        series_added = rows(f"""SELECT substr(p.first_seen_at,1,10) d, COUNT(*) n {P}
                                GROUP BY 1 ORDER BY 1 DESC LIMIT 14""", args)
        # Written out rather than reusing C_: that fragment already ENDS with the WHERE
        # clause, so appending a JOIN after it produced "WHERE ... JOIN ..." — a syntax
        # error that 500'd the whole dashboard the moment an account filter was applied.
        # The "Latest changes" and "Recent sync runs" feeds were removed from the dashboard
        # long ago; the queries behind them stayed, costing two round trips per load for
        # data nothing rendered. Change history and Sync runs have their own tabs.

    return {
        "kpis": {
            "products": {"value": total_products, "delta": pct(new30, prev30),
                         "sub": f"{new30} added in 30 days"},
            "tours": {"value": tours_total, "delta": None,
                      "sub": ("in this account" if account else "across all platforms")},
            "photos": {"value": photos, "delta": None, "sub": "downloaded locally"},
            "changes": {"value": ch7, "delta": pct(ch7, chprev7),
                        "sub": "detected this week"},
            "added_month": {"value": counts["added_month"] or 0, "delta": None,
                            "sub": "new products captured in " + db.now()[:7]},
            "drafts": {"value": drafts, "delta": None, "sub": "recorded, not fetched"},
            "removed": {"value": missing, "delta": None, "sub": "gone from the roster"},
            "sync_rate": {"value": round(syncs_done / syncs_all * 100) if syncs_all else 0,
                          "delta": None, "suffix": "%",
                          "sub": f"{syncs_done} of {syncs_all} runs completed"},
        },
        "dist": dist, "coverage": cover,
        "series": {"changes": list(reversed(series_changes)),
                   "added": list(reversed(series_added))},
    }


# Review bands, as one definition. The UI needs the labels for its dropdown and the API
# needs the SQL; keeping them apart is how a filter ends up meaning something different
# from the option that selects it.
REVIEW_BANDS = {
    "0":     ("No reviews yet",   "p.review_count = 0"),
    "1":     ("Exactly 1 review", "p.review_count = 1"),
    "2-5":   ("2 to 5 reviews",   "p.review_count BETWEEN 2 AND 5"),
    "6-20":  ("6 to 20 reviews",  "p.review_count BETWEEN 6 AND 20"),
    "21+":   ("21 or more",       "p.review_count >= 21"),
    "any":   ("Has at least one", "p.review_count > 0"),
    "none":  ("Not captured",     "p.review_count IS NULL"),
}


@app.get("/api/review-bands")
def review_bands():
    """So the dropdown and the query can never drift apart."""
    return {"bands": [{"key": k, "label": v[0]} for k, v in REVIEW_BANDS.items()]}


@app.get("/api/filters")
def filter_options(account: str | None = None):
    """Everything the product filter bar needs, in one call.

    The months come from the data rather than a generated range, so the dropdown can
    only ever offer a month that has products in it — an empty option that returns
    nothing is a small betrayal of trust in the filter.
    """
    where, args = account_where(account)
    with db.session() as con:
        # the COUNT matters: with products captured in only two months, a two-option
        # dropdown looks broken until each option says how many it holds
        months = [{"month": r[0], "n": r[1]} for r in con.execute(
            f"""SELECT substr(p.first_seen_at,1,7) m, COUNT(*) n FROM products p
                JOIN accounts a ON a.id=p.account_id {where}
                {'AND' if where else 'WHERE'} p.first_seen_at IS NOT NULL
                GROUP BY 1 ORDER BY 1 DESC""", args)]
        plats = [dict(r) for r in con.execute(
            """SELECT code, name FROM platforms ORDER BY sort_order""")]
        lifecycle = [dict(r) for r in con.execute(
            """SELECT code, label FROM statuses ORDER BY sort_order""")]
    return {"platforms": plats, "months": months, "lifecycle": lifecycle,
            "reviews": [{"key": k, "label": v[0]} for k, v in REVIEW_BANDS.items()
                        if k not in ("none",)]}


@app.get("/api/progress")
def progress(account: str | None = None, months: int = 6):
    """Month-over-month movement, reconstructed rather than guessed.

    Two different questions get two different answers, because the data supports them
    differently:

      * "how many products existed, and in what state, at the end of month M" is
        RECONSTRUCTED: start from today's status and walk the recorded status changes
        backwards. A product whose status changed after month M is counted under the
        status it had *then* (the change row's old value), not the one it has now. With
        no status changes recorded the reconstruction correctly reduces to today's
        status, and it stays correct as changes accumulate.
      * "how many were ADDED in month M" comes straight from first_seen_at.

    Never inferred: a status from before the product's first capture. A product's history
    begins when this tool first saw it, and the response says so rather than drawing a
    line back to zero that would read as growth that never happened.
    """
    where, args = account_where(account)
    with db.session() as con:
        prods = [dict(r) for r in con.execute(
            f"""SELECT p.id, p.status_canonical, p.first_seen_at,
                       a.viator_account_id AS acct, a.name AS acct_name
                FROM products p JOIN accounts a ON a.id=p.account_id {where}""", args)]
        raw2canon = {r["raw"]: r["canonical"]
                     for r in con.execute("SELECT raw, canonical FROM status_map")}
        chg = [dict(r) for r in con.execute(
            f"""SELECT c.product_id, c.old_value, c.detected_at
                FROM changes c JOIN accounts a ON a.id=c.account_id
                {where} {'AND' if where else 'WHERE'}
                (c.field_path LIKE '%status' OR c.field_path LIKE '%status_canonical')
                ORDER BY c.detected_at""", args)]

    by_prod = {}
    for c in chg:
        by_prod.setdefault(c["product_id"], []).append(c)

    now = db.now()
    y, m = int(now[:4]), int(now[5:7])
    keys = []
    for _ in range(max(1, min(months, 24))):
        keys.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    keys.reverse()

    ORDER = ["LIVE", "PENDING", "DRAFT", "REJECTED", "REMOVED"]

    def status_at(p, end):
        """Its status at the END of month `end`: the old value of the first change
        recorded after that point, or today's status if nothing has moved since."""
        for c in by_prod.get(p["id"], []):
            if (c["detected_at"] or "")[:7] > end:
                return raw2canon.get(c["old_value"], c["old_value"])
        return p["status_canonical"]

    series = []
    for k in keys:
        existed = [p for p in prods if (p["first_seen_at"] or "")[:7] <= k]
        counts = {s: 0 for s in ORDER}
        for p in existed:
            st = status_at(p, k)
            if st in counts:
                counts[st] += 1
        series.append({"month": k, "total": len(existed),
                       "added": sum(1 for p in prods
                                    if (p["first_seen_at"] or "")[:7] == k),
                       **counts})

    cur = series[-1]
    prev = series[-2] if len(series) > 1 else None

    def delta(field):
        if not prev:
            return None
        a, b = cur.get(field, 0), prev.get(field, 0)
        return {"now": a, "was": b, "diff": a - b,
                "pct": round((a - b) / b * 100, 1) if b else None}

    per_acct = {}
    for p in prods:
        e = per_acct.setdefault(p["acct"], {"account": p["acct"], "name": p["acct_name"],
                                            "total": 0, "this_month": 0, "last_month": 0})
        e["total"] += 1
        fs = (p["first_seen_at"] or "")[:7]
        if fs == keys[-1]:
            e["this_month"] += 1
        elif len(keys) > 1 and fs == keys[-2]:
            e["last_month"] += 1
    growth = sorted(per_acct.values(),
                    key=lambda x: (-x["this_month"], -x["total"]))[:12]

    # The review bands (one COUNT per band, five round trips) and the monthly change
    # series were computed here for cards that have since been removed from the dashboard.
    # Nothing read them, and a second db.session() was opened to produce them. The bands
    # themselves still exist as REVIEW_BANDS, which is what the Products filter uses.

    return {
        "series": series,
        "current": cur, "previous": prev,
        "deltas": {f: delta(f) for f in ("total", "added", *ORDER)},
        "growth": growth,
        "history_note": (
            "A product's history starts when this tool first captured it, so nothing is "
            "drawn before that. Earlier months are reconstructed from recorded status "
            "changes"
            + (f" ({len(chg)} recorded)." if chg else
               " — none recorded yet, so earlier months show each product's current "
               "status.")),
    }


@app.get("/api/products")
def products(account: str | None = None, q: str | None = None,
             status: str | None = None, connection: str | None = None,
             platform: str | None = None, lifecycle: str | None = None,
             reviews: str | None = None, missing: str | None = None,
             month: str | None = None):
    sql = """SELECT p.*, a.viator_account_id, a.name AS account_name,
               pl.code AS platform_code, pl.name AS platform_name,
               (SELECT COUNT(*) FROM product_images i WHERE i.product_id=p.id) AS image_count,
               (SELECT COUNT(*) FROM changes c WHERE c.product_id=p.id) AS change_count
             FROM products p
             JOIN accounts a ON a.id=p.account_id
             LEFT JOIN platforms pl ON pl.id=p.platform_id
             WHERE 1=1"""
    args = []
    if account:
        sql += " AND a.viator_account_id=?"
        args.append(account)
    # the accounts this user may see at all, whatever they asked for
    allowed = scope_accounts()
    if allowed is not None:
        sql += (f" AND a.viator_account_id IN ({','.join('?' * len(allowed))})"
                if allowed else " AND 1=0")
        args += allowed
    if q:
        sql += " AND (p.title LIKE ? OR p.product_code LIKE ?)"
        args += [f"%{q}%", f"%{q}%"]
    if status:
        sql += " AND p.status=?"
        args.append(status)
    # lifecycle is the CANONICAL status (LIVE/DRAFT/...) — the same word the dashboard
    # cards and the donut use. `status` above is the platform's own raw word, kept so an
    # existing link with ?status=ACTIVE still works.
    if lifecycle:
        sql += " AND p.status_canonical=?"
        args.append(lifecycle)
    if platform:
        sql += " AND pl.code=?"
        args.append(platform)
    if connection:
        sql += " AND p.connection_state=?"
        args.append(connection)
    if month:
        # matched as a string against the stored ISO timestamp — no date parsing, and it
        # cannot inject: the value only ever reaches SQL as a bound parameter
        sql += " AND substr(p.first_seen_at,1,7)=?"
        args.append(month)
    if missing:
        sql += " AND p.missing_since IS NOT NULL"
    if reviews:
        band = REVIEW_BANDS.get(reviews)
        if not band:
            raise HTTPException(400, f"unknown review band {reviews!r}; "
                                     f"expected one of {sorted(REVIEW_BANDS)}")
        sql += f" AND {band[1]}"          # from the table above, never from the request
    sql += " ORDER BY p.product_code"
    with db.session() as con:
        rows = [dict(r) for r in con.execute(sql, args)]
        # Which platforms this product's tour is listed on. The Platforms grid was removed
        # from the UI at the client's request, so the fact it existed to show now travels
        # on the product row itself. One unfiltered query (~1.1k rows) beats an IN list
        # rebuilt per request, and the tour may well be listed under another account.
        by_tour = {}
        for r in con.execute("""SELECT p.tour_id AS t, pl.name AS nm FROM products p
                                JOIN platforms pl ON pl.id=p.platform_id
                                WHERE p.tour_id IS NOT NULL"""):
            by_tour.setdefault(r["t"], set()).add(r["nm"])
        for r in rows:
            r["tour_platforms"] = sorted(by_tour.get(r.get("tour_id")) or [])
        # manual overrides win for display, and carry who made them
        db.apply_edits(con, rows)
    return {"products": rows}


@app.get("/api/product/{pid}")
def product_detail(pid: int):
    with db.session() as con:
        p = con.execute("""SELECT p.*, a.viator_account_id, a.name AS account_name
                           FROM products p JOIN accounts a ON a.id=p.account_id
                           WHERE p.id=?""", (pid,)).fetchone()
        # 404 rather than 403 when it belongs to an account this user can't see: telling
        # them it exists but is forbidden is itself information.
        if not p or not may_see_account(p["viator_account_id"]):
            raise HTTPException(404, "no such product")
        prow = dict(p)
        db.apply_edits(con, [prow])
        cur_edits, edit_hist = db.edits_for(con, pid)
        # last_confirmed_at / confirmations: a snapshot is only written when the content
        # changed, so these say "and we checked again on these later runs and it was
        # identical" — otherwise an unchanged product would look uncaptured.
        snaps = [dict(r) for r in con.execute(
            """SELECT id, sync_id, captured_at, last_confirmed_at, confirmations
               FROM snapshots WHERE product_id=? ORDER BY id DESC""", (pid,))]
        cur = con.execute("""SELECT normalized_json FROM snapshots WHERE product_id=?
                             ORDER BY id DESC LIMIT 1""", (pid,)).fetchone()
        imgs = [dict(r) for r in con.execute(
            """SELECT * FROM product_images WHERE product_id=? ORDER BY position""", (pid,))]
        ch = [dict(r) for r in con.execute(
            """SELECT c.*, s.operator_email AS sync_operator FROM changes c
               LEFT JOIN syncs s ON s.id=c.sync_id
               WHERE c.product_id=? ORDER BY c.id DESC LIMIT 500""", (pid,))]
    return {"product": prow, "edits": cur_edits, "edit_history": edit_hist,
            "editable": db.EDITABLE_META,
            "snapshots": snaps, "images": imgs, "changes": ch,
            # `or "{}"` matches /api/snapshot: a snapshot row with a NULL payload would
            # otherwise make json.loads raise and 500 the whole product page.
            "current": json.loads(cur["normalized_json"] or "{}") if cur else None}


@app.get("/api/editable")
def editable():
    return {"fields": db.EDITABLE_META}


def guard_product(con, pid):
    """404 unless the caller may see the account this product belongs to. Used by every
    route addressed by a product id rather than by an account filter."""
    if scope_accounts() is None:
        return
    r = con.execute("""SELECT a.viator_account_id FROM products p
                       JOIN accounts a ON a.id=p.account_id WHERE p.id=?""",
                    (pid,)).fetchone()
    if not r or not may_see_account(r[0]):
        raise HTTPException(404, "no such product")


@app.get("/api/product/{pid}/edits")
def product_edits(pid: int):
    with db.session() as con:
        guard_product(con, pid)
        cur, hist = db.edits_for(con, pid)
    return {"current": cur, "history": hist}


@app.get("/api/edits")
def all_edits(limit: int = LIMIT_Q(200)):
    """Every manual edit, newest first — the traceability view for edits, mirroring what
    /api/audit does for portal-detected changes."""
    with db.session() as con:
        return {"edits": [dict(r) for r in con.execute(
            """SELECT e.*, p.product_code, p.title AS product_title,
                      a.viator_account_id
               FROM product_edits e
               JOIN products p ON p.id=e.product_id
               JOIN accounts a ON a.id=p.account_id
               ORDER BY e.id DESC LIMIT ?""", (limit,))]}


@app.get("/api/snapshot/{sid}")
def snapshot(sid: int):
    with db.session() as con:
        r = con.execute("SELECT * FROM snapshots WHERE id=?", (sid,)).fetchone()
        if r:
            guard_product(con, r["product_id"])
    if not r:
        raise HTTPException(404, "no such snapshot")
    return {"captured_at": r["captured_at"], "sync_id": r["sync_id"],
            "normalized": json.loads(r["normalized_json"] or "{}")}


@app.get("/api/audit")
def audit(account: str | None = None, limit: int = LIMIT_Q(300)):
    sql = """SELECT c.*, p.product_code, p.title, a.viator_account_id, a.name AS account_name
             FROM changes c JOIN products p ON p.id=c.product_id
             JOIN accounts a ON a.id=c.account_id WHERE 1=1"""
    args = []
    if account:
        sql += " AND a.viator_account_id=?"
        args.append(account)
    allowed = scope_accounts()
    if allowed is not None:
        sql += (f" AND a.viator_account_id IN ({','.join('?' * len(allowed))})"
                if allowed else " AND 1=0")
        args += allowed
    sql += " ORDER BY c.id DESC LIMIT ?"
    args.append(limit)
    with db.session() as con:
        return {"changes": [dict(r) for r in con.execute(sql, args)]}


@app.get("/api/platforms")
def platforms():
    with db.session() as con:
        plats = [dict(r) for r in con.execute(
            """SELECT p.*, (SELECT COUNT(*) FROM products x WHERE x.platform_id=p.id)
               AS listings FROM platforms p ORDER BY sort_order""")]
        stats = [dict(r) for r in con.execute(
            "SELECT * FROM statuses ORDER BY sort_order")]
    return {"platforms": plats, "statuses": stats}


@app.get("/api/matrix")
def matrix(account: str | None = None, q: str | None = None):
    """Tour x platform status grid. Platforms with no listing come back as NOT_LISTED,
    which is how "not uploaded yet" becomes visible."""
    with db.session() as con:
        plats, tours = db.platform_matrix(con, account, q)
        labels = {r["code"]: dict(r) for r in con.execute("SELECT * FROM statuses")}
    counts = {}
    for t in tours:
        for pid, cell in t["platforms"].items():
            counts.setdefault(str(pid), {}).setdefault(cell["status"], 0)
            counts[str(pid)][cell["status"]] += 1
    return {"platforms": plats, "tours": tours, "statuses": labels, "counts": counts}


@app.get("/api/employees")
def employees():
    with db.session() as con:
        return {"employees": [dict(r) for r in con.execute(
            """SELECT e.*, (SELECT COUNT(*) FROM tasks t WHERE t.employee_id=e.id
                            AND t.status='done') AS tasks
               FROM employees e ORDER BY e.name""")],
                "task_types": [dict(r) for r in con.execute(
                    "SELECT * FROM task_types ORDER BY code")]}


@app.get("/api/tasks")
def tasks(employee: str | None = None, since: str | None = None,
          until: str | None = None, limit: int = LIMIT_Q(300)):
    since, until = _day(since, "since"), _day(until, "until")
    sql = """SELECT t.*, tt.code AS task_code, tt.name AS task_name, tt.unit_value,
                    e.name AS employee, e.email, pl.name AS platform,
                    p.product_code, tr.title AS tour
             FROM tasks t JOIN task_types tt ON tt.id=t.task_type_id
             LEFT JOIN employees e ON e.id=t.employee_id
             LEFT JOIN platforms pl ON pl.id=t.platform_id
             LEFT JOIN products p ON p.id=t.product_id
             LEFT JOIN tours tr ON tr.id=t.tour_id WHERE 1=1"""
    args = []
    if employee:
        sql += " AND e.email=?"; args.append(employee)
    if since:
        sql += f" AND {store.as_date('t.completed_at')} >= {store.as_date('?')}"
        args.append(since)
    if until:
        sql += f" AND {store.as_date('t.completed_at')} <= {store.as_date('?')}"
        args.append(until)
    sql += " ORDER BY t.completed_at DESC, t.id DESC LIMIT ?"
    args.append(limit)
    with db.session() as con:
        return {"tasks": [dict(r) for r in con.execute(sql, args)]}


@app.post("/api/tasks")
def add_task(t: TaskIn):
    """Log work by hand — the reports treat manual and auto-logged tasks identically."""
    with db.session() as con:
        if not db.task_type_id(con, t.task_type):
            raise HTTPException(400, f"unknown task type {t.task_type!r}")
        emp = db.upsert_employee(con, t.employee_email)
        if not emp:
            raise HTTPException(400, "employee_email is required")
        pid = db.platform_id(con, t.platform) if t.platform else None
        if t.platform and not pid:
            raise HTTPException(400, f"unknown platform {t.platform!r}")
        tid = db.log_task(con, t.task_type, emp, quantity=t.quantity,
                          when_done=t.completed_at, tour_id=t.tour_id,
                          product_id=t.product_id, platform_id=pid, notes=t.notes)
    return {"ok": True, "task_id": tid}


@app.get("/api/reports")
def reports(since: str | None = None, until: str | None = None):
    since, until = _day(since, "since"), _day(until, "until")
    with db.session() as con:
        # Idempotent, and cheap (bounded by the number of syncs). Doing it here as well as
        # at startup means the reports are right even if the process was never restarted
        # after a sync finished.
        db.log_sync_tasks(con)
        return {
            "tours_created": db.report_tours_created(con),
            "by_employee": db.report_by_employee(con, since, until),
            "by_employee_type": db.report_by_employee_type(con, since, until),
            "period": {"since": since, "until": until},
        }


@app.get("/api/syncs")
def syncs(account: str | None = None):
    # Repair any leftover 'running' row before answering: this is the endpoint the resume
    # prompt reads, so a stale row here is exactly what makes Fetch start from scratch.
    # No reaping here. A run belongs to the laptop executing it, and that laptop is the
    # only thing that can tell a crashed run from a live one. Marking rows from here
    # would flag captures that are still in progress.
    sql = """SELECT s.*, a.viator_account_id, a.name AS account_name,
                    (SELECT COUNT(*) FROM sync_progress sp WHERE sp.sync_id=s.id)
                      AS products_done
             FROM syncs s
             JOIN accounts a ON a.id=s.account_id WHERE 1=1"""
    args = []
    allowed = scope_accounts()
    if allowed is not None:
        sql += (f" AND a.viator_account_id IN ({','.join('?' * len(allowed))})"
                if allowed else " AND 1=0")
        args += allowed
    if account:
        sql += " AND a.viator_account_id=?"
        args.append(account)
    sql += " ORDER BY s.id DESC LIMIT 100"
    with db.session() as con:
        return {"syncs": [dict(r) for r in con.execute(sql, args)]}


@app.get("/api/storage")
def storage():
    """Where data is going right now — surfaced in the UI so 'is it saving to the cloud?'
    is answerable without reading logs.

    The reachability probe (a Postgres round trip plus an R2 head_bucket) is cached for a
    minute: the dashboard polls this to watch the upload queue drain, and two network
    calls every few seconds to answer "yes, still reachable" would be pure waste.
    """
    now = time.time()
    if _REACH["val"] is None or now - _REACH["at"] > 60:
        _REACH.update(at=now, val=cloud.status())
    s = _REACH["val"]
    with db.session() as con:
        imgs, in_r2 = con.execute(
            "SELECT COUNT(*), COUNT(r2_key) FROM product_images").fetchone()[:2]
        waiting = pending_images(con)
    return {"engine": store.describe(), "cloud": store.is_cloud(),
            "postgres": s["postgres"], "r2": s["r2"],
            "images": {"total": imgs, "in_r2": in_r2, "pending": waiting,
                       "uploading": FLUSHING}}


@app.post("/api/product/{pid}/image")
async def add_image(pid: int, file: UploadFile = File(...),
                    editor_email: str = Form(...), caption: str | None = Form(None)):
    """Attach a photo to a product. Uploaded straight to R2 and recorded like any other
    image, but flagged is_manual so it is never confused with what Viator published."""
    # Photos are off by client decision, so the dashboard no longer offers an upload box.
    # Refuse here too — this app is the one on the public internet, and a disabled button
    # is not a closed door.
    if not C.CAPTURE_IMAGES:
        raise HTTPException(410, "Photos are not stored by this system any more. "
                                 "Photo changes on Viator are still recorded in Change "
                                 "history.")
    email = (editor_email or "").strip()
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "Please enter a valid email so the upload can be traced.")
    ctype = (file.content_type or "").split(";")[0].strip().lower()
    if ctype not in ALLOWED_IMAGE:
        raise HTTPException(400, f"{ctype or 'that file'} isn't a supported image. "
                                 f"Use JPEG, PNG, WebP or GIF.")
    data = await file.read()
    if not data:
        raise HTTPException(400, "that file is empty")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(400, f"image is {len(data)/1e6:.1f} MB — the limit is "
                                 f"{MAX_IMAGE_BYTES/1e6:.0f} MB")
    if not cloud.r2_available():
        raise HTTPException(503, "image storage (R2) is not configured — check audit/.env")

    with db.session() as con:
        row = con.execute("""SELECT p.product_code, a.viator_account_id,
                                    COALESCE(MAX(i.position), -1) + 1 AS nextpos
                             FROM products p JOIN accounts a ON a.id=p.account_id
                             LEFT JOIN product_images i ON i.product_id=p.id
                             WHERE p.id=? GROUP BY p.product_code, a.viator_account_id""",
                          (pid,)).fetchone()
        if not row:
            raise HTTPException(404, "no such product")
        pos = row["nextpos"] or 0
        key = cloud.r2_key(row["viator_account_id"], row["product_code"], pos,
                           ALLOWED_IMAGE[ctype])
        # "manual:" prefix keeps the UNIQUE(product_id, source_url) constraint meaningful
        # for hand-uploaded files, which have no Viator URL of their own.
        src = f"manual:{key}"
        try:
            await asyncio.to_thread(cloud.r2_put, key, data, ctype)
        except Exception as e:
            log(f"R2 upload failed for product {pid}: {e!r}")
            raise HTTPException(502, f"could not store the image: {e}")
        con.execute(store.upsert(
            "product_images",
            ("product_id", "source_url", "position", "captured_at", "r2_key", "bytes",
             "is_manual", "added_by", "caption"),
            "product_id, source_url",
            ("position", "captured_at", "r2_key", "bytes", "is_manual", "added_by",
             "caption")),
            (pid, src, pos, db.now(), key, len(data), 1, email.lower(), caption))
        emp = db.upsert_employee(con, email)
        db.log_task(con, "PHOTO_UPLOAD", emp, product_id=pid,
                    notes=caption or file.filename)
    log(f"{email} added an image to product {pid} ({len(data)/1024:.0f} KB)")
    return {"ok": True, "key": key, "position": pos, "bytes": len(data)}


@app.delete("/api/product/{pid}/image/{image_id}")
def remove_image(pid: int, image_id: int, editor_email: str):
    """Remove a MANUALLY added image. Captured Viator images are never deleted — they are
    evidence of what the portal showed, which is the point of the audit."""
    editor_email = who_edits(editor_email)
    with db.session() as con:
        r = con.execute("""SELECT is_manual, r2_key FROM product_images
                           WHERE id=? AND product_id=?""", (image_id, pid)).fetchone()
        if not r:
            raise HTTPException(404, "no such image on this product")
        if not r["is_manual"]:
            raise HTTPException(400, "that image was captured from Viator and is part of "
                                     "the audit record — it can't be deleted here")
        con.execute("DELETE FROM product_images WHERE id=?", (image_id,))
    log(f"{editor_email} removed manual image {image_id} from product {pid}")
    return {"ok": True}


def who_edits(supplied=""):
    """Who gets the credit — or the blame — for an edit.

    Whoever is signed in, always. It used to be typed into a box, which meant it was
    traceability on trust: anyone could put a colleague's address on their own edit. The
    server knows who sent the request, so the browser no longer gets a say.

    The typed value is still accepted when auth is switched off entirely (a developer on
    a local SQLite copy), because there is nobody signed in to ask.
    """
    u = me()
    if auth.enabled() and u.get("email"):
        return u["email"].strip().lower()
    email = (supplied or "").strip()
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "Please enter your email so the edit can be traced.")
    return email.lower()


@app.post("/api/product/{pid}/edit")
def edit_product(pid: int, e: EditIn):
    email = who_edits(e.editor_email)
    try:
        with db.session() as con:
            guard_product(con, pid)
            out = db.set_edit(con, pid, e.field, e.value, email, e.note)
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    log(f"{email} edited {e.field} on product {pid}")
    return {"ok": True, **out}


@app.get("/api/thumb/{pid}")
def thumb(pid: int):
    """Local file first, then R2, then the CDN.

    The R2 step matters: with the local images/ folder deleted this endpoint used to 404
    for every product, because it only ever looked on disk — unlike /api/image, which
    already had the fallback chain.
    """
    with db.session() as con:
        r = con.execute("""SELECT p.thumbnail_path, p.thumbnail_url,
                                  (SELECT i.r2_key FROM product_images i
                                   WHERE i.product_id=p.id AND i.r2_key IS NOT NULL
                                   ORDER BY i.position LIMIT 1) AS r2_key
                           FROM products p WHERE p.id=?""", (pid,)).fetchone()
    if not r:
        raise HTTPException(404, "no such product")
    f = _safe_local(r["thumbnail_path"])
    if f:
        return FileResponse(f)
    if r["r2_key"] and cloud.r2_available():
        try:
            return RedirectResponse(cloud.r2_url(r["r2_key"], expires=3600))
        except Exception as e:
            log(f"R2 thumbnail link failed for product {pid}: {e!r}")
    if r["thumbnail_url"]:
        return RedirectResponse(r["thumbnail_url"])
    return JSONResponse({"error": "no thumbnail available"}, status_code=404)


@app.get("/api/image/{image_id}")
def image(image_id: int):
    """Serve a stored image by id. Replaces building /images/<path> URLs in the
    frontend: local_path is an absolute Windows path, so string-splitting it produced
    URLs with backslashes that StaticFiles could not serve."""
    with db.session() as con:
        r = con.execute("""SELECT local_path, source_url, r2_key FROM product_images
                           WHERE id=?""", (image_id,)).fetchone()
    if not r:
        raise HTTPException(404, "no such image")
    # Local file first when present (instant, no egress), then R2, then the CDN. Ordering
    # it this way means the dashboard stays fast on the machine that did the capture and
    # still works from anywhere else.
    f = _safe_local(r["local_path"])
    if f:
        return FileResponse(f)
    key = r["r2_key"] if "r2_key" in r.keys() else None
    if key and cloud.r2_available():
        try:
            # presigned, short-lived: the bucket itself stays private
            return RedirectResponse(cloud.r2_url(key, expires=3600))
        except Exception as e:
            log(f"R2 link failed for image {image_id}: {e!r}")
    if r["source_url"]:
        return RedirectResponse(r["source_url"])   # fall back to the CDN copy
    raise HTTPException(404, "image not available")


@app.get("/api/status")
def status():
    """Always idle — nothing can be capturing here.

    Kept rather than deleted because the dashboard polls it every two seconds; removing
    it would mean a 404 on a loop and a permanently broken status pill. `read_only` is
    the flag the UI keys off to put the automation notice behind Fetch / Stop / Add
    Account, and the owner details travel with it so the message has one source.
    """
    return {"status": "idle", "busy": False, "seen": 0, "total": 0, "changes": 0,
            "message": "", "current": None, "account": None, "sync_id": None,
            "started": None, "log": [], "stale_files": [],
            "read_only": True, "automation_owner": C.AUTOMATION_OWNER}


@app.get("/api/sessions")
def sessions_list():
    """Always empty: a session is an open browser, and this deployment has none."""
    return {"sessions": [], "read_only": True}
