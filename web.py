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
import json
import os
import re
import time
from datetime import date
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import (FileResponse, HTMLResponse, JSONResponse,
                               RedirectResponse)
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

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
              (SELECT COUNT(*) FROM product_images i JOIN products p ON p.id=i.product_id
                 WHERE p.account_id=a.id) AS image_count
            FROM accounts a ORDER BY a.name IS NULL, a.name""")]
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
        where, args = ("WHERE a.viator_account_id=?", [account]) if account else ("", [])
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
    where, args = ("WHERE a.viator_account_id=?", [account]) if account else ("", [])

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
      """.format(swhere=swhere, swhere_done=swhere_done), args * 11).fetchone()
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
        by = lambda col: {r[0]: r[1] for r in con.execute(
            f"""SELECT {db.blank_bucket(col)}, COUNT(*) {P}
                GROUP BY 1 ORDER BY 2 DESC""", args)}
        dist = {"status": by("status_canonical"), "connection": by("connection_state"),
                "quality": by("quality_level"), "location": dict(
                    list(by("location").items())[:8])}
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
        recent_changes = rows(f"""SELECT c.field_path, c.old_value, c.new_value,
                                     c.detected_at, c.operator_email, p.product_code,
                                     p.title
                                  FROM changes c
                                  JOIN accounts a ON a.id=c.account_id
                                  JOIN products p ON p.id=c.product_id
                                  {where}
                                  ORDER BY c.id DESC LIMIT 8""", args)
        recent_syncs = rows(f"""SELECT s.id, s.status, s.started_at, s.products_seen,
                                       s.changes_found, s.operator_email
                                FROM syncs s JOIN accounts a ON a.id=s.account_id
                                {where} ORDER BY s.id DESC LIMIT 5""", args)

    return {
        "kpis": {
            "products": {"value": total_products, "delta": pct(new30, prev30),
                         "sub": f"{new30} added in 30 days"},
            "tours": {"value": tours_total, "delta": None,
                      "sub": ("in this account" if account else "across all platforms")},
            "photos": {"value": photos, "delta": None, "sub": "downloaded locally"},
            "changes": {"value": ch7, "delta": pct(ch7, chprev7),
                        "sub": "detected this week"},
            "drafts": {"value": drafts, "delta": None, "sub": "recorded, not fetched"},
            "removed": {"value": missing, "delta": None, "sub": "gone from the roster"},
            "sync_rate": {"value": round(syncs_done / syncs_all * 100) if syncs_all else 0,
                          "delta": None, "suffix": "%",
                          "sub": f"{syncs_done} of {syncs_all} runs completed"},
        },
        "dist": dist, "coverage": cover,
        "series": {"changes": list(reversed(series_changes)),
                   "added": list(reversed(series_added))},
        "recent_changes": recent_changes, "recent_syncs": recent_syncs,
    }


@app.get("/api/products")
def products(account: str | None = None, q: str | None = None,
             status: str | None = None, connection: str | None = None):
    sql = """SELECT p.*, a.viator_account_id, a.name AS account_name,
               (SELECT COUNT(*) FROM product_images i WHERE i.product_id=p.id) AS image_count,
               (SELECT COUNT(*) FROM changes c WHERE c.product_id=p.id) AS change_count
             FROM products p JOIN accounts a ON a.id=p.account_id WHERE 1=1"""
    args = []
    if account:
        sql += " AND a.viator_account_id=?"
        args.append(account)
    if q:
        sql += " AND (p.title LIKE ? OR p.product_code LIKE ?)"
        args += [f"%{q}%", f"%{q}%"]
    if status:
        sql += " AND p.status=?"
        args.append(status)
    if connection:
        sql += " AND p.connection_state=?"
        args.append(connection)
    sql += " ORDER BY p.product_code"
    with db.session() as con:
        rows = [dict(r) for r in con.execute(sql, args)]
        # manual overrides win for display, and carry who made them
        db.apply_edits(con, rows)
    return {"products": rows}


@app.get("/api/product/{pid}")
def product_detail(pid: int):
    with db.session() as con:
        p = con.execute("""SELECT p.*, a.viator_account_id, a.name AS account_name
                           FROM products p JOIN accounts a ON a.id=p.account_id
                           WHERE p.id=?""", (pid,)).fetchone()
        if not p:
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


@app.get("/api/product/{pid}/edits")
def product_edits(pid: int):
    with db.session() as con:
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
    if not EMAIL_RE.match((editor_email or "").strip()):
        raise HTTPException(400, "a valid email is required")
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


@app.post("/api/product/{pid}/edit")
def edit_product(pid: int, e: EditIn):
    email = (e.editor_email or "").strip()
    if not email:
        raise HTTPException(400, "Please enter your email so the edit can be traced.")
    if not EMAIL_RE.match(email):
        raise HTTPException(400, f"{email!r} doesn't look like an email address")
    try:
        with db.session() as con:
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
