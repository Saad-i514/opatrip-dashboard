# Antigravity Change Document: Season & Pricing Label Resolution & Spreadsheet/File Ingestion

## 1. Problem Summary & Feature Requests
1. **Duplicate Appearance in Edit History**: Resolved generic season titles causing visual collision.
2. **Duplicate Pricing Tables**: Resolved missing season dates in pricing package titles.
3. **Deployed Dashboard Header Refactoring**:
   - Removed `Fetch` and `Stop` buttons from topbar on the deployed dashboard.
   - Enhanced `+ Add Account` button.
4. **Google Spreadsheet & Laptop File Ingestion**:
   - Segmented toggle buttons: **`[ Add to Existing Account ]`** and **`[ + Create New Account ]`**.
   - Supports Google Spreadsheet public share links.
   - Supports uploading spreadsheet files directly from laptop (`.xlsx`, `.xls`, `.csv`, `.tsv`) with drag-and-drop.
5. **Full Storage & Clean Rendering for Every Spreadsheet Field & Link**:
   - Every single column from the spreadsheet is parsed and stored in the database snapshot.
6. **Automated Commission Calculation & Headline Integration**:
   - Commission is automatically calculated from Public Price and Guide Fee:
     $$\text{Commission Rate (\%)} = \frac{\text{Public Price} - \text{Guide Fee}}{\text{Public Price}} \times 100$$
   - Stores `commission_percent` and `baseMargin` in snapshot and products table upon import.
   - Top headline **Commission** box and the **Schedules & prices** tab show the calculated percentage.
7. **`+ Add data to product` Structured Raw Text Ingestion & Viator Auto-Calculations**:
   - Added a prominent **`+ Add data to product`** button in the product details header.
   - Comprehensive structured raw text parser covering 100% of all 56 Viator portal keys and subsections:
     - **OVERVIEW**: Title, Duration, Themes, Category, Languages, Max Travelers, Group Type, Skip The Line, Customizable, Product Type, Location, External Reference.
     - **ATTRACTIONS**: Numbered stops with dwell times, realistic admission types (`Free Entry`, `Included`), and commentary.
     - **INCLUSIONS / EXCLUSIONS**: Bulleted item lists.
     - **DESCRIPTION**: Full tour narrative.
     - **PRICING**: Public price, Guide fee, Currency, Price unit, Dynamic pricing, Base margin, Boost margin, Accelerate opt-in status.
     - **MEETING & PICKUP**: Meeting point, Address, Mode, Pickup transport type, Vehicle description, Route map link.
     - **BOOKING & TICKETS**: Confirmation type, Cut-off hours, Cancellation policy, Bad-weather cancellation, Ticket format, Special instructions.
     - **TRAVELLER REQUIREMENTS**: Required info (Full names, Passport details, Mobile number).
     - **CONNECTIVITY**: Supplier code, Reservation system.
     - **LINKS**: Admission source links, Hours source links.
     - **QUALITY & STATUS**: Quality level, Status, Reviews count, Review rating.
   - **Automated Viator Field Calculations**:
     1. `durationInMinutes`: Auto-parsed integer minutes from duration strings (e.g. `2h 0m` -> `120`).
     2. `timeAtStops` & `activityItinerary.isNonConformingItinerary`: Computes total dwell time and validates against total duration.
     3. `productProgramMargin.averageActualMargin`: Computes effective commission with Accelerate boost opt-in.
     4. `minimalMargins` & `minimumSuggestedRetailPriceByAgeBands`: Auto-populates age band margin fractions and MSRP floors.
     5. `briefDescription`: Generates 240 character summary snippet from description.
     6. `product_traits`: Evaluates standard Viator quality rules.
8. **Partial Update Resilience**:
   - If a user omits any section or fields in the raw text, the parser only updates the fields provided in the text while **fully preserving all existing unmentioned data** in the product snapshot and database.
9. **`+ Add Product` Button in Products View**:
   - Added `+ Add Product` button in the products filter bar with account picker and raw text dialogue.
10. **Status Badge Synchronization (Left vs Right)**:
   - Fixed status canonical mapping (`LIVE` -> `LIVE`, `ACTIVE` -> `LIVE`).
   - Fixed `platformGrid` in `products.js` to ensure the product row's own listing badge on the right under `LISTED ON` always matches the actual product status shown on the left.

---

## 2. Verification Results
- **Full Schema Verification**: Verified against real Viator captured product `197004P1` (56 keys mapped) - PASS
- **Partial Update Resilience Test**: Tested with a partial text snippet containing only 2 sections:
  - Provided fields (Title, Attractions, Commission) were updated cleanly - PASS
  - Omitted fields (Location, Themes, Inclusions, Description) were 100% preserved - PASS
- **Database Cleanliness**: All temporary test records purged from Supabase Postgres / SQLite - PASS
