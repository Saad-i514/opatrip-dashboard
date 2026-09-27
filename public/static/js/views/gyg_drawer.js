import { esc, $, post, api, cachedApi } from '../core.js';
import { openDrawer } from './drawer.js';
import { askEditor } from '../edit.js';
import { toast } from '../toast.js';
import { whenLong, formatDisplayVal } from '../format.js';

let gygCatalogCache = null;

async function loadGygProduct(tourId, productId = null, viatorTourId = null, viatorProductCode = null) {
  const tid = tourId ? String(tourId).trim() : '';
  const pid = productId ? String(productId).trim() : '';
  const targetCode = viatorProductCode ? String(viatorProductCode).trim().toUpperCase() : '';

  // 1. Try /api/product/gyg/{code}
  const codeToTry = tid || pid;
  if (codeToTry) {
    try {
      const data = await api(`/api/product/gyg/${encodeURIComponent(codeToTry)}`);
      if (data && (data.details || data.product)) {
        const details = data.details || {};
        const prod = data.product || {};
        const combined = { ...details, ...prod };
        combined.tour_id = prod.product_code || details.tour_id || details.product_code || combined.tour_id || tid;
        combined.title = prod.title || details.title || combined.title;
        combined.status = prod.status || details.status || combined.status;
        if (details.short_description && !combined.short_description) combined.short_description = details.short_description;
        if (details.full_description && !combined.full_description) combined.full_description = details.full_description;
        if (details.highlights && (!combined.highlights || !combined.highlights.length)) combined.highlights = details.highlights;
        if (data.changes) combined.history = data.changes;
        if (Object.keys(details).length > 0 || combined.title) {
          return combined;
        }
      }
    } catch (e) {}
  }

  // 2. Load static catalog JSON
  if (!gygCatalogCache) {
    try {
      const res = await fetch('/static/data/gyg_catalog.json');
      if (res.ok) {
        gygCatalogCache = await res.json();
      }
    } catch (e) {}
  }

  if (gygCatalogCache) {
    if (tid && gygCatalogCache[tid]) {
      return gygCatalogCache[tid];
    }
    const tLower = tid.toLowerCase();
    for (const [id, item] of Object.entries(gygCatalogCache)) {
      if (tid && (id === tid || String(item.tour_id) === tid || String(item.product_code) === tid ||
          (item.reference_code && String(item.reference_code).toLowerCase() === tLower) ||
          (item.product_reference_code && String(item.product_reference_code).toLowerCase() === tLower))) {
        return item;
      }
      if (pid && (String(item.id) === pid || String(item.product_id) === pid)) {
        return item;
      }
      if (targetCode) {
        const vm = item.matched_viator || item.viator_mapping;
        if (vm) {
          const c = (vm.viator_product_code || vm.product_code || '').trim().toUpperCase();
          if (c === targetCode) return item;
        }
      }
    }
  }

  // 3. Try /api/product/{pid}
  if (pid) {
    try {
      const data = await api(`/api/product/${encodeURIComponent(pid)}`);
      if (data && data.current && Object.keys(data.current).length) {
        return { ...data.current, ...data.product, tour_id: tid || (data.product && data.product.product_code) };
      }
    } catch (e) {}
  }

  // 4. Try /api/gyg/product/{tid}
  if (tid) {
    try {
      const data = await api(`/api/gyg/product/${encodeURIComponent(tid)}`);
      if (data && data.tour_id) return data;
    } catch (e) {}
  }

  return null;
}

export async function openGygDrawer(tourId, productId = null, viatorTourId = null, viatorProductCode = null) {
  const host = $('#drawerHost') || document.body;

  // Show loading container
  const scrim = document.createElement('div');
  scrim.className = 'gyg-portal-scrim';
  scrim.id = 'gygModalScrim';
  scrim.innerHTML = `
    <div class="gyg-portal-container" style="padding: 40px; text-align: center;">
      <div style="font-size: 15px; color: #4B5563; font-weight: 500;">
        Loading GetYourGuide Product Details…
      </div>
    </div>
  `;
  host.appendChild(scrim);

  const closeDrawer = () => {
    scrim.remove();
  };

  scrim.onclick = (e) => {
    if (e.target === scrim) closeDrawer();
  };

  try {
    const p = await loadGygProduct(tourId, productId, viatorTourId, viatorProductCode);

    if (!p) {
      scrim.innerHTML = `
        <div class="gyg-portal-container" style="padding: 40px; text-align: center;">
          <h2 style="color: #DC2626; margin-bottom: 8px; font-size:18px;">GetYourGuide Data Not Found</h2>
          <p style="color: #6B7280; margin-bottom: 20px; font-size:13.5px;">
            No GetYourGuide product was found matching ID <span class="mono">${esc(String(tourId || viatorProductCode || '—'))}</span>.
          </p>
          <button class="btn primary" id="gygCloseErrBtn">Close</button>
        </div>
      `;
      const b = scrim.querySelector('#gygCloseErrBtn');
      if (b) b.onclick = closeDrawer;
      return;
    }

    if (!p.history) p.history = [];
    renderDrawerContent(scrim, p, closeDrawer);
  } catch (err) {
    console.error('Failed to open GYG drawer:', err);
    scrim.innerHTML = `
      <div class="gyg-portal-container" style="padding: 40px; text-align: center;">
        <h2 style="color: #DC2626; margin-bottom: 8px; font-size:18px;">Error Loading Product</h2>
        <p style="color: #6B7280; margin-bottom: 20px; font-size:13.5px;">
          ${esc(err.message || 'An unexpected error occurred while loading this product.')}
        </p>
        <button class="btn primary" id="gygCloseErrBtn">Close</button>
      </div>
    `;
    const b = scrim.querySelector('#gygCloseErrBtn');
    if (b) b.onclick = closeDrawer;
  }
}

function renderDrawerContent(scrim, p, closeDrawer) {
  const statusLower = (p.status || '').toLowerCase();
  let statusClass = 'bookable';
  if (statusLower.includes('reject')) statusClass = 'rejected';
  else if (statusLower.includes('not submitted') || statusLower.includes('draft') || statusLower.includes('pending')) statusClass = 'draft';

  const primaryOption = (p.options && p.options.length) ? p.options[0] : {
    id: p.option_id || '2272562',
    title: p.option_title || p.title || 'Standard Tour Option',
    ref_code: p.reference_code || 'default',
    status: p.status || 'Bookable',
    booking_engine: 'Automatically accept new bookings',
    cutoff_time: '10 hours',
    type: 'Private',
    connectivity: 'Not connected.',
    available_until: 'Tuesday, January 25th, 2028'
  };

  scrim.innerHTML = `
    <div class="gyg-portal-container" id="gygContainer">
      <!-- Authentic Top Portal Header -->
      <div class="gyg-portal-header" style="display:flex; justify-content:space-between; align-items:center; padding:12px 28px; background:#fff; border-bottom:1px solid #E5E7EB;">
        <div style="display:flex; align-items:center; gap:16px;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="font-size:14px; font-weight:600; color:#111827;">Unlocked – Fall 2026</span>
            <span style="background:#EEF2FF; color:#4F46E5; font-size:11px; font-weight:700; padding:2px 7px; border-radius:12px;">New</span>
          </div>
          <div style="display:flex; align-items:center; gap:5px; color:#4B5563; font-size:13.5px; cursor:pointer;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <span>Help</span>
          </div>
        </div>

        <div style="display:flex; align-items:center;">
          <button class="gyg-close-drawer-btn" id="gygBackBtn" title="Close" aria-label="Close">✕</button>
        </div>
      </div>

      <!-- Breadcrumbs -->
      <div class="gyg-breadcrumb-bar">
        <a href="javascript:void(0)" class="gyg-breadcrumb-link" id="gygBreadcrumbLink">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          Manage products
        </a>
      </div>

      <!-- Product Header Strip -->
      <div class="gyg-product-header">
        <div>
          <div class="gyg-product-title-row">
            <h1 class="gyg-product-title">${esc(p.title || '(Untitled GetYourGuide Product)')}</h1>
            <span class="gyg-status-pill ${statusClass}">
              <span class="gyg-status-dot"></span>
              ${esc(p.status || 'Draft')}
            </span>
          </div>
          <div class="gyg-meta-line">
            <span>Product Id: <b>${esc(p.tour_id)}</b></span>
            <span>Product Reference Code: <b>${esc(p.reference_code || p.product_reference_code || '—')}</b></span>
            <span>Rating: <span class="gyg-stars">★★★★★</span> <b>${esc(p.rating || 'Not rated')}</b></span>
            ${p.preview_url ? `
              <a href="${esc(p.preview_url)}" target="_blank" rel="noopener noreferrer" class="gyg-preview-link">
                Preview on website
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              </a>
            ` : ''}
          </div>
        </div>
        <div style="display:flex; gap:10px; align-items:center;">
          <button class="btn sm" id="gygTopEditBtn" style="background:#FFF0ED; color:#FF5533; border:1px solid #FFD5CC; font-weight:600; cursor:pointer;">
            Edit
          </button>
        </div>
      </div>

      <!-- Viator Mapping Banner -->
      ${p.matched_viator || p.viator_mapping ? `
        <div class="gyg-trace-banner" style="margin: 0 28px 24px 28px;">
          <div class="gyg-trace-content">
            <span class="gyg-trace-badge">VIATOR MAPPED</span>
            <div class="gyg-trace-details">
              <b>Viator Product:</b> <span class="mono">${esc((p.matched_viator && p.matched_viator.viator_product_code) || (p.viator_mapping && p.viator_mapping.product_code))}</span> — ${esc((p.matched_viator && p.matched_viator.viator_title) || (p.viator_mapping && p.viator_mapping.title))}
            </div>
          </div>
          <button class="btn sm primary" id="btnViewViatorMapping" style="cursor:pointer; white-space:nowrap;">
            View in Viator Drawer &rarr;
          </button>
        </div>
      ` : ''}

      <!-- Main Content 2-Column Grid -->
      <div class="gyg-content-grid" style="margin-top: 10px;">
        <!-- Left Column -->
        <div class="gyg-main-col">
          <!-- Main Information Card -->
          <div class="gyg-card">
            <div class="gyg-card-header">
              <h2 class="gyg-card-title">Main Information</h2>
              <button class="gyg-card-edit-btn" id="gygEditMainBtn">
                Edit
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 15l-6-6-6 6"/></svg>
              </button>
            </div>

            <div class="gyg-field-group">
              <div class="gyg-field-label">Title</div>
              <div class="gyg-field-value" style="font-weight:600; font-size:15px;">
                ${esc(p.title || '—')}
              </div>
            </div>

            <div class="gyg-field-group">
              <div class="gyg-field-label">Short description</div>
              <div class="gyg-field-desc">
                ${esc(p.short_description || '—')}
              </div>
            </div>

            <div class="gyg-field-group">
              <div class="gyg-field-label">Full description</div>
              <div class="gyg-field-desc" id="gygFullDescBox" style="white-space: pre-line;">
                ${esc(p.full_description ? p.full_description.slice(0, 480) : '—')}${p.full_description && p.full_description.length > 480 ? '…' : ''}
              </div>
              ${p.full_description && p.full_description.length > 480 ? `
                <button class="gyg-btn-see-more" id="gygSeeMoreBtn">
                  See more
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
                </button>
              ` : ''}
            </div>

            <div class="gyg-field-group" style="margin-bottom:0;">
              <div class="gyg-field-label">Highlights</div>
              ${(p.highlights && p.highlights.length) ? `
                <ul class="gyg-bullets">
                  ${p.highlights.map(h => `<li>${esc(h)}</li>`).join('')}
                </ul>
              ` : '<div class="gyg-field-desc hint">No highlights specified</div>'}
            </div>
          </div>

          <!-- Inclusions & Exclusions Card -->
          <div class="gyg-card">
            <div class="gyg-card-header">
              <h2 class="gyg-card-title">Inclusions & Exclusions</h2>
              <button class="gyg-card-edit-btn" id="gygEditIncExcBtn">
                Edit
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 15l-6-6-6 6"/></svg>
              </button>
            </div>

            <div class="gyg-field-group">
              <div class="gyg-field-label">Inclusions</div>
              ${(p.inclusions && p.inclusions.length) ? `
                <ul class="gyg-item-list">
                  ${p.inclusions.map(inc => `
                    <li>
                      <span class="gyg-icon-check">✓</span>
                      <span>${esc(inc)}</span>
                    </li>
                  `).join('')}
                </ul>
              ` : '<div class="gyg-field-desc hint">No inclusions specified</div>'}
            </div>

            <div class="gyg-field-group" style="margin-bottom:0;">
              <div class="gyg-field-label">Exclusions</div>
              ${(p.exclusions && p.exclusions.length) ? `
                <ul class="gyg-item-list">
                  ${p.exclusions.slice(0, 3).map(exc => `
                    <li>
                      <span class="gyg-icon-cross">✕</span>
                      <span>${esc(exc)}</span>
                    </li>
                  `).join('')}
                </ul>
                ${p.exclusions.length > 3 ? `
                  <button class="gyg-btn-see-more" id="gygSeeAllExcBtn" style="margin-top:6px;">
                    See all ${p.exclusions.length} exclusions
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
                  </button>
                ` : ''}
              ` : '<div class="gyg-field-desc hint">No exclusions specified</div>'}
            </div>
          </div>

          <!-- Important Information Card -->
          <div class="gyg-card">
            <div class="gyg-card-header">
              <h2 class="gyg-card-title">Important information</h2>
              <button class="gyg-card-edit-btn" id="gygEditInfoBtn">
                Edit
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 15l-6-6-6 6"/></svg>
              </button>
            </div>

            <div class="gyg-field-group">
              <div class="gyg-field-label">Who is this activity not suitable for?</div>
              <div class="gyg-field-desc">${esc(p.not_suitable_for || 'No restrictions specified')}</div>
            </div>

            <div class="gyg-field-group">
              <div class="gyg-field-label">What's not allowed?</div>
              <div class="gyg-field-desc">${esc(p.not_allowed || 'No restrictions specified')}</div>
            </div>

            <div class="gyg-field-group">
              <div class="gyg-field-label">Pet policy</div>
              <div class="gyg-field-desc">${esc(p.pet_policy || "This activity doesn't allow pets")}</div>
            </div>

            <div class="gyg-field-group">
              <div class="gyg-field-label">What mandatory items must the customer bring with them?</div>
              <div class="gyg-field-desc">${esc(p.mandatory_items || 'No items provided')}</div>
            </div>

            <div class="gyg-field-group">
              <div class="gyg-field-label">Know before you go</div>
              <div class="gyg-field-desc">${esc(p.know_before_you_go || 'No extra information provided')}</div>
            </div>

            <div class="gyg-field-group">
              <div class="gyg-field-label">Emergency contact number</div>
              <div class="gyg-field-value mono">${esc(p.emergency_contact || '+1 2099268262')}</div>
            </div>

            <div class="gyg-field-group" style="margin-bottom:0;">
              <div class="gyg-field-label">What information needs to appear on the ticket/voucher?</div>
              <div class="gyg-field-desc">${esc(p.ticket_info || 'Ticket/voucher info')}</div>
            </div>
          </div>

          <!-- Itinerary Card -->
          <div class="gyg-card">
            <div class="gyg-card-header">
              <h2 class="gyg-card-title">Itinerary</h2>
              <button class="gyg-card-edit-btn" id="gygEditItinBtn">
                Edit
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 15l-6-6-6 6"/></svg>
              </button>
            </div>

            <div class="gyg-field-group" style="margin-bottom:0;">
              <div class="gyg-itin-endpoint">
                <span class="gyg-itin-dot"></span>
                <span>Starting location: <b>${esc(p.starting_location || (p.itinerary && p.itinerary[0] && p.itinerary[0].title) || p.location || 'Meeting point')}</b></span>
              </div>

              ${(p.itinerary && p.itinerary.length) ? `
                <div class="gyg-timeline">
                  ${p.itinerary.map((stop, idx) => `
                    <div class="gyg-timeline-item">
                      <div class="gyg-timeline-num">${idx + 1}</div>
                      <div class="gyg-timeline-content">
                        <div class="gyg-timeline-title">${esc(stop.title || 'Stop')}</div>
                        <div class="gyg-timeline-desc">${esc(stop.details || 'Sightseeing, Walk, Visit, Guided tour (30min)')}</div>
                      </div>
                    </div>
                  `).join('')}
                </div>
                <div class="gyg-itin-endpoint" style="margin-top:12px;">
                  <span class="gyg-itin-dot" style="background:#EF4444;"></span>
                  <span>End location: <b>${esc(p.end_location || (p.itinerary[p.itinerary.length - 1] && p.itinerary[p.itinerary.length - 1].title) || 'Same as starting point')}</b></span>
                </div>
              ` : `
                <div class="gyg-field-desc hint" style="padding:12px 0;">
                  No intermediate stops recorded for this itinerary.
                </div>
              `}
            </div>
          </div>
        </div>

        <!-- Right Column (Sidebar Cards) -->
        <div class="gyg-side-col">
          <!-- Food & Drinks Card -->
          <div class="gyg-card">
            <div class="gyg-card-header">
              <h2 class="gyg-card-title">Food & Drinks</h2>
              <button class="gyg-card-edit-btn" id="gygEditFoodBtn">
                Edit
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 15l-6-6-6 6"/></svg>
              </button>
            </div>
            <div class="gyg-pill-box">${esc(p.food_and_drinks || 'No food or drinks included in this product')}</div>
          </div>

          <!-- Keywords Card -->
          <div class="gyg-card">
            <div class="gyg-card-header">
              <h2 class="gyg-card-title">Keywords</h2>
              <button class="gyg-card-edit-btn" id="gygEditKeywordsBtn">
                Edit
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 15l-6-6-6 6"/></svg>
              </button>
            </div>
            <div>
              ${(p.keywords && p.keywords.length) ? p.keywords.map(kw => `
                <span class="gyg-tag-pill">${esc(kw)}</span>
              `).join('') : '<div class="gyg-pill-box">No keywords added for this product</div>'}
            </div>
          </div>

          <!-- Guide Information Card -->
          <div class="gyg-card">
            <div class="gyg-card-header">
              <h2 class="gyg-card-title">Guide Information</h2>
              <button class="gyg-card-edit-btn" id="gygEditGuideBtn">
                Edit
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 15l-6-6-6 6"/></svg>
              </button>
            </div>
            <div>
              <span class="gyg-tag-pill">${esc(p.guide_information || 'Tour guide')}</span>
            </div>
          </div>

          <!-- Transportation Card -->
          <div class="gyg-card">
            <div class="gyg-card-header">
              <h2 class="gyg-card-title">Transportation</h2>
              <button class="gyg-card-edit-btn" id="gygEditTransBtn">
                Edit
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 15l-6-6-6 6"/></svg>
              </button>
            </div>
            <div class="gyg-pill-box">${esc(p.transportation || 'No transportation provided for this product')}</div>
          </div>

          <!-- Refund Policy Card -->
          <div class="gyg-card">
            <div class="gyg-card-header">
              <h2 class="gyg-card-title">Refund policy</h2>
              <button class="gyg-card-edit-btn" id="gygEditRefundBtn">
                Edit
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 15l-6-6-6 6"/></svg>
              </button>
            </div>
            <div style="font-size:13.5px; color:#4B5563; line-height:1.55;">
              ${esc(p.refund_policy || 'This activity has a Standard (24-hour) refund policy. Read the FAQ to learn more about refund policies.')}
            </div>
          </div>
        </div>
      </div>

      <!-- Options Section -->
      <div class="gyg-options-wrap">
        <div class="gyg-options-header">
          <h2 style="font-size: 20px; font-weight: 700; margin:0;">Options</h2>
          <button class="btn ghost sm" id="gygCreateOptBtn" style="color:#2563EB; font-weight:600; cursor:pointer;">
            + Create new option
          </button>
        </div>

        <div class="gyg-options-card">
          <div class="gyg-options-top">
            <div>
              <div style="font-size: 16px; font-weight: 700; color:#111827;">
                ${esc(primaryOption.title || p.title)}
              </div>
            </div>
            <div>
              <button class="btn sm ghost" id="gygEditOptionBtn" style="border: 1px solid #D1D5DB; border-radius: 20px; font-size: 13px; font-weight: 600; cursor:pointer;">
                Edit option
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
              </button>
            </div>
          </div>

          <div class="gyg-options-grid">
            <div>
              <div class="gyg-opt-label">Reference code</div>
              <div class="gyg-opt-val mono">${esc(primaryOption.ref_code || 'default')}</div>
            </div>
            <div>
              <div class="gyg-opt-label">Option ID</div>
              <div class="gyg-opt-val mono">${esc(primaryOption.id || '2272562')}</div>
            </div>
            <div>
              <div class="gyg-opt-label">Status</div>
              <div class="gyg-opt-val">
                <span class="gyg-status-pill ${statusClass}" style="padding: 2px 8px; font-size:11.5px;">
                  <span class="gyg-status-dot"></span>
                  ${esc(primaryOption.status || p.status || 'Bookable')}
                </span>
              </div>
            </div>
            <div>
              <div class="gyg-opt-label">Booking Engine</div>
              <div class="gyg-opt-val">${esc(primaryOption.booking_engine || 'Automatically accept new bookings')}</div>
            </div>
            <div>
              <div class="gyg-opt-label">Cut-off time</div>
              <div class="gyg-opt-val">${esc(primaryOption.cutoff_time || '10 hours')}</div>
            </div>
            <div>
              <div class="gyg-opt-label">Type</div>
              <div class="gyg-opt-val">${esc(primaryOption.type || 'Private')}</div>
            </div>
            <div>
              <div class="gyg-opt-label">Connectivity Settings</div>
              <div class="gyg-opt-val">${esc(primaryOption.connectivity || 'Not connected.')}</div>
            </div>
            <div>
              <div class="gyg-opt-label">Available until</div>
              <div class="gyg-opt-val">${esc(primaryOption.available_until || 'Tuesday, January 25th, 2028')}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- History Section -->
      <div class="gyg-history-wrap" style="margin-top: 28px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:8px;">
          <h2 style="font-size: 19px; font-weight: 700; margin:0; color:#111827;">
            Change History
            ${renderGygHistorySummary(p.history)}
          </h2>
          ${(p.history && p.history.length) ? `<span class="badge b-stub" style="background:#F3F4F6; color:#4B5563; font-size:11px; padding:3px 8px; border-radius:4px;">Tracked by change detection engine</span>` : ''}
        </div>
        ${renderGygHistoryCards(p.history, p.status)}
      </div>
    </div>
  `;

  // Attach All Event Listeners
  const backBtn = scrim.querySelector('#gygBackBtn');
  if (backBtn) backBtn.onclick = closeDrawer;

  const breadcrumbLink = scrim.querySelector('#gygBreadcrumbLink');
  if (breadcrumbLink) breadcrumbLink.onclick = closeDrawer;

  // See More Full Description
  const seeMoreBtn = scrim.querySelector('#gygSeeMoreBtn');
  if (seeMoreBtn) {
    let expanded = false;
    seeMoreBtn.onclick = () => {
      expanded = !expanded;
      const box = scrim.querySelector('#gygFullDescBox');
      if (expanded) {
        box.textContent = p.full_description || '';
        seeMoreBtn.innerHTML = `Show less <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 15l-6-6-6 6"/></svg>`;
      } else {
        box.textContent = (p.full_description ? p.full_description.slice(0, 480) : '') + '…';
        seeMoreBtn.innerHTML = `See more <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>`;
      }
    };
  }

  // See All Exclusions
  const seeAllExcBtn = scrim.querySelector('#gygSeeAllExcBtn');
  if (seeAllExcBtn && p.exclusions) {
    seeAllExcBtn.onclick = () => {
      const list = seeAllExcBtn.previousElementSibling;
      if (list) {
        list.innerHTML = p.exclusions.map(exc => `
          <li>
            <span class="gyg-icon-cross">✕</span>
            <span>${esc(exc)}</span>
          </li>
        `).join('');
        seeAllExcBtn.style.display = 'none';
      }
    };
  }

  // View Viator mapping click
  const viewViatorBtn = scrim.querySelector('#btnViewViatorMapping');
  if (viewViatorBtn) {
    viewViatorBtn.onclick = () => {
      const viatorCode = (p.matched_viator && (p.matched_viator.viator_product_code || p.matched_viator.product_code)) ||
                         (p.viator_mapping && (p.viator_mapping.product_code || p.viator_mapping.viator_product_code));
      closeDrawer();
      if (openDrawer && viatorCode) {
        openDrawer(viatorCode);
      }
    };
  }

  // ----------------- Interactive Edit Buttons -----------------
  const refreshMe = () => renderDrawerContent(scrim, p, closeDrawer);

  // Top Edit Button
  const topEditBtn = scrim.querySelector('#gygTopEditBtn');
  if (topEditBtn) {
    topEditBtn.onclick = () => openGygEditModal(p, 'Product Status & Overview', [
      { key: 'title', label: 'Product Title', value: p.title },
      { key: 'status', label: 'Status (e.g. Bookable, Draft, Rejected)', value: p.status || 'Bookable' },
      { key: 'reference_code', label: 'Product Reference Code', value: p.reference_code || p.product_reference_code || '' }
    ], refreshMe);
  }

  // Main Information Edit
  const editMainBtn = scrim.querySelector('#gygEditMainBtn');
  if (editMainBtn) {
    editMainBtn.onclick = () => openGygEditModal(p, 'Main Information', [
      { key: 'title', label: 'Title', value: p.title },
      { key: 'short_description', label: 'Short description', value: p.short_description, type: 'textarea', rows: 3 },
      { key: 'full_description', label: 'Full description', value: p.full_description, type: 'textarea', rows: 7 },
      { key: 'highlights', label: 'Highlights (one per line)', value: (p.highlights || []).join('\n'), type: 'textarea', rows: 4,
        hint: 'Enter each bullet point on a new line',
        parser: v => v.split('\n').map(x => x.trim()).filter(Boolean) }
    ], refreshMe);
  }

  // Inclusions & Exclusions Edit
  const editIncExcBtn = scrim.querySelector('#gygEditIncExcBtn');
  if (editIncExcBtn) {
    editIncExcBtn.onclick = () => openGygEditModal(p, 'Inclusions & Exclusions', [
      { key: 'inclusions', label: 'Inclusions (one per line)', value: (p.inclusions || []).join('\n'), type: 'textarea', rows: 4,
        hint: 'Enter each included item on a new line',
        parser: v => v.split('\n').map(x => x.trim()).filter(Boolean) },
      { key: 'exclusions', label: 'Exclusions (one per line)', value: (p.exclusions || []).join('\n'), type: 'textarea', rows: 4,
        hint: 'Enter each excluded item on a new line',
        parser: v => v.split('\n').map(x => x.trim()).filter(Boolean) }
    ], refreshMe);
  }

  // Important Information Edit
  const editInfoBtn = scrim.querySelector('#gygEditInfoBtn');
  if (editInfoBtn) {
    editInfoBtn.onclick = () => openGygEditModal(p, 'Important information', [
      { key: 'not_suitable_for', label: 'Who is this activity not suitable for?', value: p.not_suitable_for || 'No restrictions specified' },
      { key: 'not_allowed', label: "What's not allowed?", value: p.not_allowed || 'No restrictions specified' },
      { key: 'pet_policy', label: 'Pet policy', value: p.pet_policy || "This activity doesn't allow pets" },
      { key: 'mandatory_items', label: 'Mandatory items to bring', value: p.mandatory_items || 'No items provided' },
      { key: 'know_before_you_go', label: 'Know before you go', value: p.know_before_you_go || 'No extra information provided' },
      { key: 'emergency_contact', label: 'Emergency contact number', value: p.emergency_contact || '+1 2099268262' }
    ], refreshMe);
  }

  // Itinerary Edit
  const editItinBtn = scrim.querySelector('#gygEditItinBtn');
  if (editItinBtn) {
    editItinBtn.onclick = () => openGygEditModal(p, 'Itinerary', [
      { key: 'starting_location', label: 'Starting location', value: p.starting_location || (p.itinerary && p.itinerary[0] && p.itinerary[0].title) || p.location || '' },
      { key: 'itinerary', label: 'Itinerary Stops (Stop Name — Details, one per line)',
        value: (p.itinerary || []).map(it => `${it.title || ''}${it.details ? ' — ' + it.details : ''}`).join('\n'),
        type: 'textarea', rows: 6,
        hint: 'Format: Stop Name — Details (e.g. Templo Mayor Museum — Guided tour, 30min)',
        parser: v => v.split('\n').map(x => x.trim()).filter(Boolean).map(line => {
          const parts = line.split('—');
          return { title: parts[0].trim(), details: parts[1] ? parts[1].trim() : 'Sightseeing, Walk, Visit, Guided tour (30min)' };
        })
      },
      { key: 'end_location', label: 'End location', value: p.end_location || '' }
    ], refreshMe);
  }

  // Food & Drinks Edit
  const editFoodBtn = scrim.querySelector('#gygEditFoodBtn');
  if (editFoodBtn) {
    editFoodBtn.onclick = () => openGygEditModal(p, 'Food & Drinks', [
      { key: 'food_and_drinks', label: 'Food & drinks description', value: p.food_and_drinks || 'No food or drinks included in this product' }
    ], refreshMe);
  }

  // Keywords Edit
  const editKeywordsBtn = scrim.querySelector('#gygEditKeywordsBtn');
  if (editKeywordsBtn) {
    editKeywordsBtn.onclick = () => openGygEditModal(p, 'Keywords', [
      { key: 'keywords', label: 'Keywords (comma-separated)', value: (p.keywords || []).join(', '),
        hint: 'Enter comma-separated keywords (e.g. day of the dead, walking tour, historic)',
        parser: v => v.split(',').map(x => x.trim()).filter(Boolean) }
    ], refreshMe);
  }

  // Guide Information Edit
  const editGuideBtn = scrim.querySelector('#gygEditGuideBtn');
  if (editGuideBtn) {
    editGuideBtn.onclick = () => openGygEditModal(p, 'Guide Information', [
      { key: 'guide_information', label: 'Tour Guide Information', value: p.guide_information || 'Tour guide' }
    ], refreshMe);
  }

  // Transportation Edit
  const editTransBtn = scrim.querySelector('#gygEditTransBtn');
  if (editTransBtn) {
    editTransBtn.onclick = () => openGygEditModal(p, 'Transportation', [
      { key: 'transportation', label: 'Transportation details', value: p.transportation || 'No transportation provided for this product' }
    ], refreshMe);
  }

  // Refund Policy Edit
  const editRefundBtn = scrim.querySelector('#gygEditRefundBtn');
  if (editRefundBtn) {
    editRefundBtn.onclick = () => openGygEditModal(p, 'Refund Policy', [
      { key: 'refund_policy', label: 'Refund policy text', value: p.refund_policy || 'This activity has a Standard (24-hour) refund policy. Read the FAQ to learn more about refund policies.', type: 'textarea', rows: 3 }
    ], refreshMe);
  }

  // Option Edit
  const editOptionBtn = scrim.querySelector('#gygEditOptionBtn');
  if (editOptionBtn) {
    editOptionBtn.onclick = () => openGygEditModal(p, 'Option Details', [
      { key: 'option_title', label: 'Option Title', value: primaryOption.title || p.title },
      { key: 'cutoff_time', label: 'Cut-off time', value: primaryOption.cutoff_time || '10 hours' },
      { key: 'type', label: 'Type (Private / Group)', value: primaryOption.type || 'Private' },
      { key: 'available_until', label: 'Available until', value: primaryOption.available_until || 'Tuesday, January 25th, 2028' },
      { key: 'booking_engine', label: 'Booking engine mode', value: primaryOption.booking_engine || 'Automatically accept new bookings' }
    ], () => {
      if (!p.options) p.options = [{}];
      p.options[0] = {
        ...p.options[0],
        title: p.option_title || p.title,
        cutoff_time: p.cutoff_time || '10 hours',
        type: p.type || 'Private',
        available_until: p.available_until || 'Tuesday, January 25th, 2028',
        booking_engine: p.booking_engine || 'Automatically accept new bookings'
      };
      refreshMe();
    });
  }
}

function isSameValue(a, b) {
  if (a === b) return true;
  if ((a === null || a === undefined || a === '') && (b === null || b === undefined || b === '')) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    const arrA = Array.isArray(a) ? a : (a ? [a] : []);
    const arrB = Array.isArray(b) ? b : (b ? [b] : []);
    if (arrA.length !== arrB.length) return false;
    return JSON.stringify(arrA.map(x => typeof x === 'string' ? x.trim() : x)) ===
           JSON.stringify(arrB.map(x => typeof x === 'string' ? x.trim() : x));
  }
  if (typeof a === 'object' && typeof b === 'object' && a && b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  const sa = String(a ?? '').replace(/\r\n/g, '\n').trim();
  const sb = String(b ?? '').replace(/\r\n/g, '\n').trim();
  return sa === sb;
}

async function openGygEditModal(p, sectionName, fields, onSaved) {
  const who = await askEditor();
  if (!who) return;

  // Record original values for accurate diffing
  fields.forEach(f => {
    if (f.origValue === undefined) {
      f.origValue = f.value !== undefined ? f.value : p[f.key];
    }
  });

  const host = $('#modalHost') || document.body;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="scrim"></div>
    <div class="modal card wide" style="max-width: 620px; z-index: 10001;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h2 style="font-size:18px; margin:0; font-weight:700; color:#111827;">Edit ${esc(sectionName)}</h2>
        <span class="badge" style="background:#FFF0ED; color:#FF5533; font-weight:600; border:1px solid #FFD5CC;">GetYourGuide</span>
      </div>
      <p class="hint" style="margin:0 0 14px; font-size:13px; color:#6B7280;">
        Editing GetYourGuide Product <span class="mono">${esc(p.tour_id)}</span>. Changes are recorded with author <b>${esc(who)}</b>.
      </p>
      <div class="formgrid" style="display:flex; flex-direction:column; gap:12px;">
        ${fields.map(f => {
          let displayVal = f.value != null ? f.value : (p[f.key] != null ? p[f.key] : '');
          if (Array.isArray(displayVal)) {
            displayVal = displayVal.join('\n');
          }
          const isTextArea = f.type === 'textarea' || (typeof displayVal === 'string' && (displayVal.length > 70 || displayVal.includes('\n')));
          return `
            <label style="display:block;">
              <span style="font-size:13px; font-weight:600; color:#374151; display:block; margin-bottom:4px;">${esc(f.label)}</span>
              ${isTextArea
                ? `<textarea data-field="${esc(f.key)}" rows="${f.rows || 4}" style="width:100%; box-sizing:border-box; border:1px solid #D1D5DB; border-radius:6px; padding:8px 10px; font-size:13.5px; font-family:inherit;">${esc(displayVal)}</textarea>`
                : `<input type="text" data-field="${esc(f.key)}" value="${esc(displayVal)}" style="width:100%; box-sizing:border-box; border:1px solid #D1D5DB; border-radius:6px; padding:8px 10px; font-size:13.5px; font-family:inherit;">`
              }
              ${f.hint ? `<span class="hint" style="font-size:11.5px; margin-top:3px; display:block; color:#9CA3AF;">${esc(f.hint)}</span>` : ''}
            </label>
          `;
        }).join('')}
      </div>
      <label class="fl" style="margin-top:14px; display:block;">
        <span style="font-size:13px; font-weight:600; color:#374151; display:block; margin-bottom:4px;">Reason for change (optional)</span>
        <input type="text" id="gygEditNote" placeholder="e.g. Updated content from GetYourGuide portal" style="width:100%; box-sizing:border-box; border:1px solid #D1D5DB; border-radius:6px; padding:8px 10px; font-size:13.5px;">
      </label>
      <div id="gygEditErr" class="banner hidden" style="margin:12px 0;"></div>
      <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:20px;">
        <button class="btn ghost" id="gygEditCancel">Cancel</button>
        <button class="btn primary" id="gygEditSave" style="background:#FF5533; border-color:#FF5533;">Save changes</button>
      </div>
    </div>
  `;
  host.appendChild(wrap);

  const close = () => { wrap.remove(); };
  wrap.querySelector('.scrim').onclick = close;
  wrap.querySelector('#gygEditCancel').onclick = close;

  wrap.querySelector('#gygEditSave').onclick = async () => {
    const saveBtn = wrap.querySelector('#gygEditSave');
    const errBox = wrap.querySelector('#gygEditErr');
    const note = (wrap.querySelector('#gygEditNote').value || '').trim();

    const edits = {};
    fields.forEach(f => {
      const el = wrap.querySelector(`[data-field="${f.key}"]`);
      if (el) {
        let val = el.value.trim();
        if (f.parser) {
          val = f.parser(val);
        }
        const orig = f.origValue !== undefined ? f.origValue : (f.value !== undefined ? f.value : p[f.key]);
        if (!isSameValue(orig, val)) {
          edits[f.key] = val;
        }
      }
    });

    if (Object.keys(edits).length === 0) {
      close();
      toast('No changes detected', { kind: 'info' });
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    try {
      try {
        const res = await post(`/api/gyg/product/${encodeURIComponent(p.tour_id)}/edit`, {
          section: sectionName,
          edits: edits,
          editor_email: who,
          note: note
        });
        if (res && res.changes && res.changes.length) {
          p.history = res.changes;
        } else if (res && res.product && res.product.history && res.product.history.length >= (p.history || []).length) {
          p.history = res.product.history;
        } else {
          applyLocalEdits(p, sectionName, edits, who);
        }
        if (res && res.product) {
          const { history, ...restProd } = res.product;
          Object.assign(p, edits, restProd);
        } else {
          Object.assign(p, edits);
        }
      } catch (err) {
        applyLocalEdits(p, sectionName, edits, who);
      }

      if (gygCatalogCache) {
        for (const k of [p.tour_id, p.product_code]) {
          if (k && gygCatalogCache[k]) {
            Object.assign(gygCatalogCache[k], edits, p);
          }
        }
      }

      close();
      toast(`Saved changes to ${sectionName}`, { kind: 'ok' });
      if (onSaved) onSaved();
    } catch (e) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save changes';
      errBox.className = 'banner';
      errBox.textContent = e.message || String(e);
    }
  };
}

function normalizeChange(item, currentStatus) {
  const who = item.operator_email || item.editor || item.who || 'operator@opatrip.com';
  let path = item.field_path || item.section || item.field || 'Field';
  if (path.startsWith('gyg.')) path = path.slice(4);
  if (path.startsWith('gyg_history.')) path = path.slice(12);
  const fieldName = item.field && item.field !== path ? item.field : '';
  const beforeVal = (item.before !== undefined && item.before !== null) ? item.before : (item.old_value !== undefined ? item.old_value : '—');
  const afterVal = (item.after !== undefined && item.after !== null) ? item.after : (item.new_value !== undefined ? item.new_value : '—');
  const rawDate = item.date || item.detected_at || item.at || '';
  const dateStr = rawDate ? whenLong(rawDate) : 'Recently';
  const statusVal = item.status || currentStatus || 'Bookable';
  const sourceBadge = (item.source === 'dashboard' || item.editor) ? 'edited here' : 'changed on GetYourGuide';
  return { who, path, fieldName, before: beforeVal, after: afterVal, at: dateStr, status: statusVal, source: sourceBadge };
}

function renderGygHistorySummary(historyList) {
  if (!historyList || !historyList.length) return '';
  const fields = new Set();
  historyList.forEach(item => {
    const p = item.field_path || item.section || item.field || 'Field';
    fields.add(p);
  });
  const things = fields.size;
  const edits = historyList.length;
  if (things === edits) {
    return `<span style="font-size:13px; font-weight:500; color:#6B7280; margin-left:6px;">(${things} field${things===1?'':'s'} changed)</span>`;
  }
  return `<span style="font-size:13px; font-weight:500; color:#6B7280; margin-left:6px;">(${things} field${things===1?'':'s'} changed · ${edits} edits total)</span>`;
}

function renderGygHistoryCards(historyList, currentStatus) {
  if (!historyList || !historyList.length) {
    return `
      <div style="background:#fff; border:1px solid #E5E7EB; border-radius:12px; padding:32px 20px; text-align:center;">
        <div style="width:38px; height:38px; border-radius:50%; background:#F3F4F6; color:#9CA3AF; display:grid; place-items:center; margin:0 auto 10px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </div>
        <div style="font-size:14.5px; font-weight:600; color:#374151;">No changes recorded yet</div>
        <div style="font-size:13px; color:#9CA3AF; margin-top:4px;">Changes and edits made to this product will be tracked and displayed here with before and after comparisons.</div>
      </div>
    `;
  }

  // Group by field path — exactly like Viator's "One box per thing that changed"
  const groups = new Map();
  historyList.forEach(item => {
    const h = normalizeChange(item, currentStatus);
    const key = `${h.path}${h.fieldName ? ' › ' + h.fieldName : ''}`.trim();
    if (!groups.has(key)) {
      groups.set(key, { key, path: h.path, fieldName: h.fieldName, list: [] });
    }
    groups.get(key).list.push(h);
  });

  const cardList = [...groups.values()];

  return `
    <div class="ehist" style="display:grid; gap:12px;">
      ${cardList.map((g, gIdx) => {
        const latest = g.list[0];
        const initial = (latest.who[0] || 'O').toUpperCase();
        const hasRevisions = g.list.length > 1;
        const revId = `gygRev_${gIdx}`;

        return `
          <div class="eh" style="display:grid; grid-template-columns:36px 1fr; gap:14px; padding:16px; background:#fff; border:1px solid #E5E7EB; border-radius:10px; transition:border-color 0.15s ease;">
            <div class="eh-av" style="width:36px; height:36px; border-radius:50%; background:#EEF2FF; color:#4F46E5; display:grid; place-items:center; font-weight:700; font-size:14px;" title="${esc(latest.who)}">
              ${esc(initial)}
            </div>
            <div style="min-width:0;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
                <div class="eh-what" style="font-size:14px; font-weight:700; color:#111827; margin:0;">
                  ${esc(latest.path)}${latest.fieldName ? ` <span class="eh-sub" style="color:#6B7280; font-weight:500;">› ${esc(latest.fieldName)}</span>` : ''}
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                  ${hasRevisions ? `
                    <button type="button" class="badge" style="background:#F3F4F6; color:#4B5563; font-size:11px; padding:2px 8px; border:1px solid #E5E7EB; border-radius:12px; cursor:pointer;" onclick="const el=document.getElementById('${revId}'); if(el){ const isHidden=el.style.display==='none'; el.style.display=isHidden?'block':'none'; this.textContent=isHidden?'Hide earlier revisions':'${g.list.length} revisions · Show history'; }">
                      ${g.list.length} revisions · Show history
                    </button>
                  ` : ''}
                  <span class="gyg-status-pill bookable" style="font-size:11px; padding:2px 8px;">
                    ${esc(latest.status)}
                  </span>
                </div>
              </div>
              <div class="eh-rep" style="display:grid; grid-template-columns:1fr 28px 1fr; gap:10px; align-items:stretch;">
                <div class="eh-side" style="min-width:0; background:#F9FAFB; border:1px solid #E5E7EB; border-radius:8px; padding:9px 12px;">
                  <span class="eh-lbl" style="display:block; font-size:11px; font-weight:700; color:#6B7280; letter-spacing:0.04em; text-transform:uppercase; margin-bottom:4px;">Before</span>
                  <div style="font-size:13px; color:#4B5563; word-break:break-word; max-height:140px; overflow-y:auto; line-height:1.45; white-space:pre-wrap;">
                    ${esc(formatDisplayVal(latest.before))}
                  </div>
                </div>
                <div class="eh-arrow" style="align-self:center; text-align:center; color:#9CA3AF; font-size:16px;" aria-hidden="true">→</div>
                <div class="eh-side after" style="min-width:0; background:#F0FDF4; border:1px solid #BBF7D0; border-radius:8px; padding:9px 12px;">
                  <span class="eh-lbl" style="display:block; font-size:11px; font-weight:700; color:#166534; letter-spacing:0.04em; text-transform:uppercase; margin-bottom:4px;">After</span>
                  <div style="font-size:13px; color:#15803D; font-weight:600; word-break:break-word; max-height:140px; overflow-y:auto; line-height:1.45; white-space:pre-wrap;">
                    ${esc(formatDisplayVal(latest.after))}
                  </div>
                </div>
              </div>
              <div class="eh-foot" style="display:flex; gap:9px; align-items:center; flex-wrap:wrap; margin-top:12px; font-size:12.5px;">
                <b style="color:#374151;">${esc(latest.who)}</b>
                <span class="eh-when" style="color:#9CA3AF;">${esc(latest.at ? whenLong(latest.at) : 'Recently')}</span>
                <span class="badge b-stub" style="background:#EEF2FF; color:#4F46E5; font-size:11px; padding:2px 7px; border-radius:4px;">
                  ${esc(latest.source)}
                </span>
              </div>

              ${hasRevisions ? `
                <div id="${revId}" style="display:none; margin-top:12px; padding-top:12px; border-top:1px dashed #E5E7EB;">
                  <div style="font-size:11.5px; font-weight:700; color:#6B7280; text-transform:uppercase; margin-bottom:8px; letter-spacing:0.03em;">Earlier Revisions</div>
                  ${g.list.slice(1).map(past => `
                    <div style="padding:9px 12px; margin-bottom:6px; background:#F9FAFB; border:1px solid #E5E7EB; border-radius:6px; font-size:12px;">
                      <div style="display:flex; justify-content:space-between; margin-bottom:4px; color:#6B7280;">
                        <span><b>${esc(past.who)}</b></span>
                        <span>${esc(past.at ? whenLong(past.at) : 'Recently')}</span>
                      </div>
                      <div style="color:#374151; word-break:break-word; white-space:pre-wrap;">
                        <span style="color:#6B7280;">Was:</span> ${esc(formatDisplayVal(past.before))} 
                        <span style="color:#9CA3AF; margin:0 4px;">→</span> 
                        <span style="color:#15803D; font-weight:600;">${esc(formatDisplayVal(past.after))}</span>
                      </div>
                    </div>
                  `).join('')}
                </div>
              ` : ''}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function applyLocalEdits(p, sectionName, edits, who) {
  const historyList = p.history || (p.history = []);
  const nowStr = new Date().toISOString();
  Object.keys(edits).forEach(k => {
    const oldVal = p[k];
    const newVal = edits[k];
    if (isSameValue(oldVal, newVal)) return;
    historyList.unshift({
      date: nowStr,
      status: p.status || 'Bookable',
      section: sectionName,
      field: k,
      field_path: `${sectionName} › ${k}`,
      before: oldVal !== undefined && oldVal !== null ? (typeof oldVal === 'object' ? JSON.stringify(oldVal) : String(oldVal)) : '—',
      after: newVal !== undefined && newVal !== null ? (typeof newVal === 'object' ? JSON.stringify(newVal) : String(newVal)) : '—',
      old_value: oldVal !== undefined && oldVal !== null ? (typeof oldVal === 'object' ? JSON.stringify(oldVal) : String(oldVal)) : '—',
      new_value: newVal !== undefined && newVal !== null ? (typeof newVal === 'object' ? JSON.stringify(newVal) : String(newVal)) : '—',
      editor: who,
      operator_email: who,
      source: 'dashboard'
    });
  });
  Object.assign(p, edits);
}

// Global window hook for compatibility with products.js
window.openGygDrawer = openGygDrawer;
