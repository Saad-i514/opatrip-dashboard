"""The SQLite schema, ported to Postgres, plus the edit/audit tables.

Kept separate from db.py so the DDL is readable as one piece and can be applied to a
fresh Supabase project without importing the app.

Differences from the SQLite version, and why:
  * INTEGER PRIMARY KEY -> BIGSERIAL (SQLite aliases rowid; Postgres needs a sequence)
  * is_draft_stub / capturable / is_active stay INTEGER rather than BOOLEAN, so the
    existing SUM(is_draft_stub) aggregates keep working unchanged
  * TEXT timestamps are kept as TEXT, deliberately: every value already stored is an ISO
    string written by db.now(), and converting them would silently reinterpret any row
    whose format differs. Comparisons in the app use substr()/::date, which work on TEXT.
"""

SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
  id BIGSERIAL PRIMARY KEY,
  viator_account_id TEXT UNIQUE NOT NULL,
  name              TEXT,
  country           TEXT,
  signin_email      TEXT,
  profile_dir       TEXT,
  last_sync_at      TEXT,
  created_at        TEXT DEFAULT (now()::text),
  platform_id       BIGINT
);
CREATE TABLE IF NOT EXISTS platforms (
  id BIGSERIAL PRIMARY KEY,
  code       TEXT UNIQUE NOT NULL,
  name       TEXT,
  capturable INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS statuses (
  code       TEXT PRIMARY KEY,
  label      TEXT,
  badge      TEXT,
  sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS status_map (
  platform_id BIGINT NOT NULL REFERENCES platforms(id),
  raw         TEXT NOT NULL,
  canonical   TEXT NOT NULL REFERENCES statuses(code),
  PRIMARY KEY (platform_id, raw)
);
CREATE TABLE IF NOT EXISTS employees (
  id BIGSERIAL PRIMARY KEY,
  name       TEXT,
  email      TEXT UNIQUE,
  role       TEXT DEFAULT 'Quality Manager',
  is_active  INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (now()::text)
);
CREATE TABLE IF NOT EXISTS tours (
  id BIGSERIAL PRIMARY KEY,
  tour_key   TEXT UNIQUE,
  title      TEXT,
  created_at TEXT DEFAULT (now()::text),
  created_by BIGINT REFERENCES employees(id),
  notes      TEXT
);
CREATE TABLE IF NOT EXISTS syncs (
  id BIGSERIAL PRIMARY KEY,
  account_id      BIGINT NOT NULL REFERENCES accounts(id),
  operator_email  TEXT NOT NULL,
  portal_email    TEXT,
  portal_user_ref TEXT,
  started_at      TEXT,
  finished_at     TEXT,
  status          TEXT,
  message         TEXT,
  products_seen   INTEGER DEFAULT 0,
  changes_found   INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  account_id       BIGINT NOT NULL REFERENCES accounts(id),
  product_code     TEXT NOT NULL,
  title            TEXT,
  status           TEXT,
  connection_state TEXT,
  quality_level    TEXT,
  location         TEXT,
  is_draft_stub    INTEGER DEFAULT 0,
  thumbnail_url    TEXT,
  thumbnail_path   TEXT,
  first_seen_at    TEXT,
  last_seen_at     TEXT,
  missing_since    TEXT,
  platform_id      BIGINT,
  tour_id          BIGINT,
  status_canonical TEXT,
  UNIQUE(account_id, product_code)
);
CREATE TABLE IF NOT EXISTS product_images (
  id BIGSERIAL PRIMARY KEY,
  product_id  BIGINT NOT NULL REFERENCES products(id),
  source_url  TEXT NOT NULL,
  local_path  TEXT,
  position    INTEGER,
  image_ref   TEXT,
  captured_at TEXT,
  r2_key      TEXT,          -- object key in the R2 bucket, once uploaded
  bytes       BIGINT,
  is_manual   INTEGER DEFAULT 0,   -- 1 = uploaded by a person, not captured from Viator
  added_by    TEXT,                -- editor email, for the same traceability as edits
  caption     TEXT,
  UNIQUE(product_id, source_url)
);
CREATE TABLE IF NOT EXISTS snapshots (
  id BIGSERIAL PRIMARY KEY,
  product_id       BIGINT NOT NULL REFERENCES products(id),
  sync_id          BIGINT NOT NULL REFERENCES syncs(id),
  captured_at      TEXT,
  normalized_json  TEXT,
  raw_network_json TEXT
);
CREATE TABLE IF NOT EXISTS changes (
  id BIGSERIAL PRIMARY KEY,
  product_id     BIGINT NOT NULL REFERENCES products(id),
  sync_id        BIGINT NOT NULL REFERENCES syncs(id),
  field_path     TEXT,
  old_value      TEXT,
  new_value      TEXT,
  detected_at    TEXT,
  account_id     BIGINT REFERENCES accounts(id),
  operator_email TEXT,
  source         TEXT
);
CREATE TABLE IF NOT EXISTS sync_progress (
  sync_id      BIGINT NOT NULL REFERENCES syncs(id),
  product_code TEXT NOT NULL,
  done_at      TEXT,
  PRIMARY KEY (sync_id, product_code)
);
CREATE TABLE IF NOT EXISTS task_types (
  id BIGSERIAL PRIMARY KEY,
  code       TEXT UNIQUE NOT NULL,
  name       TEXT,
  unit_value REAL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tasks (
  id BIGSERIAL PRIMARY KEY,
  task_type_id BIGINT NOT NULL REFERENCES task_types(id),
  employee_id  BIGINT REFERENCES employees(id),
  tour_id      BIGINT REFERENCES tours(id),
  product_id   BIGINT REFERENCES products(id),
  platform_id  BIGINT REFERENCES platforms(id),
  account_id   BIGINT REFERENCES accounts(id),
  sync_id      BIGINT REFERENCES syncs(id),
  quantity     REAL DEFAULT 1,
  status       TEXT DEFAULT 'done',
  completed_at TEXT,
  notes        TEXT,
  created_at   TEXT DEFAULT (now()::text),
  UNIQUE(sync_id, task_type_id, employee_id)
);

-- ------------------------------------------------------------------ manual edits
-- Edits are an OVERRIDE LAYER, never a rewrite of the captured snapshot. The portal
-- remains the source of truth for what Viator says; this records what a person changed,
-- who they were and when. A later sync therefore cannot silently destroy someone's work,
-- and an edit can always be traced or undone.
CREATE TABLE IF NOT EXISTS product_edits (
  id BIGSERIAL PRIMARY KEY,
  product_id    BIGINT NOT NULL REFERENCES products(id),
  field         TEXT NOT NULL,      -- 'title', 'location', 'notes', ...
  value         TEXT,               -- the human-entered value (NULL clears the override)
  captured_value TEXT,              -- what the portal said at the time, for comparison
  editor_email  TEXT NOT NULL,      -- traceability: who made this edit
  editor_id     BIGINT REFERENCES employees(id),
  edited_at     TEXT NOT NULL,
  note          TEXT,
  is_current    INTEGER DEFAULT 1   -- 0 once superseded, so history is kept in full
);
CREATE INDEX IF NOT EXISTS idx_edits_product ON product_edits(product_id, field);
CREATE INDEX IF NOT EXISTS idx_edits_current ON product_edits(is_current, edited_at);

CREATE INDEX IF NOT EXISTS idx_tasks_emp ON tasks(employee_id, completed_at);
CREATE INDEX IF NOT EXISTS idx_changes_product ON changes(product_id, detected_at);
CREATE INDEX IF NOT EXISTS idx_snap_product ON snapshots(product_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_products_account ON products(account_id);
CREATE INDEX IF NOT EXISTS idx_products_tour ON products(tour_id);
CREATE INDEX IF NOT EXISTS idx_products_platform ON products(platform_id);
"""

# Order matters: parents before children, so a truncate/restore respects the FKs.
TABLES = ["platforms", "statuses", "status_map", "employees", "accounts", "tours",
          "syncs", "products", "product_images", "snapshots", "changes",
          "sync_progress", "task_types", "tasks", "product_edits"]

# Tables whose id column is a BIGSERIAL whose sequence must be re-synced after a migration
# that inserts explicit ids — otherwise the very next insert collides on the primary key.
SERIAL_TABLES = ["platforms", "employees", "accounts", "tours", "syncs", "products",
                 "product_images", "snapshots", "changes", "task_types", "tasks",
                 "product_edits"]


# CREATE TABLE IF NOT EXISTS cannot add a column to a table that already exists, so new
# columns are applied separately. Postgres supports IF NOT EXISTS on ADD COLUMN, making
# this safe to run on every start.
MIGRATIONS = """
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS is_manual INTEGER DEFAULT 0;
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS added_by TEXT;
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS caption TEXT;
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS r2_key TEXT;
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS bytes BIGINT;
-- Which machine is running this sync, and when it last showed a sign of life. With one
-- machine these were unnecessary; with a fleet sharing one database they are what stops
-- each machine treating every other machine's live run as its own abandoned leftover.
-- A snapshot is now written only when the content actually differs from the previous
-- one. These two record the runs that saw it unchanged, so "when did we last confirm
-- this?" is still answerable without storing a duplicate copy per sync.
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS last_confirmed_at TEXT;
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS confirmations INTEGER DEFAULT 0;
ALTER TABLE syncs ADD COLUMN IF NOT EXISTS host TEXT;
ALTER TABLE syncs ADD COLUMN IF NOT EXISTS heartbeat TEXT;
CREATE INDEX IF NOT EXISTS idx_syncs_running ON syncs(status, host);
"""


def apply(con):
    con.execute(SCHEMA)
    con.execute(MIGRATIONS)


def resync_sequences(con):
    """Point each id sequence past the highest existing id."""
    for t in SERIAL_TABLES:
        con.execute(f"""SELECT setval(pg_get_serial_sequence('{t}','id'),
                        COALESCE((SELECT MAX(id) FROM {t}), 1),
                        (SELECT MAX(id) IS NOT NULL FROM {t}))""")
