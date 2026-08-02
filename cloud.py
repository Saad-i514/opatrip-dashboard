"""Cloud backends: Supabase Postgres for all textual data, Cloudflare R2 for images.

Config comes from audit/.env so no secret is ever in source. Both helpers are lazy — the
app still imports cleanly on a machine with no credentials, and says so instead of
crashing at import time.
"""
import os
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ENV_PATH = ROOT / ".env"


def load_env(path=ENV_PATH):
    """Minimal .env reader. A dependency for `KEY=value` would be silly, and this also
    refuses to clobber a variable the real environment already set (so a CI/prod value
    always wins over the file)."""
    if not Path(path).is_file():
        return {}
    out = {}
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        k, v = k.strip(), v.strip()
        # strip a trailing inline comment, but only when it is clearly one — a '#' inside
        # a password is a legal character and must survive
        if " #" in v:
            v = v.split(" #", 1)[0].strip()
        v = v.strip('"').strip("'")
        out[k] = v
        os.environ.setdefault(k, v)
    return out


ENV = load_env()


def cfg(key, default=None):
    return os.environ.get(key, default)


# --------------------------------------------------------------------------- Postgres
_pool_lock = threading.Lock()
_pool = None


def dsn():
    return cfg("SUPABASE_DB_URL")


def local_only():
    """Escape hatch: force the local SQLite backend even when cloud creds are present.

    Set VIATOR_AUDIT_LOCAL_ONLY=1. Needed because test suites that write fixtures would
    otherwise run against the live Supabase project — one of them reconciles a fabricated
    roster, which flags real products as "missing". Also handy for working offline.
    """
    return os.environ.get("VIATOR_AUDIT_LOCAL_ONLY", "").strip() in ("1", "true", "yes")


def pg_available():
    return bool(dsn()) and not local_only()


# Connections are the one resource a FLEET shares. Supabase allows 60 in total and keeps
# ~14 for itself, leaving ~46 for us, so the ceiling is per-machine x number of machines:
#
#     max_size=8 -> 17 machines need 136   (the old default: refuses connections)
#     max_size=2 -> 17 machines need  34   (fits, with room to spare)
#
# Measured cost of the smaller pool on a 6-request dashboard burst: 3214 ms vs 2947 ms,
# i.e. within run-to-run noise. Dropping to 1 is NOT noise — 4815 ms, 63% slower — because
# a running sync holds one connection for its whole run and would leave the UI none.
# Raise it with AUDIT_PG_POOL_MAX if this machine is the only one using the database.
POOL_MAX = max(1, int(os.environ.get("AUDIT_PG_POOL_MAX", "2")))


def pg_pool():
    """One shared connection pool. Supabase sits behind a network round trip, so opening a
    fresh connection per request (fine for a local SQLite file) would dominate every
    dashboard load."""
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                if not dsn():
                    raise RuntimeError(
                        "SUPABASE_DB_URL is not set — add it to audit/.env")
                from psycopg_pool import ConnectionPool
                # min_size=0: an idle machine should hold nothing. With 17 of them, a
                # floor of 1 each pinned 17 connections around the clock for no work.
                _pool = ConnectionPool(dsn(), min_size=0, max_size=POOL_MAX, timeout=30,
                                       kwargs={"autocommit": False}, open=True)
    return _pool


# --------------------------------------------------------------------------------- R2
_s3 = None


def r2_bucket():
    return cfg("R2_BUCKET")


def r2_available():
    return bool(cfg("R2_ENDPOINT") and cfg("R2_ACCESS_KEY_ID")
                and cfg("R2_SECRET_ACCESS_KEY") and r2_bucket())


def r2():
    """S3-compatible client for Cloudflare R2.

    region_name='auto' and the SigV4 signer are both required: R2 rejects the default
    signature version, and boto3 will not sign at all without a region.
    """
    global _s3
    if _s3 is None:
        if not r2_available():
            raise RuntimeError("R2 credentials are incomplete — check audit/.env")
        import boto3
        from botocore.config import Config
        _s3 = boto3.client(
            "s3", endpoint_url=cfg("R2_ENDPOINT"),
            aws_access_key_id=cfg("R2_ACCESS_KEY_ID"),
            aws_secret_access_key=cfg("R2_SECRET_ACCESS_KEY"),
            region_name="auto",
            config=Config(signature_version="s3v4", retries={"max_attempts": 5,
                                                             "mode": "standard"}))
    return _s3


def r2_key(account, product_code, position, ext=".jpg"):
    """Stable, collision-free object key. Deriving it from identity rather than a random
    name means re-uploading the same image overwrites instead of duplicating."""
    safe = lambda s: "".join(c if (c.isalnum() or c in "._-") else "_" for c in str(s))[:80]
    return f"{safe(account)}/{safe(product_code)}/{int(position):02d}{ext}"


def r2_put(key, data, content_type="image/jpeg"):
    r2().put_object(Bucket=r2_bucket(), Key=key, Body=data, ContentType=content_type)
    return key


def r2_exists(key):
    from botocore.exceptions import ClientError
    try:
        r2().head_object(Bucket=r2_bucket(), Key=key)
        return True
    except ClientError:
        return False


def r2_get(key):
    return r2().get_object(Bucket=r2_bucket(), Key=key)["Body"].read()


def r2_url(key, expires=3600):
    """Presigned GET. The bucket stays private — the dashboard gets a short-lived link
    rather than the bucket being made public."""
    return r2().generate_presigned_url(
        "get_object", Params={"Bucket": r2_bucket(), "Key": key}, ExpiresIn=expires)


def status():
    """What is configured and actually reachable — used by the dashboard banner."""
    out = {"postgres": {"configured": pg_available(), "ok": False, "detail": ""},
           "r2": {"configured": r2_available(), "ok": False, "detail": ""}}
    if pg_available():
        try:
            with pg_pool().connection() as con:
                v = con.execute("SELECT version()").fetchone()[0]
            out["postgres"].update(ok=True, detail=v.split(",")[0])
        except Exception as e:
            out["postgres"]["detail"] = f"{e!r}"[:200]
    if r2_available():
        try:
            r2().head_bucket(Bucket=r2_bucket())
            out["r2"].update(ok=True, detail=f"bucket {r2_bucket()}")
        except Exception as e:
            out["r2"]["detail"] = f"{e!r}"[:200]
    return out


if __name__ == "__main__":
    import json
    print(json.dumps(status(), indent=2))
