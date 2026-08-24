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

    # --- values that describe WHEN WE LOOKED, not the product -------------------
    # Each was checked against the real data before being added here; the row counts
    # are from account 272089, sync 190, where 117 of 140 "changes" were these.
    #
    # = the capture date, exactly. Changes on every sync run on a new day.
    "productLocalDate",
    # = the capture date too. Both sides of the special-offer eligibility window.
    "offerStartDate", "offerEndDate",
    # = capture date + exactly one year. Viator stamps it when the page renders.
    # NOTE its sibling `comparisonPrice` is the struck-through "was" price and is REAL —
    # which is why this is excluded by name and not the whole calculatedComparisonPrices
    # block. Verified: 44 comparisonPrice paths still diff normally.
    "expiresAt",
    # A map KEYED BY DATE (date -> which pricing record applies). Measured across a
    # 25-day gap, every key moved by exactly 25 days, so a key rename read as four
    # changes per product. The pricing itself lives in the sibling `pricingRecords`,
    # which is untouched — 1,623 of those paths still diff normally.
    "lowestPricedRecordsByDates",

    # --- the destination's TripAdvisor figures, not the product's ---------------
    # These sit inside a location record: categories ["GEOGRAPHIC"], a lat/long centre,
    # providerReference "TRIPADVISOR-<id>", and a tripAdvisorUrl pointing at the CITY's
    # Tourism-g<id>-…-Vacations.html page. reviewCount is how many reviews TripAdvisor
    # holds for the city; photoUrl is the city's hero image. Proof they are not the
    # product's: two different tours in Lubango both read 498 and share one photo, while
    # their own review_count is 0.
    #
    # Stored twice per product as well — primaryLocationDetails and the itinerary item's
    # poiLocation are the same catalogue entry, same tripAdvisorLocationId.
    #
    # The PRODUCT's own reviews and photos are elsewhere and still tracked:
    # review_rating.totalReviewCount (capital R — these lowercase tokens do not match it,
    # verified) and product.media (9,322 paths, none excluded).
    "reviewCount", "photoUrl",
)

# Paths that repeat a fact recorded elsewhere. Not volatile — the underlying change is
# REAL — but stored several times over, so one edit reads as several changes.
#
# Measured across 60 snapshots: a single photo swapped on Viator produced up to EIGHT
# rows, because the same URL is held four ways and the hero photo is also one of the
# media images. Excluding the copies leaves the change reported exactly once.
#
# What survives is deliberate: `sizes[].url` keeps the photo itself diffable, and
# `mediaRef` keeps its identity. product.heroPhoto is left alone — which image is the
# hero is an editorial choice a human makes, so that IS worth reporting.
REDUNDANT_TOKENS = (
    # Every image carries TEN generated size variants, and the size list is keyed by its
    # own url, so swapping one photo renames all ten keys — 10 removed + 10 added across
    # url, relativePath, width, height and size. Measured on a real product: ONE photo
    # swap produced 112 change rows. The variants are machine-generated from the same
    # source image and carry no information the url does not.
    "media.sizes",
    # maxSizeUrl and minSizeUrl are the same image at other dimensions.
    #
    # previewUrl is deliberately NOT excluded: it is the one canonical URL left per image,
    # and photo-change detection depends on a url being present. The snapshot holds each
    # photo's ref and CDN url precisely so a swapped photo is still detected without
    # storing the bytes — silence all of them and that traceability is gone.
    "maxSizeUrl", "minSizeUrl",
    # media.ref duplicates the sibling mediaRef (the dot keeps this off "mediaRef")
    "media.ref",
    # heroPhoto embeds a full copy of whichever media image is the hero, so a photo swap
    # would be reported twice. heroPhoto.mediaRef is NOT excluded — which image is the
    # hero is an editorial choice a human makes, and that is worth reporting.
    "heroPhoto.media.",
    # poiLocation.description is a verbatim copy of poiLocation.searchString.
    # Scoped to poiLocation on purpose: a bare "description" would also silence
    # itinerary item descriptions, which are real content a human writes.
    "poiLocation.description",
)

# --- who to contact when someone needs a capture run --------------------------
# Surfaced by the popup behind Fetch / Stop / Add Account. Kept here so the name and
# address can change without touching the JavaScript.
AUTOMATION_OWNER = {
    "name": "Maniha",
    "role": "Head of Automation Department",
    "email": "maniha@opatrip.com",
}
