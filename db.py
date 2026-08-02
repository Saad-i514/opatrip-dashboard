"""SQLite storage + field-level change detection.

Adaptive schema: we never declare product fields as columns. A snapshot stores the
whole normalized dict as JSON; diffing walks flattened dotted paths, so a product
exposing more data simply produces more paths and one exposing less produces fewer.
"""
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import store
from config import DB_PATH, VOLATILE_PREFIXES, VOLATILE_TOKENS

# The SQLite DDL below is still used when running without cloud credentials. The Postgres
# equivalent lives in pgschema.py.

SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  viator_account_id TEXT UNIQUE NOT NULL,   -- e.g. "197004"
  name              TEXT,                   -- "Opatrip.com US LLC - Local Tours in Austria"
  country           TEXT,
  signin_email      TEXT,                   -- last operator email used
  profile_dir       TEXT,
  last_sync_at      TEXT,
  created_at        TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  account_id       INTEGER NOT NULL REFERENCES accounts(id),
  product_code     TEXT NOT NULL,
  title            TEXT,
  status           TEXT,
  connection_state TEXT,
  quality_level    TEXT,
  location         TEXT,
  is_draft_stub    INTEGER DEFAULT 0,   -- 1 = wizard/draft, recorded but not deep-fetched
  thumbnail_url    TEXT,
  thumbnail_path   TEXT,
  first_seen_at    TEXT,
  last_seen_at     TEXT,
  missing_since    TEXT,   -- set when it stops appearing in the account's roster
  UNIQUE(account_id, product_code)
);
CREATE TABLE IF NOT EXISTS product_images (
  id INTEGER PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  source_url  TEXT NOT NULL,
  local_path  TEXT,
  position    INTEGER,
  image_ref   TEXT,
  captured_at TEXT,
  UNIQUE(product_id, source_url)
);
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY,
  product_id       INTEGER NOT NULL REFERENCES products(id),
  sync_id          INTEGER NOT NULL REFERENCES syncs(id),
  captured_at      TEXT,
  normalized_json  TEXT,
  raw_network_json TEXT,
  last_confirmed_at TEXT,      -- latest run that saw this content unchanged
  confirmations     INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS changes (
  id INTEGER PRIMARY KEY,
  product_id     INTEGER NOT NULL REFERENCES products(id),
  sync_id        INTEGER NOT NULL REFERENCES syncs(id),
  field_path     TEXT,
  old_value      TEXT,
  new_value      TEXT,
  detected_at    TEXT,
  account_id     INTEGER REFERENCES accounts(id),
  operator_email TEXT,
  source         TEXT   -- 'diff' | 'viator_modified_by'
);
CREATE TABLE IF NOT EXISTS syncs (
  id INTEGER PRIMARY KEY,
  account_id      INTEGER NOT NULL REFERENCES accounts(id),
  operator_email  TEXT NOT NULL,      -- entered by the client before login
  portal_email    TEXT,               -- currentUser.email as reported by Viator
  portal_user_ref TEXT,
  started_at      TEXT,
  finished_at     TEXT,
  status          TEXT,               -- running|done|paused_challenge|error|stopped
  message         TEXT,
  products_seen   INTEGER DEFAULT 0,
  changes_found   INTEGER DEFAULT 0,
  host            TEXT,               -- which machine is running it (fleet safety)
  heartbeat       TEXT                -- last sign of life; stale => really abandoned
);
-- resumability: which products this sync already finished
CREATE TABLE IF NOT EXISTS sync_progress (
  sync_id      INTEGER NOT NULL REFERENCES syncs(id),
  product_code TEXT NOT NULL,
  done_at      TEXT,
  PRIMARY KEY (sync_id, product_code)
);
-- ---------------------------------------------------------------- platforms & tours
-- A "tour" is the thing the business sells. A "product" row is that tour's listing on ONE
-- platform, so the same tour can be LIVE on Viator and REJECTED on GetYourGuide at once.
CREATE TABLE IF NOT EXISTS platforms (
  id INTEGER PRIMARY KEY,
  code       TEXT UNIQUE NOT NULL,
  name       TEXT,
  capturable INTEGER DEFAULT 0,   -- 1 once a scraper exists for it
  sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS statuses (
  code       TEXT PRIMARY KEY,     -- canonical: LIVE / PENDING / DRAFT / ...
  label      TEXT,
  badge      TEXT,
  sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS status_map (
  platform_id INTEGER NOT NULL REFERENCES platforms(id),
  raw         TEXT NOT NULL,       -- the platform's own word
  canonical   TEXT NOT NULL REFERENCES statuses(code),
  PRIMARY KEY (platform_id, raw)
);
CREATE TABLE IF NOT EXISTS tours (
  id INTEGER PRIMARY KEY,
  tour_key   TEXT UNIQUE,          -- normalised title; groups listings across platforms
  title      TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER REFERENCES employees(id),
  notes      TEXT
);
-- ------------------------------------------------------------- people & work tracking
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY,
  name      TEXT,
  email     TEXT UNIQUE,
  role      TEXT DEFAULT 'Quality Manager',
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS task_types (
  id INTEGER PRIMARY KEY,
  code       TEXT UNIQUE NOT NULL,
  name       TEXT,
  unit_value REAL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  task_type_id INTEGER NOT NULL REFERENCES task_types(id),
  employee_id  INTEGER REFERENCES employees(id),
  tour_id      INTEGER REFERENCES tours(id),
  product_id   INTEGER REFERENCES products(id),
  platform_id  INTEGER REFERENCES platforms(id),
  account_id   INTEGER REFERENCES accounts(id),
  sync_id      INTEGER REFERENCES syncs(id),
  quantity     REAL DEFAULT 1,
  status       TEXT DEFAULT 'done',    -- done | in_progress | cancelled
  completed_at TEXT,
  notes        TEXT,
  created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(sync_id, task_type_id, employee_id)   -- one auto task per sync per type
);
-- ------------------------------------------------------------------ manual edits
-- Mirrors pgschema.py. Kept in step deliberately: this table only existed in the
-- Postgres schema, so running without cloud credentials crashed on the first edit with
-- "no such table: product_edits".
CREATE TABLE IF NOT EXISTS product_edits (
  id INTEGER PRIMARY KEY,
  product_id     INTEGER NOT NULL REFERENCES products(id),
  field          TEXT NOT NULL,   -- products column, or a dotted path into the snapshot
  value          TEXT,            -- the human-entered value (NULL clears the override)
  captured_value TEXT,            -- what the portal said, kept for comparison
  editor_email   TEXT NOT NULL,   -- traceability: who made this edit
  editor_id      INTEGER REFERENCES employees(id),
  edited_at      TEXT NOT NULL,
  note           TEXT,
  is_current     INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_edits_product ON product_edits(product_id, field);
CREATE INDEX IF NOT EXISTS idx_edits_current ON product_edits(is_current, edited_at);
CREATE INDEX IF NOT EXISTS idx_tasks_emp ON tasks(employee_id, completed_at);
CREATE INDEX IF NOT EXISTS idx_changes_product ON changes(product_id, detected_at);
CREATE INDEX IF NOT EXISTS idx_snap_product ON snapshots(product_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_products_account ON products(account_id);
"""


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# Storage engine: Supabase Postgres when credentials are present, else the local SQLite
# file. Everything below is written once and runs on both.
connect = store.connect
session = store.session


def init():
    if store.is_cloud():
        import pgschema
        with session() as con:
            con.executescript(pgschema.SCHEMA)
            con.executescript(pgschema.MIGRATIONS)
            seed_reference(con)
            backfill_platform(con)
        return
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with session() as con:
        con.executescript(SCHEMA)
        # Additive migrations for databases created by an earlier version. CREATE TABLE
        # IF NOT EXISTS won't add a new column to an existing table.
        have = store.table_columns(con, "products")
        for col, decl in (("missing_since", "TEXT"), ("platform_id", "INTEGER"),
                          ("tour_id", "INTEGER"), ("status_canonical", "TEXT")):
            if col not in have:
                con.execute(f"ALTER TABLE products ADD COLUMN {col} {decl}")
        acc = store.table_columns(con, "accounts")
        if "platform_id" not in acc:
            con.execute("ALTER TABLE accounts ADD COLUMN platform_id INTEGER")
        syn = store.table_columns(con, "syncs")
        for col, decl in (("host", "TEXT"), ("heartbeat", "TEXT")):
            if col not in syn:
                con.execute(f"ALTER TABLE syncs ADD COLUMN {col} {decl}")
        snp = store.table_columns(con, "snapshots")
        for col, decl in (("last_confirmed_at", "TEXT"),
                          ("confirmations", "INTEGER DEFAULT 0")):
            if col not in snp:
                con.execute(f"ALTER TABLE snapshots ADD COLUMN {col} {decl}")
        img = store.table_columns(con, "product_images")
        for col, decl in (("r2_key", "TEXT"), ("bytes", "INTEGER"),
                          ("is_manual", "INTEGER DEFAULT 0"), ("added_by", "TEXT"),
                          ("caption", "TEXT")):
            if col not in img:
                con.execute(f"ALTER TABLE product_images ADD COLUMN {col} {decl}")
        # Indexes on migrated columns must come AFTER the ALTER TABLE above — putting them
        # in SCHEMA failed on an existing database with "no such column: tour_id".
        con.execute("CREATE INDEX IF NOT EXISTS idx_products_tour ON products(tour_id)")
        con.execute("CREATE INDEX IF NOT EXISTS idx_products_platform "
                    "ON products(platform_id)")
        con.commit()
        seed_reference(con)
        backfill_platform(con)
        con.commit()


def seed_reference(con):
    """Load platforms / statuses / status map / task types from config. Idempotent, so
    adding a platform or task type to config.py is picked up on next start."""
    from config import PLATFORMS, CANONICAL_STATUSES, STATUS_MAP, TASK_TYPES
    for i, (code, name, cap) in enumerate(PLATFORMS):
        con.execute("""INSERT INTO platforms (code, name, capturable, sort_order)
                       VALUES (?,?,?,?)
                       ON CONFLICT(code) DO UPDATE SET name=excluded.name,
                         capturable=excluded.capturable, sort_order=excluded.sort_order""",
                    (code, name, int(cap), i))
    for i, (code, label, badge) in enumerate(CANONICAL_STATUSES):
        con.execute("""INSERT INTO statuses (code, label, badge, sort_order) VALUES (?,?,?,?)
                       ON CONFLICT(code) DO UPDATE SET label=excluded.label,
                         badge=excluded.badge, sort_order=excluded.sort_order""",
                    (code, label, badge, i))
    for pcode, m in STATUS_MAP.items():
        pid = platform_id(con, pcode)
        if not pid:
            continue
        for raw, canon in m.items():
            con.execute("""INSERT INTO status_map (platform_id, raw, canonical)
                           VALUES (?,?,?) ON CONFLICT(platform_id, raw)
                           DO UPDATE SET canonical=excluded.canonical""", (pid, raw, canon))
    for code, name, val in TASK_TYPES:
        con.execute("""INSERT INTO task_types (code, name, unit_value) VALUES (?,?,?)
                       ON CONFLICT(code) DO UPDATE SET name=excluded.name,
                         unit_value=excluded.unit_value""", (code, name, val))


def platform_id(con, code):
    r = con.execute("SELECT id FROM platforms WHERE code=?", (code,)).fetchone()
    return r["id"] if r else None


def tour_key(title):
    """Normalised title used to recognise the same tour across platforms."""
    import re as _re
    return _re.sub(r"[^a-z0-9]+", " ", (title or "").lower()).strip() or None


def upsert_tour(con, title, created_by=None):
    k = tour_key(title)
    if not k:
        return None
    sql = """INSERT INTO tours (tour_key, title, created_by) VALUES (?,?,?)
             ON CONFLICT(tour_key) DO UPDATE SET title=COALESCE(tours.title, excluded.title)"""
    # DO UPDATE rather than DO NOTHING purely so RETURNING yields a row on conflict too —
    # that turns the old insert-then-select into a single round trip. The title is only
    # filled in when it was missing, so an existing tour is not rewritten.
    if store.is_cloud():
        r = con.execute(sql + " RETURNING id", (k, title, created_by)).fetchone()
        if r:
            return r[0]
    con.execute(sql, (k, title, created_by))
    r = con.execute("SELECT id FROM tours WHERE tour_key=?", (k,)).fetchone()
    return r["id"] if r else None


def canonical_status(con, plat_id, raw):
    """Map a platform's own status word onto a canonical one. Unknown values become
    PENDING rather than vanishing, so a new platform status is visible immediately."""
    if not raw:
        return None
    r = con.execute("""SELECT canonical FROM status_map WHERE platform_id=? AND raw=?""",
                    (plat_id, str(raw).upper())).fetchone()
    return r["canonical"] if r else "PENDING"


def backfill_platform(con):
    """Everything captured before platforms existed is Viator. Attach it, derive canonical
    statuses, and give each product a tour so the cross-platform view has rows."""
    vid = platform_id(con, "viator")
    if not vid:
        return
    con.execute("UPDATE accounts SET platform_id=? WHERE platform_id IS NULL", (vid,))
    con.execute("UPDATE products SET platform_id=? WHERE platform_id IS NULL", (vid,))
    for r in con.execute("""SELECT id, title, status, status_canonical, tour_id
                            FROM products WHERE tour_id IS NULL OR status_canonical IS NULL"""
                         ).fetchall():
        tid = r["tour_id"] or upsert_tour(con, r["title"])
        canon = r["status_canonical"] or canonical_status(con, vid, r["status"])
        con.execute("UPDATE products SET tour_id=?, status_canonical=? WHERE id=?",
                    (tid, canon, r["id"]))


# --------------------------------------------------------------------------- diff
import re as _re

_ID_KEYS = ("productCode", "ref", "id", "code", "fieldKey")


def list_identity(lst):
    """Pick a field that identifies items in a list of dicts, so re-ordering isn't a
    change. Falls back through: known id fields -> any *Ref/*Reference/*Id -> any field
    that is scalar and unique across every item -> None (then positions are used).

    Without this, 23 list types keyed on position: reordering the 94 pickup points on one
    product produced 752 phantom changes, and a full reorder sweep ~81,000."""
    if not lst or not all(isinstance(x, dict) for x in lst):
        return None

    def unique(k):
        vals = [x.get(k) for x in lst]
        return (all(isinstance(v, (str, int, float)) and not isinstance(v, bool)
                    for v in vals) and len(set(vals)) == len(vals))

    for k in _ID_KEYS:
        if all(k in x for x in lst) and unique(k):
            return k
    common = set(lst[0])
    for x in lst[1:]:
        common &= set(x)
    for k in sorted(common):
        if _re.search(r"(ref|reference|id)$", k, _re.I) and unique(k):
            return k
    for k in sorted(common):          # sorted -> deterministic across runs
        if unique(k):
            return k
    return None




def flatten(obj, prefix=""):
    """{'a': {'b': [1,2]}} -> {'a.b[0]': 1, 'a.b[1]': 2}. Lists of dicts are keyed by
    a stable identity (productCode/ref/id) when present, so reordering isn't a change."""
    out = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            out.update(flatten(v, f"{prefix}.{k}" if prefix else k))
    elif isinstance(obj, list):
        # Key list items by identity, not position, so re-ordering isn't a "change".
        # Dicts key on their id field; SCALARS key on their own value — without that,
        # the portal shuffling ['A','B'] to ['B','A'] produced two bogus changes, which
        # was every single entry in the audit trail.
        seen = {}
        idfield = list_identity(obj)
        for i, v in enumerate(obj):
            key = i
            if isinstance(v, dict):
                # No identity field -> keep the position. Hashing the content instead was
                # measured and made things WORSE (2,330 -> 18,672 phantom changes): the
                # key then depends on everything nested inside, so one nested edit
                # rewrites the entire subtree as a remove plus an add.
                key = v.get(idfield) if idfield is not None else i
            elif not isinstance(v, list):
                # Scalars always key on their own value. Deciding this per-list based on
                # whether it happened to contain duplicates made the scheme flip between
                # snapshots and invent churn. Repeats get an occurrence suffix so the
                # keying is deterministic either way.
                seen[repr(v)] = seen.get(repr(v), 0) + 1
                n = seen[repr(v)]
                # "=" marks an identity key: [=1] is the value 1, [1] is position 1
                key = f"={v}" if n == 1 else f"={v}#{n}"
            out.update(flatten(v, f"{prefix}[{key}]"))
    else:
        out[prefix] = obj
    return out


def is_volatile(path):
    return path.startswith(VOLATILE_PREFIXES) or any(t in path for t in VOLATILE_TOKENS)


def diff(old, new):
    """Field-level changes between two normalized snapshots."""
    a, b = flatten(old or {}), flatten(new or {})
    changes = []
    for path in sorted(set(a) | set(b)):
        if is_volatile(path):
            continue
        ov, nv = a.get(path, None), b.get(path, None)
        if ov != nv:
            changes.append((path, ov, nv))
    return changes


# ------------------------------------------------------------------- upsert helpers
def upsert_account(con, viator_account_id, name=None, country=None,
                   signin_email=None, profile_dir=None):
    con.execute(
        """INSERT INTO accounts (viator_account_id, name, country, signin_email, profile_dir)
           VALUES (?,?,?,?,?)
           ON CONFLICT(viator_account_id) DO UPDATE SET
             name=COALESCE(excluded.name, accounts.name),
             country=COALESCE(excluded.country, accounts.country),
             signin_email=COALESCE(excluded.signin_email, accounts.signin_email),
             profile_dir=COALESCE(excluded.profile_dir, accounts.profile_dir)""",
        (str(viator_account_id), name, country, signin_email,
         str(profile_dir) if profile_dir else None))
    return con.execute("SELECT * FROM accounts WHERE viator_account_id=?",
                       (str(viator_account_id),)).fetchone()


def upsert_product(con, account_id, code, **f):
    """Insert-or-update a product and return its id.

    Takes platform_id / tour_id / status_canonical / thumbnail_path directly: the sync used
    to write those in two follow-up UPDATEs, which is free against a local file but three
    network round trips against Supabase. One statement instead.
    """
    t = now()
    sql = """INSERT INTO products (account_id, product_code, title, status,
                                   connection_state, quality_level, location,
                                   is_draft_stub, thumbnail_url, thumbnail_path,
                                   platform_id, tour_id, status_canonical,
                                   first_seen_at, last_seen_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(account_id, product_code) DO UPDATE SET
               title=COALESCE(excluded.title, products.title),
               status=COALESCE(excluded.status, products.status),
               connection_state=COALESCE(excluded.connection_state,
                                         products.connection_state),
               quality_level=COALESCE(excluded.quality_level, products.quality_level),
               location=COALESCE(excluded.location, products.location),
               is_draft_stub=excluded.is_draft_stub,
               thumbnail_url=COALESCE(excluded.thumbnail_url, products.thumbnail_url),
               thumbnail_path=COALESCE(excluded.thumbnail_path, products.thumbnail_path),
               platform_id=COALESCE(excluded.platform_id, products.platform_id),
               tour_id=COALESCE(excluded.tour_id, products.tour_id),
               status_canonical=COALESCE(excluded.status_canonical,
                                         products.status_canonical),
               last_seen_at=excluded.last_seen_at"""
    args = (account_id, code, f.get("title"), f.get("status"), f.get("connection_state"),
            f.get("quality_level"), f.get("location"), int(bool(f.get("is_draft_stub"))),
            f.get("thumbnail_url"), f.get("thumbnail_path"), f.get("platform_id"),
            f.get("tour_id"), f.get("status_canonical"), t, t)
    # RETURNING id saves the follow-up SELECT. Postgres returns the row for DO UPDATE too.
    if store.is_cloud():
        r = con.execute(sql + " RETURNING id", args).fetchone()
        if r:
            return r[0]
    con.execute(sql, args)
    return con.execute("SELECT id FROM products WHERE account_id=? AND product_code=?",
                       (account_id, code)).fetchone()["id"]


def status_map_for(con, plat_id):
    """The whole raw->canonical map in ONE query. canonical_status() was called per
    product, which is a round trip each for data that never changes during a run."""
    rows = con.execute("SELECT raw, canonical FROM status_map WHERE platform_id=?",
                       (plat_id,)).fetchall()
    return {r["raw"]: r["canonical"] for r in rows}


def canonical_from(mapping, raw):
    """Same fallback rule as canonical_status(), against a preloaded map."""
    if not raw:
        return None
    return mapping.get(str(raw).upper(), "PENDING")


def reconcile_roster(con, account_id, present_codes):
    """Flag products that have vanished from the account's roster, and un-flag any that
    came back. A product disappearing from Viator is an audit event in its own right —
    without this it would simply stop being updated and look unchanged forever.

    Returns (newly_missing, returned) code lists."""
    present = set(present_codes or ())
    if not present:
        return [], []          # never mark everything missing off an empty roster
    rows = con.execute("""SELECT product_code, missing_since FROM products
                          WHERE account_id=?""", (account_id,)).fetchall()
    t = now()
    newly_missing, returned = [], []
    for r in rows:
        code, flagged = r["product_code"], r["missing_since"]
        if code not in present and not flagged:
            con.execute("""UPDATE products SET missing_since=? WHERE account_id=? AND
                           product_code=?""", (t, account_id, code))
            newly_missing.append(code)
        elif code in present and flagged:
            con.execute("""UPDATE products SET missing_since=NULL WHERE account_id=? AND
                           product_code=?""", (account_id, code))
            returned.append(code)
    return newly_missing, returned


def latest_snapshot(con, product_id):
    r = con.execute("""SELECT normalized_json FROM snapshots WHERE product_id=?
                       ORDER BY id DESC LIMIT 1""", (product_id,)).fetchone()
    return json.loads(r["normalized_json"]) if r and r["normalized_json"] else None


def _latest_snapshot_row(con, product_id):
    """The previous snapshot's id and content, in one read — save_snapshot needs both."""
    r = con.execute("""SELECT id, normalized_json, raw_network_json FROM snapshots
                       WHERE product_id=? ORDER BY id DESC LIMIT 1""",
                    (product_id,)).fetchone()
    if not r:
        return None, None, None
    return (r["id"],
            json.loads(r["normalized_json"]) if r["normalized_json"] else None,
            r["raw_network_json"])


def save_snapshot(con, product_id, sync_id, account_id, operator_email,
                  normalized, raw_network=None, portal_modified_by=None):
    """Write a snapshot and the field-level changes vs the previous one.
    Returns the number of changes recorded."""
    prev_id, prev, prev_raw = _latest_snapshot_row(con, product_id)
    t = now()
    raw_json = json.dumps(raw_network, ensure_ascii=False) if raw_network else None

    # Write a snapshot only when the content actually differs.
    #
    # Most products do not change between syncs, and storing a second identical ~16 kB
    # copy each time was the whole of the database's growth: a full re-sync of 129
    # accounts would have added ~42 MB whether anything changed or not. The test is the
    # SAME diff() the audit trail uses, so a snapshot is skipped only when it would have
    # produced zero changes — a change can never be lost by this.
    #
    # An unchanged product still records that it was seen: last_confirmed_at and a
    # counter on the existing row, so "we checked this on the 3rd and it was identical"
    # is still answerable. products.last_seen_at is updated by upsert_product regardless.
    if prev is not None and not diff(prev, normalized):
        con.execute("""UPDATE snapshots
                       SET last_confirmed_at=?,
                           confirmations=COALESCE(confirmations,0)+1,
                           raw_network_json=COALESCE(raw_network_json, ?)
                       WHERE id=?""", (t, raw_json, prev_id))
        return 0

    con.execute("""INSERT INTO snapshots (product_id, sync_id, captured_at,
                                          normalized_json, raw_network_json)
                   VALUES (?,?,?,?,?)""",
                (product_id, sync_id, t,
                 json.dumps(normalized, ensure_ascii=False), raw_json))
    if prev is None:
        return 0  # first sight of this product is a baseline, not a change
    rows = diff(prev, normalized)
    # If the portal itself tells us who changed it, attribute to that instead of the
    # operator who merely ran the sync. We never invent a "who".
    src = "viator_modified_by" if portal_modified_by else "diff"
    who = portal_modified_by or operator_email
    con.executemany(
        """INSERT INTO changes (product_id, sync_id, field_path, old_value, new_value,
                                detected_at, account_id, operator_email, source)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        [(product_id, sync_id, p, _s(o), _s(n), t, account_id, who, src)
         for p, o, n in rows])
    return len(rows)


def _s(v):
    if v is None or isinstance(v, str):
        return v
    return json.dumps(v, ensure_ascii=False)


# ------------------------------------------------------------------------- syncs
def start_sync(con, account_id, operator_email, host=None):
    # insert_id, not lastrowid: Postgres has no lastrowid, it needs RETURNING id.
    stamp = now()
    return store.insert_id(
        con, """INSERT INTO syncs (account_id, operator_email, started_at, status,
                                   host, heartbeat)
                VALUES (?,?,?,'running',?,?)""",
        (account_id, operator_email, stamp, host, stamp))


# A product can take PRODUCT_TIMEOUT (150s) plus a long break and a batch pause, so the
# heartbeat can legitimately go ~3 minutes quiet. 15 minutes is well clear of that while
# still releasing an account quickly if a machine dies mid-run.
STALE_SYNC_SECONDS = 900


def stale_before(seconds=STALE_SYNC_SECONDS):
    """Timestamp cutoff for 'this run has gone quiet'. now() is always UTC with a fixed
    offset, so a plain string comparison orders correctly on both backends."""
    return (datetime.now(timezone.utc)
            - timedelta(seconds=seconds)).isoformat(timespec="seconds")


def active_sync_elsewhere(con, account_id, host):
    """A run on ANOTHER machine, for this account, that is still showing signs of life."""
    return con.execute(
        """SELECT id, host, operator_email, products_seen, heartbeat FROM syncs
           WHERE account_id=? AND status='running'
             AND host IS NOT NULL AND host<>? AND heartbeat > ?
           ORDER BY id DESC LIMIT 1""",
        (account_id, host, stale_before())).fetchone()


def finish_sync(con, sync_id, status, message=None):
    con.execute("""UPDATE syncs SET finished_at=?, status=?, message=? WHERE id=?""",
                (now(), status, message, sync_id))


def bump_sync(con, sync_id, seen=0, changed=0):
    # heartbeat rides on the UPDATE that already runs once per product — same statement,
    # same round trip, so keeping the fleet honest costs nothing at capture time.
    con.execute("""UPDATE syncs SET products_seen=products_seen+?,
                   changes_found=changes_found+?, heartbeat=? WHERE id=?""",
                (seen, changed, now(), sync_id))


def mark_done(con, sync_id, code):
    # INSERT OR REPLACE is SQLite-only; ON CONFLICT is the portable form.
    con.execute(store.upsert("sync_progress", ("sync_id", "product_code", "done_at"),
                             "sync_id, product_code", ("done_at",)),
                (sync_id, code, now()))


def already_done(con, sync_id):
    return {r["product_code"] for r in con.execute(
        "SELECT product_code FROM sync_progress WHERE sync_id=?", (sync_id,))}


# --------------------------------------------------------------- people & task logging
def upsert_employee(con, email, name=None, role=None):
    """Operators are identified by the email they sign in with, so every sync can be
    attributed to a person without extra bookkeeping."""
    email = (email or "").strip().lower()
    if not email:
        return None
    con.execute("""INSERT INTO employees (email, name, role) VALUES (?,?,?)
                   ON CONFLICT(email) DO UPDATE SET
                     name=COALESCE(excluded.name, employees.name),
                     role=COALESCE(excluded.role, employees.role)""",
                (email, name or email.split("@")[0], role))
    r = con.execute("SELECT id FROM employees WHERE email=?", (email,)).fetchone()
    return r["id"] if r else None


def task_type_id(con, code):
    r = con.execute("SELECT id FROM task_types WHERE code=?", (code,)).fetchone()
    return r["id"] if r else None


def log_task(con, type_code, employee_id=None, quantity=1, when_done=None, **links):
    """Record a unit of work. Auto-logged for syncs; also used by the manual task API."""
    tid = task_type_id(con, type_code)
    if not tid:
        return None
    cols = ("task_type_id", "employee_id", "tour_id", "product_id", "platform_id",
            "account_id", "sync_id", "quantity", "status", "completed_at", "notes")
    vals = (tid, employee_id, links.get("tour_id"), links.get("product_id"),
            links.get("platform_id"), links.get("account_id"), links.get("sync_id"),
            quantity, links.get("status", "done"), when_done or now(), links.get("notes"))
    # ON CONFLICT DO NOTHING, not INSERT OR IGNORE (SQLite-only). Postgres also refuses
    # RETURNING on a skipped row, which is exactly the "did it insert?" answer we want.
    sql = store.upsert("tasks", cols, "sync_id, task_type_id, employee_id")
    if store.is_cloud():
        r = con.execute(sql + " RETURNING id", vals).fetchone()
        return r[0] if r else None
    cur = con.execute(sql, vals)
    # rowcount, not lastrowid: after an IGNORED insert lastrowid still holds the id of the
    # previous successful one, so callers counting "did this insert?" over-counted and the
    # API returned another task's id.
    return cur.lastrowid if cur.rowcount else None


def log_sync_tasks(con):
    """Turn completed syncs into task rows so the reports have real data from day one.

    Idempotency is checked EXPLICITLY rather than leaning on UNIQUE(sync_id,
    task_type_id, employee_id): SQLite treats NULLs as distinct in a unique constraint, so
    a sync whose operator_email didn't resolve to an employee slipped past it and inserted
    a fresh row every call — and this runs on every /api/reports request, so those reports
    would inflate their own task counts and payable totals a little more each page view.
    `IS` is the null-safe comparison that closes it.
    """
    tt = task_type_id(con, "AUDIT_SYNC")
    if not tt:
        return 0
    syncs = con.execute("""SELECT id, account_id, operator_email, products_seen,
                                  finished_at, started_at FROM syncs
                           WHERE products_seen > 0""").fetchall()
    if not syncs:
        return 0
    # Everything below is read ONCE up front. The previous version issued ~6 queries per
    # sync (employee upsert, existence check, account lookup, insert) — 26 syncs meant
    # ~150 round trips, and against a remote database that alone made /api/reports take
    # 16 seconds. This is 3 queries plus one insert per genuinely new row.
    known = {r["email"]: r["id"] for r in con.execute("SELECT id, email FROM employees")}
    plat = {r["id"]: r["platform_id"] for r in con.execute(
        "SELECT id, platform_id FROM accounts")}
    have = {(r["sync_id"], r["employee_id"]) for r in con.execute(
        "SELECT sync_id, employee_id FROM tasks WHERE task_type_id=?", (tt,))}
    n = 0
    for s in syncs:
        email = (s["operator_email"] or "").strip().lower()
        emp = known.get(email)
        if emp is None and email:
            emp = upsert_employee(con, email)
            known[email] = emp
        if (s["id"], emp) in have:
            continue
        if log_task(con, "AUDIT_SYNC", emp, quantity=s["products_seen"],
                    when_done=s["finished_at"] or s["started_at"], sync_id=s["id"],
                    account_id=s["account_id"],
                    platform_id=plat.get(s["account_id"]),
                    notes=f"{s['products_seen']} products captured"):
            have.add((s["id"], emp))
            n += 1
    return n


# ------------------------------------------------------------------------- reporting
def report_tours_created(con, months=12):
    return [dict(r) for r in con.execute("""
        SELECT substr(COALESCE(created_at, ''),1,7) AS month, COUNT(*) AS tours
        FROM tours WHERE created_at IS NOT NULL AND created_at <> ''
        GROUP BY 1 ORDER BY 1 DESC LIMIT ?""", (months,))]


def report_by_employee(con, since=None, until=None):
    where, args = "WHERE t.status='done'", []
    if since:
        where += f" AND {store.as_date('t.completed_at')} >= {store.as_date('?')}"
        args.append(since)
    if until:
        where += f" AND {store.as_date('t.completed_at')} <= {store.as_date('?')}"
        args.append(until)
    return [dict(r) for r in con.execute(f"""
        SELECT COALESCE(e.name, 'Unattributed') AS employee, e.email, e.role,
               COUNT(*) AS tasks, SUM(t.quantity) AS units,
               ROUND(CAST(SUM(t.quantity * tt.unit_value) AS NUMERIC), 2) AS payable
        FROM tasks t JOIN task_types tt ON tt.id=t.task_type_id
        LEFT JOIN employees e ON e.id=t.employee_id
        {where} GROUP BY t.employee_id, e.name, e.email, e.role
        ORDER BY payable DESC, tasks DESC""", args)]


def report_by_employee_type(con, since=None, until=None):
    where, args = "WHERE t.status='done'", []
    if since:
        where += f" AND {store.as_date('t.completed_at')} >= {store.as_date('?')}"
        args.append(since)
    if until:
        where += f" AND {store.as_date('t.completed_at')} <= {store.as_date('?')}"
        args.append(until)
    return [dict(r) for r in con.execute(f"""
        SELECT COALESCE(e.name,'Unattributed') AS employee, tt.code, tt.name AS task,
               COUNT(*) AS tasks, SUM(t.quantity) AS units, tt.unit_value,
               ROUND(CAST(SUM(t.quantity * tt.unit_value) AS NUMERIC), 2) AS payable
        FROM tasks t JOIN task_types tt ON tt.id=t.task_type_id
        LEFT JOIN employees e ON e.id=t.employee_id
        {where} GROUP BY t.employee_id, e.name, tt.id, tt.code, tt.name, tt.unit_value
        ORDER BY employee, payable DESC""", args)]



def blank_bucket(col, alias="p"):
    """SQL that labels a missing value by WHY it is missing, not just that it is.

    A blank means two different things and lumping them together made a deliberate design
    decision look like a data fault:
      * on a DRAFT it means "not captured" — drafts are recorded from the roster and never
        deep-fetched, and the roster carries no location at all and only partial
        connection detail. That is 169 of 374 drafts with no location.
      * on anything else it really is unknown: the portal itself had no value. Two
        products out of 743.

    Lives here rather than in each endpoint because /api/stats and /api/overview both
    group by these columns, and fixing one and not the other is exactly what happened:
    the Breakdown page said "Not captured (draft)" while the Dashboard still said
    "Unknown" for the same rows.
    """
    return (f"CASE WHEN {alias}.{col} IS NULL OR {alias}.{col}=''"
            f" THEN CASE WHEN {alias}.is_draft_stub=1 THEN 'Not captured (draft)'"
            f" ELSE 'Unknown' END"
            f" ELSE {alias}.{col} END")

def platform_matrix(con, account=None, q=None):
    """One row per tour, one column per platform, with the canonical status — and
    NOT_LISTED derived for platforms where no listing exists. That derivation is why a
    tour missing from a platform shows up instead of silently being absent."""
    plats = [dict(r) for r in con.execute(
        "SELECT id, code, name, capturable FROM platforms ORDER BY sort_order")]
    sql = """SELECT t.id AS tour_id, t.title, p.platform_id, p.id AS product_id,
                    p.product_code, p.status, p.status_canonical, p.missing_since,
                    p.is_draft_stub, a.viator_account_id AS account
             FROM tours t
             LEFT JOIN products p ON p.tour_id=t.id
             LEFT JOIN accounts a ON a.id=p.account_id
             WHERE 1=1"""
    args = []
    if account:
        sql += " AND a.viator_account_id=?"; args.append(account)
    if q:
        sql += " AND (t.title LIKE ? OR p.product_code LIKE ?)"
        args += [f"%{q}%", f"%{q}%"]
    sql += " ORDER BY t.title"
    tours = {}
    for r in con.execute(sql, args):
        row = tours.setdefault(r["tour_id"], {"tour_id": r["tour_id"], "title": r["title"],
                                              "platforms": {}})
        if r["platform_id"]:
            st = "REMOVED" if r["missing_since"] else (r["status_canonical"] or "PENDING")
            listing = {"status": st, "raw": r["status"], "product_id": r["product_id"],
                       "code": r["product_code"], "account": r["account"],
                       "is_draft_stub": bool(r["is_draft_stub"])}
            # A tour can legitimately have MORE THAN ONE listing on the same platform
            # (e.g. a live product and a draft rebuild sharing a title). Assigning the
            # cell directly meant the second one silently vanished from this view.
            cell = row["platforms"].get(r["platform_id"])
            if cell:
                # surface the "most live" status so the grid isn't misleading
                RANK = {"LIVE": 0, "PENDING": 1, "REJECTED": 2, "DRAFT": 3, "REMOVED": 4}
                if RANK.get(st, 9) < RANK.get(cell["status"], 9):
                    # The new listing takes the cell and the old one is demoted. The old
                    # code appended `listing` to others FIRST and then hung that same list
                    # off `listing["others"]`, so the cell contained itself — a cycle that
                    # made JSON encoding recurse until it blew the stack, 500ing
                    # /api/matrix for any tour with two listings on one platform.
                    others = cell.pop("others", [])
                    others.append(cell)
                    listing["others"] = others
                    row["platforms"][r["platform_id"]] = listing
                else:
                    cell.setdefault("others", []).append(listing)
            else:
                row["platforms"][r["platform_id"]] = listing
    for row in tours.values():
        for p in plats:
            row["platforms"].setdefault(p["id"], {"status": "NOT_LISTED"})
    return plats, list(tours.values())


# -------------------------------------------------------------------- manual edits
# Fields a person may override from the dashboard. Deliberately NOT the captured Viator
# facts (status, commission, pricing): changing those locally would make the audit trail
# disagree with the portal it exists to audit. These are the curation fields.
#   key -> (label, input type, group, options)
# Types drive the form widget: text | textarea | select | date.
# "captured" fields shadow a real products column, so the override sits beside the portal
# value. The rest are our own annotations, which the portal has no opinion about.
EDITABLE_FIELDS = [
    ("title",         "Title",             "text",     "Basics",   None),
    ("location",      "Location",          "text",     "Basics",   None),
    ("quality_level", "Quality",           "select",   "Basics",   ["GOOD", "POOR", "Unknown"]),
    ("summary",       "Short summary",     "textarea", "Content",  None),
    ("description",   "Full description",  "textarea", "Content",  None),
    ("highlights",    "Highlights",        "textarea", "Content",  None),
    ("meeting_point", "Meeting point",     "textarea", "Content",  None),
    ("notes",         "Internal notes",    "textarea", "Workflow", None),
    ("owner",         "Owner",             "text",     "Workflow", None),
    ("review_status", "Review status",     "select",   "Workflow",
     ["Not started", "In progress", "Needs review", "Approved", "Blocked"]),
    ("priority",      "Priority",          "select",   "Workflow",
     ["Low", "Normal", "High", "Urgent"]),
    ("next_action",   "Next action",       "text",     "Workflow", None),
    ("due_date",      "Due date",          "date",     "Workflow", None),
    ("tags",          "Tags",              "text",     "Workflow", None),
]
EDITABLE = {k: lbl for k, lbl, _t, _g, _o in EDITABLE_FIELDS}
EDITABLE_META = [{"key": k, "label": lbl, "type": t, "group": g, "options": o}
                 for k, lbl, t, g, o in EDITABLE_FIELDS]


def resolve_path(obj, path):
    """Walk a dotted path through the captured snapshot. Returns (found, value).

    This is what makes ANY captured field editable: instead of a fixed whitelist, an edit
    is accepted when its path actually exists in what we captured. So a field visible in
    the dashboard can be corrected, and a typo'd path is rejected rather than silently
    creating a phantom override nothing will ever display.
    """
    cur = obj
    for part in str(path).split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        elif isinstance(cur, list) and part.isdigit() and int(part) < len(cur):
            cur = cur[int(part)]
        else:
            return False, None
    return True, cur


def set_edit(con, product_id, field, value, editor_email, note=None):
    """Record a manual override. The captured snapshot is never touched — this is a layer
    on top, so a later sync cannot silently destroy someone's correction, and every edit
    keeps its author and timestamp.

    Supersedes rather than overwrites: the previous value stays as history."""
    email = (editor_email or "").strip().lower()
    if not email:
        raise ValueError("an editor email is required — edits must be traceable")
    emp = upsert_employee(con, email)
    row = con.execute("SELECT * FROM products WHERE id=?", (product_id,)).fetchone()
    if not row:
        raise ValueError(f"no product {product_id}")
    # Three kinds of key, all stored the same way:
    #   * a products column        -> captured value comes from the row
    #   * a dotted snapshot path   -> captured value comes from the snapshot
    #   * one of our own annotations (notes, owner, ...) -> nothing captured to compare
    if field in row.keys():
        captured = row[field]
    elif "." in str(field):
        snap = latest_snapshot(con, product_id) or {}
        found, val = resolve_path(snap, field)
        if not found:
            # The field may simply be EMPTY for this product — Viator omits keys it has no
            # value for, and whole branches (voucher, pricing) are absent on some products.
            # Adding information is the point, not just correcting it, so the check is that
            # the path is ROOTED in captured data rather than that the leaf already exists.
            # Paths are generated by the dashboard, never typed by a user, so this guards
            # against a wrong root (never displayed) rather than against typing mistakes.
            root = str(field).split(".", 1)[0]
            if not resolve_path(snap, root)[0]:
                raise ValueError(
                    f"{field!r} isn't part of this product's captured data, so an edit "
                    f"there would never be displayed")
            val = None
        captured = val if isinstance(val, str) else (
            None if val is None else json.dumps(val, ensure_ascii=False))
    elif field in EDITABLE:
        captured = None
    else:
        raise ValueError(f"{field!r} is not an editable field")
    con.execute("""UPDATE product_edits SET is_current=0
                   WHERE product_id=? AND field=? AND is_current=1""",
                (product_id, field))
    store.insert_id(con, """INSERT INTO product_edits
        (product_id, field, value, captured_value, editor_email, editor_id, edited_at,
         note, is_current) VALUES (?,?,?,?,?,?,?,?,1)""",
        (product_id, field, value, str(captured) if captured is not None else None,
         email, emp, now(), note))
    log_task(con, "QUALITY_FIX", emp, product_id=product_id,
             notes=f"edited {field}")
    return {"field": field, "value": value, "editor_email": email}


def edits_for(con, product_id):
    """{field: {...}} of the CURRENT overrides, plus the full history."""
    cur, hist = {}, []
    for r in con.execute("""SELECT * FROM product_edits WHERE product_id=?
                            ORDER BY id DESC""", (product_id,)):
        d = dict(r)
        hist.append(d)
        if r["is_current"] and r["field"] not in cur:
            cur[r["field"]] = d
    return cur, hist


def apply_edits(con, rows):
    """Overlay current edits onto product rows for display. Each overridden field also
    carries who changed it, so the UI can badge it rather than passing it off as
    captured data."""
    if not rows:
        return rows
    ids = [r["id"] for r in rows]
    marks = ",".join("?" for _ in ids)
    by = {}
    for r in con.execute(f"""SELECT product_id, field, value, editor_email, edited_at
                             FROM product_edits WHERE is_current=1
                             AND product_id IN ({marks})""", ids):
        by.setdefault(r["product_id"], {})[r["field"]] = dict(r)
    for row in rows:
        e = by.get(row["id"])
        if not e:
            continue
        row["_edited"] = {}
        for field, info in e.items():
            row["_edited"][field] = {"captured": row.get(field),
                                     "by": info["editor_email"], "at": info["edited_at"]}
            row[field] = info["value"]
    return rows


def demo():
    """Self-check for the two pieces of non-trivial logic: flatten + diff."""
    f = flatten({"a": {"b": [1, 2]}, "c": "x"})
    assert f == {"a.b[=1]": 1, "a.b[=2]": 2, "c": "x"}, f
    # list of dicts keyed by identity, so reordering is NOT a change
    l1 = {"opts": [{"productCode": "P1", "v": 1}, {"productCode": "P2", "v": 2}]}
    l2 = {"opts": [{"productCode": "P2", "v": 2}, {"productCode": "P1", "v": 1}]}
    assert diff(l1, l2) == [], diff(l1, l2)
    # scalar lists are sets: reordering is not a change, but add/remove is
    assert diff({"t": ["A", "B"]}, {"t": ["B", "A"]}) == [], diff({"t": ["A", "B"]}, {"t": ["B", "A"]})
    assert diff({"t": ["A"]}, {"t": ["A", "B"]}) == [("t[=B]", None, "B")]
    assert diff({"t": ["A", "B"]}, {"t": ["A"]}) == [("t[=B]", "B", None)]
    # repeats are disambiguated by occurrence, and the scheme never flips
    assert flatten({"t": ["A", "A"]}) == {"t[=A]": "A", "t[=A#2]": "A"}, flatten({"t": ["A", "A"]})
    assert diff({"t": ["A", "A"]}, {"t": ["A", "B"]}) == [
        ("t[=A#2]", "A", None), ("t[=B]", None, "B")], diff({"t": ["A", "A"]}, {"t": ["A", "B"]})
    # reordering a list that contains repeats is still not a change
    assert diff({"t": ["A", "B", "A"]}, {"t": ["A", "A", "B"]}) == []
    # lists of dicts with no classic id field still resolve an identity, so the many
    # real shapes here (start times, pickup points, media, cut-offs) survive reordering
    st = {"t": [{"startTime": "10:00"}, {"startTime": "13:00"}]}
    assert diff(st, {"t": list(reversed(st["t"]))}) == [], diff(st, {"t": list(reversed(st["t"]))})
    md = {"m": [{"mediaRef": "IMG-1", "sortOrder": 0}, {"mediaRef": "IMG-2", "sortOrder": 1}]}
    assert diff(md, {"m": list(reversed(md["m"]))}) == []
    # ...but a real edit inside an identified item is still reported, with old -> new
    md2 = {"m": [{"mediaRef": "IMG-1", "sortOrder": 5}, {"mediaRef": "IMG-2", "sortOrder": 1}]}
    assert diff(md, md2) == [("m[IMG-1].sortOrder", 0, 5)], diff(md, md2)
    # a genuine add/remove is still caught
    assert diff(st, {"t": [{"startTime": "10:00"}]}) == [("t[13:00].startTime", "13:00", None)]
    # items with NO scalar field keep their position (measured: content-hashing them
    # amplified nested edits into whole-subtree rewrites), so an edit still pairs old->new
    blob = {"t": [{"a": [1]}, {"a": [2]}]}
    assert diff(blob, {"t": [{"a": [1]}, {"a": [3]}]}) == [("t[1].a[=2]", 2, None),
                                                           ("t[1].a[=3]", None, 3)], \
        diff(blob, {"t": [{"a": [1]}, {"a": [3]}]})
    # a real value change is caught, with old and new
    assert diff({"a": 1}, {"a": 2}) == [("a", 1, 2)]
    # added and removed fields
    assert diff({}, {"a": 1}) == [("a", None, 1)]
    assert diff({"a": 1}, {}) == [("a", 1, None)]
    # volatile paths ignored
    assert diff({"trackingData": {"sessionId": "a"}}, {"trackingData": {"sessionId": "b"}}) == []
    # our own timestamped artifact dir must never show up as a product change
    assert diff({"_capture": {"artifacts_dir": "a"}}, {"_capture": {"artifacts_dir": "b"}}) == []
    # ...but a real field whose name merely CONTAINS a volatile word is still tracked
    assert diff({"product": {"metadataVersion": 1}},
                {"product": {"metadataVersion": 2}}) == [("product.metadataVersion", 1, 2)]
    assert diff({"product": {"requestedSeats": 1}},
                {"product": {"requestedSeats": 2}}) == [("product.requestedSeats", 1, 2)]
    # nested change reports the full dotted path
    assert diff({"p": {"q": "old"}}, {"p": {"q": "new"}}) == [("p.q", "old", "new")]
    # session() must close the connection, not just commit
    init()
    with session() as c:
        c.execute("SELECT 1")
    # "Closed" means different things per engine: SQLite really closes the file handle,
    # Postgres RELEASES the connection back to the pool (the socket stays open, by design).
    # Asserting the SQLite behaviour on both was a wrong test, not a leak.
    if store.is_cloud():
        assert getattr(c, "closed", False), "session() did not release the pooled connection"
    else:
        try:
            c.execute("SELECT 1")
            raise AssertionError("connection was left open by session()")
        except sqlite3.ProgrammingError:
            pass

    # task logging: idempotent even when the operator doesn't resolve to an employee.
    # A NULL employee_id is DISTINCT under the UNIQUE constraint, and log_sync_tasks runs
    # on every /api/reports request, so without the explicit check the reports inflated
    # their own totals once per page view.
    m = sqlite3.connect(":memory:")
    m.row_factory = sqlite3.Row
    m.executescript(SCHEMA)
    m.execute("ALTER TABLE accounts ADD COLUMN platform_id INTEGER")   # from init()
    seed_reference(m)
    m.execute("INSERT INTO accounts (id, viator_account_id) VALUES (1,'X')")
    m.execute("""INSERT INTO syncs (id, account_id, operator_email, status, products_seen)
                 VALUES (1,1,'someone@example.com','done',5), (2,1,'','done',3)""")
    for _ in range(3):
        log_sync_tasks(m)
    for sid, who in ((1, "an attributed sync"), (2, "an UNattributed sync")):
        n = m.execute("SELECT COUNT(*) FROM tasks WHERE sync_id=?", (sid,)).fetchone()[0]
        assert n == 1, f"{who} produced {n} task rows after 3 calls, expected 1"
    # an ignored insert must report that it inserted nothing, not the previous row's id
    emp = upsert_employee(m, "someone@example.com")
    assert log_task(m, "AUDIT_SYNC", emp, sync_id=1) is None, \
        "log_task returned a stale id for a row it did not insert"
    assert log_task(m, "AUDIT_SYNC", emp, sync_id=3), "a genuinely new task must return id"
    m.close()
    print("db selfcheck ok")


if __name__ == "__main__":
    demo()
