"""Configuration for the READ-ONLY web dashboard.

This is the deployed copy. It deliberately contains none of the capture tunables — no
pacing, no browser, no profile paths — because the deployed app cannot capture anything.
The reference data below (platforms, statuses, task types) is shared with the desktop
tool: it is what turns a stored code into a label, so reports and filters read the same
in both places. Keep the two in step when you add a platform or a task type.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# Never used on Vercel: the storage layer is Postgres-only there (see store.mode()).
# It exists because store.py and db.py import the name, and because running this app
# locally against a SQLite file is a useful way to check a change without touching
# production.
DB_PATH = ROOT / "audit.db"

# --- platforms & workflow (must match the desktop tool) ------------------------
PLATFORMS = [
    ("viator",        "Viator",        True),
    ("getyourguide",  "GetYourGuide",  False),
    ("musement",      "Musement",      False),
    ("opatrip",       "Opatrip",       False),
]

CANONICAL_STATUSES = [
    ("LIVE",       "Live",         "b-active"),
    ("PENDING",    "Under review", "b-pending"),
    ("DRAFT",      "Draft",        "b-draft"),
    ("REJECTED",   "Rejected",     "b-rejected"),
    ("REMOVED",    "Removed",      "b-rejected"),
    ("NOT_LISTED", "Not uploaded", "b-draft"),
]

STATUS_MAP = {
    "viator": {
        "ACTIVE": "LIVE",
        "PENDING_FIRST_ACTIVATION": "PENDING",
        "UNDER_REVIEW": "PENDING",
        "DRAFT": "DRAFT",
        "REJECTED": "REJECTED",
        "INACTIVE": "REMOVED",
    },
}

TASK_TYPES = [
    ("PRODUCT_CREATE",   "Product created",        1.00),
    ("PRODUCT_UPDATE",   "Product updated",        0.50),
    ("PRODUCT_UPLOAD",   "Uploaded to platform",   1.00),
    ("PHOTO_UPLOAD",     "Photos added",           0.25),
    ("TRANSLATION",      "Translation added",      0.50),
    ("QUALITY_FIX",      "Quality issue fixed",    0.75),
    ("AUDIT_SYNC",       "Audit sync run",         0.00),
]

# How many snapshots to keep per product. A snapshot is a full ~11 kB copy; the audit
# trail itself lives in `changes`, one small row per field that moved. So the copies in
# the middle are an expensive second recording of something already written down.
#
# 2 = the original (what it looked like first) + the latest (what it looks like now, and
# the baseline the next sync diffs against). Once a product has that many, a change
# updates the newest row in place instead of adding another — so a product edited fifteen
# times a day costs fifteen small change rows, not fifteen 11 kB copies.
#
# Raise it if you ever want more depth; nothing else needs to change.
SNAPSHOT_HISTORY = 2

# Photos are NOT stored or shown (client decision). Must match the desktop tool: this app
# is the one exposed to the internet, so a photo-upload endpoint left open here would keep
# writing to R2 no matter what the capture tool does.
#
# It costs no traceability. A photo swapped on Viator is still detected, because detection
# never looked at the bytes: the snapshot holds product.media — each photo's ref, CDN URL,
# caption and order — and diff() compares those paths like any other field. The dashboard
# collapses the result into one readable line (see groupChanges in format.js).
CAPTURE_IMAGES = False

# --- change-detection noise control (used when rendering stored snapshots) -----
VOLATILE_PREFIXES = (
    "_capture",
    "trackingData", "request.", "meta.", "config.", "prompts",
    "accelerate",
)
VOLATILE_TOKENS = (
    "sessionId", "lookbackId", "traceId", "requestTimestampUTC", "altSessId",
    "lastUpdatedAt", "statusStartDate",
)

# --- who to contact when someone needs a capture run --------------------------
# Surfaced by the popup behind Fetch / Stop / Add Account. Kept here so the name and
# address can change without touching the JavaScript.
AUTOMATION_OWNER = {
    "name": "Maniha",
    "role": "Head of Automation Department",
    "email": "maniha@opatrip.com",
}
