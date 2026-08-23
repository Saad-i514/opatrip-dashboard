"""Sign-in, roles and per-user data scope, on Supabase's own auth service.

WHY Supabase Auth rather than a users table here: password hashing, session tokens,
rotation and expiry are the parts of an auth system that are dangerous to hand-roll, and
the project already depends on Supabase. Nothing about passwords is stored or verified by
this code — it asks Supabase and believes the answer.

Two keys, two very different jobs:
  * SUPABASE_PUBLISHABLE_KEY — safe in a browser. Used to exchange an email + password
    for a token. That is all it can do.
  * SUPABASE_SECRET_KEY      — server-side only. Creates, edits and deletes users.
    It never leaves this process, and no endpoint returns it.

WHERE A USER'S ROLE LIVES: `app_metadata`. That matters. Supabase lets a signed-in user
edit their OWN `user_metadata`, but `app_metadata` can only be written with the secret
key. Putting the role in user_metadata would let any member promote themselves to admin
with one request.

    app_metadata = {"role": "admin" | "member",
                    "name": "Maniha Hussain",
                    "scope": "all" | "own"}

  role  — admin can manage users; member cannot.
  scope — all: sees every account. own: sees only the accounts they have captured
          themselves, which is derived from syncs.operator_email, not from a list someone
          has to keep up to date.
"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

import cloud

TIMEOUT = 25
ROLES = ("admin", "member")
SCOPES = ("all", "own")

# Verifying a token means asking Supabase, which is a round trip to another region. The
# dashboard polls /api/status every 2s, so an uncached check would add ~200ms to every
# poll for no benefit. 60s is short enough that deleting a user takes effect promptly and
# long enough that normal use costs almost nothing.
_TOKEN_TTL = 60
_token_cache = {}


class AuthError(Exception):
    """Bad credentials, an expired token, or auth not configured."""


def base_url():
    u = cloud.cfg("SUPABASE_URL") or ""
    return u.rstrip("/")


def enabled():
    """False when the keys are absent — the app then runs open, as it did before.

    Deliberately not a hard failure: a developer running this against a local SQLite copy
    with no .env should still get a working dashboard.
    """
    return bool(base_url() and cloud.cfg("SUPABASE_PUBLISHABLE_KEY")
                and cloud.cfg("SUPABASE_SECRET_KEY"))


def _call(path, key, token=None, method="GET", body=None):
    req = urllib.request.Request(base_url() + path, method=method)
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {token or key}")
    data = None
    if body is not None:
        req.add_header("Content-Type", "application/json")
        data = json.dumps(body).encode()
    try:
        with urllib.request.urlopen(req, data, timeout=TIMEOUT) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            payload = json.loads(e.read() or b"{}")
            detail = (payload.get("msg") or payload.get("error_description")
                      or payload.get("message") or payload.get("error") or "")
        except Exception:
            pass
        raise AuthError(detail or f"Supabase auth returned {e.code}") from None
    except urllib.error.URLError as e:
        raise AuthError(f"could not reach Supabase auth: {e.reason}") from None


def _pub():
    return cloud.cfg("SUPABASE_PUBLISHABLE_KEY")


def _secret():
    return cloud.cfg("SUPABASE_SECRET_KEY")


# ------------------------------------------------------------------ shape of a user
def shape(u):
    """The public view of a user. No tokens, no password data, ever."""
    meta = (u or {}).get("app_metadata") or {}
    email = (u or {}).get("email") or ""
    role = meta.get("role") if meta.get("role") in ROLES else "member"
    scope = meta.get("scope") if meta.get("scope") in SCOPES else "own"
    return {
        "id": (u or {}).get("id"),
        "email": email,
        # Falling back to the local part of the email means a user always has something
        # to be called, even if whoever created them left the name blank.
        "name": (meta.get("name") or "").strip() or email.split("@")[0] or "unknown",
        "role": role,
        # An admin sees everything by definition; storing anything else for them would be
        # a second source of truth that could disagree with the role.
        "scope": "all" if role == "admin" else scope,
        "created_at": (u or {}).get("created_at"),
        "last_sign_in_at": (u or {}).get("last_sign_in_at"),
    }


# ------------------------------------------------------------------ signing in
def sign_in(email, password):
    """Exchange an email + password for a session. Raises AuthError if they're wrong."""
    if not enabled():
        raise AuthError("sign-in is not configured on this server")
    out = _call("/auth/v1/token?grant_type=password", _pub(), method="POST",
                body={"email": (email or "").strip().lower(), "password": password or ""})
    user = shape(out.get("user") or {})
    return {"access_token": out.get("access_token"),
            "refresh_token": out.get("refresh_token"),
            "expires_at": out.get("expires_at"), "user": user}


def refresh(refresh_token):
    """Trade a refresh token for a fresh access token.

    Supabase access tokens expire after an hour, and the client used to throw the refresh
    token away — so anyone still on the dashboard sixty minutes later was bounced to the
    login screen mid-task. The refresh token lasts far longer and is what that hour is
    designed around. Raising the JWT expiry instead would have been the wrong fix: a
    long-lived access token cannot be withdrawn, which would quietly defeat forget()
    below and leave a demoted admin holding admin rights until it aged out.
    """
    if not enabled():
        raise AuthError("sign-in is not configured on this server")
    out = _call("/auth/v1/token?grant_type=refresh_token", _pub(), method="POST",
                body={"refresh_token": refresh_token or ""})
    if not out.get("access_token"):
        raise AuthError("that session could not be renewed")
    return {"access_token": out.get("access_token"),
            "refresh_token": out.get("refresh_token"),
            "expires_at": out.get("expires_at"),
            "user": shape(out.get("user") or {})}


def user_from_token(token):
    """Who is this token? Cached briefly; None if the token is missing or rejected."""
    if not token or not enabled():
        return None
    hit = _token_cache.get(token)
    if hit and hit[0] > time.time():
        return hit[1]
    try:
        out = _call("/auth/v1/user", _pub(), token=token)
    except AuthError:
        _token_cache.pop(token, None)
        return None
    user = shape(out or {})
    _token_cache[token] = (time.time() + _TOKEN_TTL, user)
    # the cache is per-process and unbounded otherwise; a run of expired entries is cheap
    # to drop and this is the only place that grows it
    if len(_token_cache) > 500:
        now = time.time()
        for k, v in list(_token_cache.items()):
            if v[0] <= now:
                _token_cache.pop(k, None)
    return user


def forget(token):
    """Drop a cached token immediately — used on sign-out and after a role change, so a
    demoted admin doesn't keep admin rights for up to a minute."""
    _token_cache.pop(token, None)


def forget_all():
    _token_cache.clear()


# ------------------------------------------------------------------ managing users
def list_users():
    out = _call("/auth/v1/admin/users?per_page=200", _secret())
    users = out.get("users") if isinstance(out, dict) else out
    return sorted((shape(u) for u in (users or [])),
                  key=lambda u: (u["role"] != "admin", u["name"].lower()))


def create_user(email, password, name="", role="member", scope="own"):
    if role not in ROLES:
        raise AuthError(f"role must be one of {', '.join(ROLES)}")
    if scope not in SCOPES:
        raise AuthError(f"scope must be one of {', '.join(SCOPES)}")
    if len(password or "") < 8:
        raise AuthError("the password needs to be at least 8 characters")
    out = _call("/auth/v1/admin/users", _secret(), method="POST", body={
        "email": (email or "").strip().lower(),
        "password": password,
        # No mail server is configured for this tool, and there is nowhere for a
        # confirmation link to go. The admin creates the account and hands over the
        # password directly, so confirm it here or the user could never sign in.
        "email_confirm": True,
        "app_metadata": {"role": role, "scope": scope, "name": (name or "").strip()},
    })
    return shape(out or {})


def update_user(user_id, name=None, role=None, scope=None, password=None):
    """Change what an admin is allowed to change. Email is deliberately not editable —
    it is the identity every captured change is already recorded against."""
    current = _call(f"/auth/v1/admin/users/{user_id}", _secret())
    meta = dict((current or {}).get("app_metadata") or {})
    if name is not None:
        meta["name"] = name.strip()
    if role is not None:
        if role not in ROLES:
            raise AuthError(f"role must be one of {', '.join(ROLES)}")
        meta["role"] = role
    if scope is not None:
        if scope not in SCOPES:
            raise AuthError(f"scope must be one of {', '.join(SCOPES)}")
        meta["scope"] = scope
    body = {"app_metadata": meta}
    if password:
        if len(password) < 8:
            raise AuthError("the password needs to be at least 8 characters")
        body["password"] = password
    out = _call(f"/auth/v1/admin/users/{user_id}", _secret(), method="PUT", body=body)
    forget_all()          # a role or scope change must take effect now, not in 60s
    return shape(out or {})


def delete_user(user_id):
    _call(f"/auth/v1/admin/users/{user_id}", _secret(), method="DELETE")
    forget_all()
    return True


def bootstrap_admin(log=print):
    """Create the first admin, once, from the environment.

    The password is read from AUDIT_ADMIN_PASSWORD (audit/.env, git-ignored) rather than
    written in this file, so it never reaches the repository. Runs only when there are no
    users at all — it can never overwrite or re-promote an existing account.
    """
    if not enabled():
        return None
    email = (os.environ.get("AUDIT_ADMIN_EMAIL") or cloud.cfg("AUDIT_ADMIN_EMAIL") or "")
    password = (os.environ.get("AUDIT_ADMIN_PASSWORD")
                or cloud.cfg("AUDIT_ADMIN_PASSWORD") or "")
    if not email or not password:
        return None
    try:
        if list_users():
            return None                     # somebody already exists; never touch them
        u = create_user(email, password, name="Administrator", role="admin", scope="all")
        log(f"created the first admin account: {u['email']} — change this password after "
            f"signing in")
        return u
    except AuthError as e:
        log(f"could not create the first admin: {e}")
        return None
