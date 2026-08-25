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

    # poiLocation's TripAdvisor ranking of the DESTINATION, e.g. "#14 of 86 things to do
    # in Hai Phong" -> "#14 of 87 ..." — recalculated citywide, nothing to do with this
    # product. Scoped to poiLocation.ranking specifically, the same way as
    # poiLocation.description above, so it cannot reach any other "ranking" field.
    # Checked: every "ranking" path in real data lives under poiLocation.
    "poiLocation.ranking",

    # travelerPickup.locationAreas[].locationsInArea[] — the pickup-point catalogue
    # (hotels, landmarks) TripAdvisor supplies for the area, confirmed by
    # providerReference "TRIPADVISOR-<id>" on every entry. Measured on a real sync
    # (account 264421, Vietnam): a hotel renamed on TripAdvisor — "Holiday Suites
    # Hotel & Spa" -> "Holiday Suites Hotel" — and re-geocoded by a few metres produced
    # rows for description, searchString, centre.lat and centre.long, none of them a
    # Viator edit. No supplier picks these hotels one by one; Viator surfaces whichever
    # of them TripAdvisor lists nearby. The pickup AREA itself — centreLocation,
    # pickupAreaCategory, the top-level travelerPickup settings a supplier does
    # configure — does not contain this token and stays diffable.
    "locationsInArea",
    # A full sweep after the fix above found "locationsInArea" is case-sensitive, so it
    # never matched its own sibling `expiredLocationsInArea` — same object shape, same
    # providerReference "TRIPADVISOR-<id>", same catalogue, just for a point that has
    # since expired. Listed explicitly rather than relying on case tricks. Also
    # `travelerPickup.pickupPorts[]`, the identical catalogue for a cruise/port pickup —
    # found by the same sweep, never before excluded, currently 0 change rows (this one
    # is closing a coverage gap in an already-approved rule, not new evidence).
    "expiredLocationsInArea", "pickupPorts",

    # --- the rest of poiLocation / primaryLocationDetails: third-party catalogue ------
    # metadata about a place ALREADY CHOSEN, not the choice itself. The client's own
    # standard for this list: keep anything that reflects WHICH location an employee
    # attached to the product (that is real Viator data — an actual product decision);
    # exclude only what a third party (TripAdvisor here) supplies about that place once
    # picked, since nobody at the company ever touches it.
    #
    # KEPT diffable, deliberately: `reference`/`providerReference`/`tripAdvisorLocationId`
    # (the identity — if an employee points a listing at a DIFFERENT place, this is what
    # changes), `name` and `searchString` (the human-legible "which place", and the exact
    # two fields the dashboard itself reads), `locationAddress` (city/country — still
    # "which place", just coarser).
    #
    # EXCLUDED here: `centre` (lat/long — proven to drift by a few metres for the SAME
    # place, see locationsInArea above), `categories`/`isBanned` (TripAdvisor's own
    # classification and moderation flags), `tripAdvisorCountryCode`/`tripAdvisorUrl`
    # (administrative TripAdvisor identifiers), `website` (the PLACE's own site, e.g. a
    # hotel's homepage — nothing about the tour), `rating` (TripAdvisor's star rating of
    # the place, same class as the reviewCount/ranking above), `address` (verified NOT a
    # duplicate of anything else — 1/312 and 0/37 coincidental matches against `name` in
    # the Google-sourced containers below — but it is still TripAdvisor/Google's own
    # formatted text about the place, not something typed here).
    "poiLocation.centre", "poiLocation.categories", "poiLocation.isBanned",
    "poiLocation.tripAdvisorCountryCode", "poiLocation.tripAdvisorUrl",
    "poiLocation.website", "poiLocation.rating", "poiLocation.address",
    "primaryLocationDetails.centre", "primaryLocationDetails.categories",
    "primaryLocationDetails.isBanned", "primaryLocationDetails.tripAdvisorCountryCode",
    "primaryLocationDetails.tripAdvisorUrl", "primaryLocationDetails.website",
    "primaryLocationDetails.rating", "primaryLocationDetails.address",
    # primaryLocationDetails can carry the same "#N of M things to do" ranking as
    # poiLocation — rare (1 of 212 real instances checked) but the identical concept,
    # so the identical treatment.
    "primaryLocationDetails.ranking",

    # poiLocation.canBeMatchedToViatorLocation / .matchedViatorLocation: proven to be a
    # COMPUTED backend flag, not anything an employee sets. Real example: the itinerary
    # stop "Bai Dinh Pagoda" (a specific, real attraction) shows
    # canBeMatchedToViatorLocation=False, matchedViatorLocation="Northern Vietnam" — that
    # is Viator's own matching system failing to link this exact place to one of its
    # internal location records and falling back to the region. Nobody at the company
    # can set or edit this; it is the system reporting on itself.
    "poiLocation.canBeMatchedToViatorLocation", "poiLocation.matchedViatorLocation",

    # --- the pickup/start/end POINTS: same principle, different provider ----------
    # product.startEndPoints[].location, departureAndReturn.startPoints[].location,
    # departureAndReturn.endPoints[].location, and travelerPickup.locationAreas[].
    # centreLocation.location are catalogue entries too — but sourced from GOOGLE PLACES
    # (providerReference "GOOGLE-ChIJ...", confirmed on real data), not TripAdvisor. Same
    # conclusion either way: once an employee has picked WHICH point a tour starts, ends,
    # or is centred on, the formatted address, geocoding and place classification for
    # that exact point are Google's own catalogue content, refined on Google's own
    # schedule, not a product edit. `.location.` scopes each token to these four
    # containers only — verified against 204,337 real paths, zero collateral, including
    # that poiLocation's and primaryLocationDetails's OWN same-named fields (which have
    # no ".location." infix in their path) are unaffected by these shared tokens.
    ".location.address", ".location.categories", ".location.centre", ".location.isBanned",

    # product.availableTaListings[]: NOT this product's data at all. It is the SUPPLIER
    # ACCOUNT's whole roster of other connectable TripAdvisor business listings, offered
    # on every product regardless of that product's own location — proven on real data:
    # account 18's Venice walking tour (201139P96) listed "Matera", "Monte Isola" and
    # "Florence" as available candidates, and a sync run captured a NEW entry,
    # "Opatrip.com Amalfi Coast" (Amalfi, hundreds of km from Venice), as a "change" to
    # that one product. The product's real connection decision is a SEPARATE field,
    # product.tripAdvisorListing (singular — "Opatrip.com Venice", correct, unchanged
    # across both syncs) — kept, untouched by this token. The dashboard itself only ever
    # shows availableTaListings as a bare count ("Other listings available: N"), never
    # its individual entries, confirming nothing here is product-editorial data.
    "availableTaListings",

    # .searchString / .locationAddress.line2: the SAME class of problem as .centre above
    # (same identity, provider text drifts on its own) but proven on street-address TEXT
    # instead of GPS coordinates. Real incident (account 10, "Private Historic Parks &
    # Heritage Walk in Tirana", 197372P6): the SAME Google place — same `reference`, same
    # `providerReference`, neither changed — had its street name relabeled by Google from
    # "Rruga Herman Gmeiner" to "Rruga Herman Gmainer", and because that one physical
    # pickup point is embedded in THREE places in the product (startEndPoints,
    # departureAndReturn.endPoints, and the itinerary's poiLocation), one relabeling
    # produced 6 change rows across none of which a Viator employee touched anything.
    # `.name` is NOT included here — it stayed identical through the exact same incident
    # (still "Tirana Lake Park" before and after), because it is the short stable label,
    # while `.searchString` embeds the full geocoded address (down to a Google Plus Code
    # in one real example, "8R6G+P4W" — unambiguously machine-generated, never typed by a
    # supplier). Checked against the whole corpus: every one of 5,370 real .searchString
    # paths lives on a location-shaped object (centreLocation, locationsInArea,
    # expiredLocationsInArea, poiLocation, primaryLocationDetails, or one of the four
    # Google-sourced .location. containers) — never anything unrelated — and all 897 real
    # .locationAddress.line2 paths sit on the same three containers that carry it
    # (poiLocation, primaryLocationDetails, .location.). Only `.line2` (street) is
    # excluded, not the rest of locationAddress — .city/.country/.postcode have not been
    # measured to drift, so per rule zero they stay kept rather than assumed guilty.
    ".searchString", ".locationAddress.line2",

    # .isError / .isLocked / .media.shape / .media.type: technical metadata Viator's
    # system computes about a photo file, not anything a human enters — proven, on real
    # data, 100% identical between product.heroPhoto and the SAME photo's own entry in
    # product.media[] (30 of 30 checked), confirming they are a duplicate of a fact
    # already recorded, not independent signal. Real incident: TWO products (account 18's
    # "Private Amalfi Walking Tour: Architectural Heritage", 384/"Private Syracuse & Noto
    # Heritage Tour from Catania") each had 3 photos genuinely removed, and each removal
    # produced 7 field-level rows (isError, isLocked, media.previewUrl, media.shape,
    # media.type, mediaRef, sortOrder) instead of 1. previewUrl and sortOrder stay kept —
    # previewUrl is the one canonical URL a photo change is traced through, and sortOrder
    # is a real editorial choice (which order photos display in). Scoped to "media." only
    # (a dot, not bare "shape"/"type") so this cannot reach an unrelated field that
    # happens to share that short a name elsewhere in the product.
    ".isError", ".isLocked", ".media.shape", ".media.type",

    # pricingRecords / rawPricingRecords / datesAndLowestPrices / allStartTimes /
    # bookingCutoffsByTime / duplicateOptions / duplicateCompletedOptions: Viator's own
    # BACKEND-COMPUTED EXPANSION of the real, human-set pricing/schedule rules — not
    # independently authored. Proven, not assumed: pricingRecords/rawPricingRecords/
    # datesAndLowestPrices' retailPrice/lowestPrice for a package matched EXACTLY the same
    # package's own real, kept `pricingPackages....price.retailPrice` (559 both places);
    # bookingCutoffsByTime's per-start-time "cutoffHours: 24" matched the real, kept root
    # field `bookingConfirmationSettings.bookingCutoffInHours: 24` exactly; and
    # duplicateOptions/duplicateCompletedOptions are a computed map of every option's own
    # title, already fully covered by the real, kept `product_options.OPT-<id>.title`.
    # Even the schedule shape (which days, which date range) survives losing these: it is
    # baked into pricingPackages' own reference string itself (e.g.
    # "PPP-AIS-2099-12-31_MTWHFSU_TG1_2026-06-29_1000_D"), which stays kept.
    # Real incident (account 18, "Private Customizable Cultural Walking Tour in Verona",
    # 201139P133): removing 2 of 3 tour-duration options was ALREADY fully recorded via
    # product_options' own .title/.status/.tourGradeCode (kept, 3 rows) — but the SAME
    # single event, walking through these seven computed containers, produced 234 MORE
    # rows repeating it. Checked against the whole corpus for collateral: zero of these
    # tokens touch pricingPackages, product_options, or bookingConfirmationSettings' own
    # root fields (bookingCutoffType/bookingCutoffInHours/confirmationType) — all stay
    # kept and fully diffable.
    "pricingRecords", "rawPricingRecords", "datesAndLowestPrices", "allStartTimes",
    "bookingCutoffsByTime", "duplicateOptions", "duplicateCompletedOptions",

    # specialOfferInfo.calculatedComparisonPrices: the SAME computed-expansion class as
    # the pricing calendar above, proven the same way — its .comparisonPrice (559)
    # matched EXACTLY the already-kept, individually-tracked
    # specialOfferInfo.comparisonPriceForSpecial (559); its .expiresAt is the same
    # capture-relative field already excluded elsewhere; and its .ageBand is a two-item
    # array where Viator's own data literally starts with the string "AGE_BAND" as a
    # type tag before the real value — never something a human enters. It is also never
    # rendered per-item anywhere in the dashboard (sections.js shows only a summary
    # "Comparison price" line built without a path), so a change here had no field on
    # the product page to click through to and verify in the first place.
    "calculatedComparisonPrices",

    # performance.allowAdminPerformanceStatusUpdates / performance.productCode: NOT
    # something a supplier sees or sets on Viator. The first is a literal admin-only
    # permission flag (its own name says who it is for), never shown to a supplier at
    # all; the second is a verbatim duplicate of the product's own already-tracked
    # identity (the product_code column, and the product this whole row already belongs
    # to). performance.performanceStatus is deliberately NOT included here — it IS a
    # supplier-visible indicator (the same kind of computed-but-shown signal as
    # quality_level, already kept), and is already rendered with a working jump target
    # in secQuality(). Real incident: a newly-appearing product's first capture of this
    # whole block reported "Allow Admin Performance Status Updates: (none) -> true" and
    # "Product code: (none) -> 213206P50" as if a human had set them.
    "performance.allowAdminPerformanceStatusUpdates", "performance.productCode",

    # uniquePackageRefs / optionsAndOrderedSeasons / product.productOptions: Viator's own
    # internal cross-reference bookkeeping — flat lists whose entries are literally just
    # id strings (both the list's own identity key AND its value ARE the same raw id,
    # e.g. "OPT-d3210d46-..."), never a human-readable field. Not shown anywhere on the
    # dashboard either. 100% redundant with product_options itself, already kept — the
    # SAME option being removed (Verona, 201139P133) already produces a real, readable
    # row there; these three just drop the SAME id from three internal index lists,
    # scoped to "product." so product.productOptions (this list) can never collide with
    # product_options (the real, kept per-option data — checked, 0 collisions).
    "uniquePackageRefs", "optionsAndOrderedSeasons", "product.productOptions",

    # travellerRequiredInfo.alsoRequiredFields: a computed list of exactly which of this
    # SAME object's own boolean fields (fullNames, passportDetails, …) are true right now
    # — verified on real data, every one of its entries matches a true boolean elsewhere
    # in the same object (3 of 3 products checked, 0 mismatches). The real, human-set
    # facts are those booleans themselves (kept, and genuinely important — this is
    # Viator's real "traveller information required at booking" setting, confirmed shown
    # on the dashboard as "Information collected from travellers"). This list just
    # doubled every one of them: a product requiring full names AND passport details
    # produced 4 rows for what was really 2 real settings changing.
    "travellerRequiredInfo.alsoRequiredFields",
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
    # primaryLocationDetails.description is the same duplicate, one level up — verified
    # 100% identical to primaryLocationDetails.searchString across every real object
    # checked (821 of 821), not an estimate. searchString is kept diffable, matching
    # poiLocation above, and matching what the dashboard itself already reads
    # (primaryLocationDetails.name and .searchString — never .description).
    "primaryLocationDetails.description",
    # The same duplicate again, for the four Google-sourced point containers
    # (startEndPoints[].location, startPoints[].location, endPoints[].location,
    # centreLocation.location) — verified 100% identical to their own .searchString
    # across every real instance checked (628 of 628). `.location.` scopes this to
    # those four only, the same scoping used in VOLATILE_TOKENS above.
    ".location.description",
)

# (prefix, suffix) pairs for a field that is only noise INSIDE one specific dict-keyed
# container but is real data anywhere else, so a plain substring token would either miss
# it or catch too much. The container's dict key (a generated id, different on every
# option) sits between the prefix and the suffix, so no single literal substring can span
# both ends — is_volatile() checks path.startswith(prefix) and suf in path instead.
VOLATILE_SCOPED = (
    # product_options.OPT-<uuid>.connectionDetails.*: proven, on real data, to be ENTIRELY
    # Viator's own API/pricing-sync plumbing for that option — thirdPartyMappings (its own
    # connected-system ids), and nine isXxxSapiV2/isOptionSyncEnabled/isAutoSyncStartTime
    # booleans, all about the state of a sync TOGGLE, not anything an employee authors.
    # Checked against the whole corpus: 5,366 of 5,369 real "connectionDetails" paths in
    # the database are inside product_options; the other 3 are a DIFFERENT, unrelated
    # field (product.connectionDetails.supplierProductCode/.syncDetails.*, kept, untouched
    # by this scoping since its own path never starts with "product_options."). A single
    # option going away produced 20 change rows for this alone (account 18, "Private
    # Customizable Cultural Walking Tour in Verona", 201139P133) even though the same
    # option's real fields (.title, .status, .tourGradeCode) already say it was removed.
    ("product_options.", ".connectionDetails."),
    # product_options.OPT-<uuid>.reference: proven 100% redundant across every real option
    # checked (307 of 307) — it always equals the dict key already present earlier in the
    # same path. Scoped to product_options only: poiLocation.reference and
    # primaryLocationDetails.reference are a real identity anchor there and stay kept.
    ("product_options.", ".reference"),
    # product.media[<id>].mediaRef: proven 100% redundant across every real photo checked
    # (1,344 of 1,344) — flatten() derives the [<id>] bracket key FROM this exact field
    # (list_identity()), so it always equals what is already in the path. Scoped to
    # product.media[ specifically: product.heroPhoto.mediaRef is a DIFFERENT, real,
    # editorial field (which photo is the hero — a human's choice) and is not touched,
    # since its own path never starts with "product.media[".
    ("product.media[", ".mediaRef"),
    # product_traits.<code>.<TRAIT>.name: proven 100% redundant across every real trait
    # entry checked (5,591 of 5,591) — always equals the trait's own dict key
    # (e.g. "PASSPORT_TYPE"), which is already in the path. The real, kept, meaningful
    # fields on the SAME entry are .isSatisfied and .violations — Viator's own
    # requirement checklist, already shown on the dashboard as "Viator quality checks".
    # Scoped to product_traits. so it cannot reach any other field named "name" — checked,
    # the only path shape containing ".name" anywhere under product_traits is exactly
    # this one (5,591 of 5,591), never inside a violation entry.
    ("product_traits.", ".name"),
)

# --- who to contact when someone needs a capture run --------------------------
# Surfaced by the popup behind Fetch / Stop / Add Account. Kept here so the name and
# address can change without touching the JavaScript.
AUTOMATION_OWNER = {
    "name": "Maniha",
    "role": "Head of Automation Department",
    "email": "maniha@opatrip.com",
}
