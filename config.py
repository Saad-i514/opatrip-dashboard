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
