# opatrip-dashboard

Read-only web dashboard for the Opatrip product audit — the deployed half of an
internal tool that tracks tour listings across supplier platforms.

It reads the audit database and shows products, lifecycle status, change history,
manual edits, photos and payroll-style reports. **It cannot capture anything.**

## Two halves, on purpose

| | Where it runs | What it does |
|---|---|---|
| **Automation Tool** | a staff laptop | signs in to the supplier portal and captures product data |
| **This dashboard** | Vercel | reads what was captured; edits, reports, photos |

Capture stays on laptops because the tool signs in with a real staff account. Putting
that on a public server would mean portal credentials on shared infrastructure, and the
capture pacing is tuned for one operator on one connection. Fetch / Stop / Add Account
are present in the UI and explain where to run a capture instead of failing silently.

That is enforced by what was built, not by a disabled button: no capture module is
imported, `/api/fetch`, `/api/stop` and `/api/session/*` do not exist as routes, and no
browser package appears in `requirements.txt`.

## Layout

```
api/index.py     Vercel entry point (ASGI)
web.py           the application — read + edit endpoints only
db.py            schema, queries, edit/override layer
store.py         storage abstraction (Postgres in production)
cloud.py         Supabase + Cloudflare R2 clients
config.py        reference data; also names who runs captures
public/          served by Vercel's CDN, NOT bundled into the function
  index.html     the shell
  favicon.svg
  static/        ES modules + CSS (static/js/readonly.js is the notice)
```

## Configuration

Set these as project environment variables. **Never commit them** — `.env` is
git-ignored.

| Variable | Purpose |
|---|---|
| `SUPABASE_DB_URL` | Postgres connection string (use the **transaction pooler**, port 6543, for serverless) |
| `R2_ENDPOINT`, `R2_BUCKET` | Cloudflare R2 bucket holding product images |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | R2 credentials |
| `AUDIT_PG_POOL_MAX` | optional; connections per instance (default 2) |

Run locally:

```bash
pip install -r requirements.txt
uvicorn web:app --reload --port 8001
```

## Before this is shared beyond the team

**There is no authentication.** Anyone with the URL can read every product and every
account, and can edit fields and upload photos. The email prompt is traceability, not
identity — it is typed, not verified. Put the deployment behind access control before
handing the link out.
