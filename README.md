# opatrip-dashboard

Read-only web dashboard for the Opatrip product audit — the deployed half of an internal
tool that tracks tour listings across supplier platforms.

It reads the audit database and shows products, lifecycle status, change history, manual
edits, photos and payroll-style reports. **It cannot capture anything.**

Live: <https://opatrip-dashboard.vercel.app>

---

## Two halves, on purpose

| | Where it runs | What it does |
|---|---|---|
| **Automation Tool** | a staff laptop | signs in to the supplier portal and captures product data |
| **This dashboard** | Vercel | reads what was captured; edits, reports, photos |

Capture stays on laptops because it signs in with a real staff account. Putting that on a
public server would mean portal credentials on shared infrastructure, and the capture
pacing is tuned for one operator on one connection. Fetch / Stop / Add Account are present
in the UI and explain where to run a capture instead of failing silently.

**That is enforced by what was built, not by a disabled button.** No capture module is
imported. `/api/fetch`, `/api/stop`, `/api/session/*` and `/api/flush-images` do not exist
as routes — they return 404 on the live site. No browser package appears in the
dependencies. Editing the JavaScript in a browser gets you nothing.

---

## Layout

```
pyproject.toml   dependencies + the ASGI entrypoint Vercel loads
web.py           the application — read + edit endpoints only (28 routes)
db.py            schema, queries, diffing, snapshots, edits, reports
store.py         Postgres/SQLite seam + dialect fragments
cloud.py         Supabase pool + R2 client
config.py        reference data; also names who runs captures
public/          served by Vercel's CDN, NOT bundled into the function
  index.html     the shell
  favicon.svg
  static/        ES modules + CSS
    js/readonly.js   the "run it on your laptop" notice
```

`db.py`, `store.py`, `cloud.py` and `pgschema.py` are **byte-identical** to the desktop
tool's copies. Change one, copy it across — otherwise two apps read the same database
through different logic.

### Two Vercel-specific things that are easy to get wrong

**`public/` is CDN-only.** It is *not* bundled into the serverless function; only the
traced Python modules reach `/var/task`. An unguarded
`StaticFiles(directory="public/static")` therefore raises at import and 500s **every**
route, including ones that touch no files. The mount here is guarded and exists only for
running locally.

**`vercel.json` is deliberately absent.** A catch-all rewrite to `/api/index` *replaces*
the path the function receives, so FastAPI saw `/api/index` for every request and matched
nothing — the shell rendered while every data call 404'd. The entrypoint is declared in
`pyproject.toml` instead (`[tool.vercel] entrypoint = "web:app"`), which routes each
request with its original path.

---

## Configuration

Set these as Vercel project environment variables. **Never commit them** — `.env` is
git-ignored.

| Variable | Purpose |
|---|---|
| `SUPABASE_DB_URL` | Postgres connection string. Use the **transaction pooler, port 6543** — each serverless instance opens its own connections |
| `R2_ENDPOINT`, `R2_BUCKET` | Cloudflare R2 bucket holding product images |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | R2 credentials |
| `AUDIT_PG_POOL_MAX` | optional; connections per instance (default 2) |

Run locally:

```bash
pip install -e .
uvicorn web:app --reload --port 8001
```

Locally `public/` is on disk, so the static mount and the `/` route serve it. On Vercel
the CDN answers first and neither is reached.

---

## How it relates to the audit database

Images are served as **short-lived presigned R2 URLs**, so the bucket stays private.

Edits are an **override layer**: the captured snapshot is never rewritten, `product_edits`
keeps the human value alongside `captured_value`, and every edit records an email. That is
traceability, not identity — the address is typed, not verified.

A blank field is labelled by *why* it is blank. **"Not captured (draft)"** means the
client's own rule was followed — drafts are recorded from the account roster and never
deep-fetched, and the roster carries no location and only partial connection detail.
**"Unknown"** means the portal itself had no value. Both come from `db.blank_bucket()`,
shared by `/api/stats` and `/api/overview` so the two pages cannot disagree.

The full data model, capture design and anti-block rules are documented in the desktop
tool's README.

---

## Before this is shared beyond the team

**There is no authentication.** Anyone with the URL can read every product and every
account, and can edit fields and upload photos. Put the deployment behind access control —
Vercel's own Deployment Protection is a toggle — before handing the link out.
