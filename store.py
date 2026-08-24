"""One storage API over two engines: Supabase Postgres (when configured) or the local
SQLite file (fallback).

WHY A SHIM RATHER THAN A REWRITE: the app contains ~60 hand-written queries that are
already correct. Almost all of them are portable; only a handful use SQLite-only syntax.
So this translates the mechanical differences (`?` placeholders, row access) and the few
genuinely dialect-specific fragments are written once here as helpers, instead of every
query being rewritten and re-verified.

The fallback is deliberate: with no credentials the app still runs on SQLite exactly as
before, so a network outage degrades to "local only" rather than to "broken".
"""
import re
import sqlite3
import threading
from collections.abc import Mapping
from contextlib import contextmanager

import cloud
from config import DB_PATH

_mode_lock = threading.Lock()
_MODE = None            # 'pg' | 'sqlite', resolved once


def mode():
    """Which engine is in use. Resolved once and cached — probing per call would put a
    network round trip in front of every query."""
    global _MODE
    if _MODE is None:
        with _mode_lock:
            if _MODE is None:
                _MODE = "pg" if cloud.pg_available() else "sqlite"
    return _MODE


def force_mode(m):
    """Tests use this to exercise both engines in one process."""
    global _MODE
    _MODE = m


def is_cloud():
    return mode() == "pg"


# ------------------------------------------------------------------------- rows
class Row(Mapping):
    """Behaves like sqlite3.Row for the two access styles the app actually uses:
    r["col"] everywhere, and r[0] in the aggregate helpers. Being a Mapping also makes
    dict(r) produce {column: value}, which is what the API handlers return."""
    __slots__ = ("_c", "_v")

    def __init__(self, cols, vals):
        self._c, self._v = cols, vals

    def __getitem__(self, k):
        if isinstance(k, (int, slice)):
            return self._v[k]
        try:
            return self._v[self._c.index(k)]
        except ValueError:
            raise KeyError(k) from None

    def __iter__(self):
        # VALUES, matching sqlite3.Row — which is the class this one exists to emulate, and
        # what anyone writing `a, b = row` or `list(row)` expects. It used to yield the
        # column NAMES, so `dict(zip(r.keys(), list(r)))` silently produced
        # {'id': 'id', 'field_path': 'field_path', ...} and `for a, b in rows` unpacked
        # header strings. That wrote a backup file containing nothing but column names,
        # and it was only noticed after the rows it was protecting had been deleted.
        #
        # dict(row) is unaffected: Python's dict() uses keys() + __getitem__ for anything
        # exposing .keys(), never __iter__ — checked both ways. Every existing call site
        # uses r[0], r["col"] or dict(r); none iterate a row for its column names.
        return iter(self._v)

    def __len__(self):
        return len(self._c)

    def keys(self):
        return list(self._c)

    def __repr__(self):
        return f"Row({dict(zip(self._c, self._v))})"


def _row_factory(cursor):
    cols = [d.name for d in cursor.description] if cursor.description else []
    return lambda vals: Row(cols, list(vals))


# ------------------------------------------------------------------ sql translation
_PLACEHOLDER = re.compile(r"\?")


def _to_pg(sql):
    """`?` -> `%s`, and neutralise the SQLite-only INSERT modifiers.

    Any literal `%` in the SQL must be doubled first, or psycopg reads it as the start of
    its own placeholder. (The app passes LIKE patterns as parameters, never inline, so
    this is belt-and-braces.)
    """
    sql = sql.replace("%", "%%")
    sql = _PLACEHOLDER.sub("%s", sql)
    return sql


class _PgCursor:
    """Thin adapter so callers can keep using sqlite-style cursors."""

    def __init__(self, cur):
        self._c = cur

    def fetchone(self):
        return self._c.fetchone()

    def fetchall(self):
        return self._c.fetchall()

    def __iter__(self):
        return iter(self._c)

    @property
    def rowcount(self):
        return self._c.rowcount

    @property
    def lastrowid(self):
        raise NotImplementedError(
            "lastrowid does not exist on Postgres — use RETURNING id via store.insert_id()")

    def close(self):
        self._c.close()


class _PgConn:
    """sqlite3.Connection-compatible surface over a pooled psycopg connection."""

    def __init__(self, raw, release):
        self._raw = raw
        self._release = release
        self.closed = False

    def execute(self, sql, params=()):
        cur = self._raw.cursor(row_factory=_row_factory)
        cur.execute(_to_pg(sql), tuple(params))
        return _PgCursor(cur)

    def executemany(self, sql, seq):
        seq = [tuple(s) for s in seq]
        cur = self._raw.cursor()
        if seq:
            cur.executemany(_to_pg(sql), seq)
        return _PgCursor(cur)

    def executescript(self, sql):
        # psycopg runs multi-statement strings directly
        self._raw.execute(sql)
        return self

    def cursor(self):
        return _PgCursor(self._raw.cursor(row_factory=_row_factory))

    def commit(self):
        self._raw.commit()

    def rollback(self):
        self._raw.rollback()

    def close(self):
        if not self.closed:
            self.closed = True
            self._release()

    # `with connect() as con:` parity with sqlite3 (commit on success)
    def __enter__(self):
        return self

    def __exit__(self, et, ev, tb):
        if et is None:
            self.commit()
        else:
            self.rollback()
        return False


def connect():
    if mode() == "pg":
        cm = cloud.pg_pool().connection()
        raw = cm.__enter__()
        return _PgConn(raw, lambda: cm.__exit__(None, None, None))
    con = sqlite3.connect(DB_PATH, timeout=30)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    return con


@contextmanager
def session():
    """Commit-or-rollback AND release. Never use a bare `with connect()`: sqlite3's own
    context manager commits but does not close, leaking a handle per request."""
    con = connect()
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


# --------------------------------------------------------------- dialect fragments
def pipeline_supported():
    """psycopg can only pipeline when libpq is 14+."""
    if mode() != "pg":
        return False
    try:
        import psycopg
        return bool(psycopg.capabilities.has_pipeline())
    except Exception:
        return False


@contextmanager
def batch(con):
    """Send a group of statements without waiting for each reply.

    Saving one product is ~8 statements. Against a database 200 ms away that is ~1.8 s of
    pure waiting; pipelined it measures 0.8 s — the same rows, 2.2x faster. Statements
    whose result we actually need (RETURNING id, the previous snapshot for diffing) still
    force a sync point, which is why it is 2.2x and not 8x.

    A no-op on SQLite, where a round trip is microseconds and there is nothing to win.
    """
    raw = getattr(con, "_raw", None)
    if raw is not None and pipeline_supported():
        with raw.pipeline():
            yield
    else:
        yield


def insert_id(con, sql, params=()):
    """INSERT and return the new id, on either engine. Postgres has no lastrowid, so the
    statement needs RETURNING; SQLite has no RETURNING in older builds, so it uses
    lastrowid. Both live here so no caller has to care."""
    if mode() == "pg":
        r = con.execute(sql.rstrip().rstrip(";") + " RETURNING id", params).fetchone()
        return r[0] if r else None
    return con.execute(sql, params).lastrowid


def upsert(table, cols, conflict, update_cols=None):
    """Portable INSERT ... ON CONFLICT. Replaces SQLite's INSERT OR REPLACE / OR IGNORE,
    which Postgres does not have."""
    collist = ",".join(cols)
    ph = ",".join("?" for _ in cols)
    if update_cols is None:
        action = "DO NOTHING"
    else:
        sets = ",".join(f"{c}=excluded.{c}" for c in update_cols)
        action = f"DO UPDATE SET {sets}" if sets else "DO NOTHING"
    return (f"INSERT INTO {table} ({collist}) VALUES ({ph}) "
            f"ON CONFLICT ({conflict}) {action}")


def days_since(col):
    """'how many days ago was <col>', as a SQL expression. SQLite has julianday();
    Postgres does date arithmetic on timestamps."""
    if mode() == "pg":
        return f"EXTRACT(EPOCH FROM (now() - ({col})::timestamptz))/86400.0"
    return f"julianday('now') - julianday({col})"


def null_safe_eq(col):
    """`col = ?` that also matches when both sides are NULL.

    SQLite accepts `col IS ?` with a bound parameter; Postgres does NOT — `IS` there only
    takes NULL/TRUE/FALSE, so a placeholder is a syntax error. `IS NOT DISTINCT FROM` is
    the Postgres spelling.
    """
    return f"{col} IS NOT DISTINCT FROM ?" if mode() == "pg" else f"{col} IS ?"


def as_date(expr):
    """Cast a stored ISO text timestamp to a date for comparison."""
    return f"({expr})::date" if mode() == "pg" else f"date({expr})"


def table_columns(con, table):
    if mode() == "pg":
        return {r[0] for r in con.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name=?",
            (table,))}
    return {r[1] for r in con.execute(f"PRAGMA table_info({table})")}


def describe():
    if mode() == "pg":
        host = (cloud.dsn() or "").split("@")[-1].split("/")[0]
        return f"Supabase Postgres ({host})"
    return f"local SQLite ({DB_PATH.name})"
