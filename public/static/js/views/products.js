import { S } from '../state.js';
import { $, cachedApi, el, esc, q, session, invalidate } from '../core.js';
import { monthName, qualBadge, statusBadge } from '../format.js';
import { skeleton } from '../ui.js';
import { openDrawer, when } from './drawer.js';
import { openGygDrawer } from './gyg_drawer.js';
import { openCreateProductModal } from '../edit.js';
import { toast } from '../toast.js';

/* ======================= products ======================= */


/* Where this tour is listed — the Platforms tab, brought onto the row.
   Every known platform gets a line, not only the ones with a listing: "Not uploaded" is
   the whole point of the grid, because a gap is the thing worth seeing.

   THE ROW'S OWN LISTING WINS. Tours are grouped by normalised title, so one tour often
   holds several listings on the same platform — 72 of them here, under different
   accounts. Keeping whichever arrived last made a Live product's own Viator row read
   "Draft" because a namesake in another account was a draft. Match on product_code
   first; only fall back to a sibling when this product isn't on that platform at all.
   The siblings are not marked: the product code already says which listing this is. */
function platformGrid(p, platforms){
  const by = {};
  (p.tour_listings || []).forEach(l => { (by[l.platform] = by[l.platform] || []).push(l); });
  // names come from the platform list, which the filter bar already loaded — the
  // listings themselves carry only codes now
  const known = (platforms || []).length
    ? platforms
    : Object.keys(by).map(code => ({code, name: code}));
  if (!known.length) return '';
  return `<div class="pp-h">Listed on</div><div class="pp-grid">${known.map(pl => {
    const ls = by[pl.code] || [];
    // this product's own listing, never a namesake's from another account
    const l = ls.find(x => x.code === p.product_code) || ls[0];
    const isOwn = l && l.code === p.product_code;
    const st = isOwn ? (p.status || l.status) : (l ? (l.raw_status || l.status) : null);
    const isGyg = pl.code === 'getyourguide';
    const clickAttr = isGyg
      ? `onclick="event.stopPropagation(); window.openGygDrawer && window.openGygDrawer('${esc(l ? l.code : '')}', ${l && l.product_id ? l.product_id : 'null'}, ${p.tour_id || 'null'}, '${esc(p.product_code || '')}')" style="cursor:pointer;" title="Click to view GetYourGuide product details"`
      : '';
    const hoverCls = isGyg ? ' pp-row-interactive' : '';
    return `<div class="pp-row${hoverCls}" ${clickAttr}><span class="pp-n">${esc(pl.name)}</span>${
      st ? statusBadge(st)
        : '<span class="badge b-notlisted">Not uploaded</span>'}</div>`;
  }).join('')}</div>`;
}

function createSearchableSelect({ id, title, allLabel, searchPlaceholder, options, value, onChange }){
  const wrap = el('div', 'searchable-select');
  wrap.id = id + '_wrap';

  const btn = el('button', 'searchable-select-btn' + (value ? ' has-value' : ''));
  btn.type = 'button';
  btn.id = id;
  btn.title = title;
  btn.innerHTML = `
    <span class="searchable-select-val">${esc(value || allLabel)}</span>
    ${value ? `<span class="searchable-select-clear" title="Clear ${esc(title)}">×</span>` : ''}
    <svg class="searchable-select-arrow" viewBox="0 0 16 16" width="11" height="11">
      <path d="M3.5 6l4.5 4.5 4.5-4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  wrap.appendChild(btn);

  const dropdown = el('div', 'searchable-select-dropdown');
  dropdown.style.display = 'none';
  dropdown.innerHTML = `
    <div class="searchable-select-search-box">
      <svg viewBox="0 0 16 16" width="13" height="13">
        <path d="M11 6.5a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0zm-.8 3.7l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
      <input type="text" class="searchable-select-input" placeholder="${esc(searchPlaceholder)}" autocomplete="off" />
      <span class="searchable-select-input-clear" style="display:none" title="Clear text">×</span>
    </div>
    <div class="searchable-select-list"></div>`;
  wrap.appendChild(dropdown);

  const searchInput = dropdown.querySelector('.searchable-select-input');
  const inputClear = dropdown.querySelector('.searchable-select-input-clear');
  const listEl = dropdown.querySelector('.searchable-select-list');

  let focusedIndex = -1;

  function renderList(query = ''){
    const qLower = query.trim().toLowerCase();
    listEl.innerHTML = '';
    focusedIndex = -1;

    const rawOpts = (options || []).filter(Boolean);
    const matches = qLower
      ? rawOpts.filter(opt => String(opt).toLowerCase().includes(qLower))
      : rawOpts;

    if (!qLower){
      const allItem = el('div', 'searchable-select-item' + (!value ? ' is-selected' : ''));
      allItem.innerHTML = `<span>${esc(allLabel)}</span>${!value ? '<span style="color:var(--accent);font-weight:700">✓</span>' : ''}`;
      allItem.onclick = (e) => {
        e.stopPropagation();
        closeDropdown();
        if (value) onChange('');
      };
      listEl.appendChild(allItem);
    }

    if (!matches.length){
      const empty = el('div', 'searchable-select-empty');
      empty.textContent = `No matching ${title.toLowerCase()}`;
      listEl.appendChild(empty);
      return;
    }

    matches.forEach(opt => {
      const isSel = opt === value;
      const item = el('div', 'searchable-select-item' + (isSel ? ' is-selected' : ''));

      let labelHtml = esc(opt);
      if (qLower){
        const idx = opt.toLowerCase().indexOf(qLower);
        if (idx !== -1){
          const before = esc(opt.slice(0, idx));
          const match = esc(opt.slice(idx, idx + qLower.length));
          const after = esc(opt.slice(idx + qLower.length));
          labelHtml = `${before}<mark>${match}</mark>${after}`;
        }
      }

      item.innerHTML = `<span>${labelHtml}</span>${isSel ? '<span style="color:var(--accent);font-weight:700">✓</span>' : ''}`;
      item.onclick = (e) => {
        e.stopPropagation();
        closeDropdown();
        onChange(opt);
      };
      listEl.appendChild(item);
    });
  }

  function openDropdown(){
    document.querySelectorAll('.searchable-select.is-active').forEach(other => {
      if (other !== wrap){
        other.classList.remove('is-active');
        const d = other.querySelector('.searchable-select-dropdown');
        if (d) d.style.display = 'none';
      }
    });

    wrap.classList.add('is-active');
    dropdown.style.display = 'flex';
    searchInput.value = '';
    inputClear.style.display = 'none';
    renderList('');
    setTimeout(() => searchInput.focus(), 25);
  }

  function closeDropdown(){
    wrap.classList.remove('is-active');
    dropdown.style.display = 'none';
    focusedIndex = -1;
  }

  btn.onclick = (e) => {
    if (e.target.classList.contains('searchable-select-clear')){
      e.stopPropagation();
      closeDropdown();
      onChange('');
      return;
    }
    if (wrap.classList.contains('is-active')){
      closeDropdown();
    } else {
      openDropdown();
    }
  };

  searchInput.oninput = () => {
    const qVal = searchInput.value;
    inputClear.style.display = qVal ? 'block' : 'none';
    renderList(qVal);
  };

  inputClear.onclick = (e) => {
    e.stopPropagation();
    searchInput.value = '';
    inputClear.style.display = 'none';
    renderList('');
    searchInput.focus();
  };

  searchInput.onkeydown = (e) => {
    const items = listEl.querySelectorAll('.searchable-select-item');
    if (!items.length) return;

    if (e.key === 'ArrowDown'){
      e.preventDefault();
      focusedIndex = (focusedIndex + 1) % items.length;
      updateHighlight(items);
    } else if (e.key === 'ArrowUp'){
      e.preventDefault();
      focusedIndex = (focusedIndex - 1 + items.length) % items.length;
      updateHighlight(items);
    } else if (e.key === 'Enter'){
      e.preventDefault();
      if (focusedIndex >= 0 && focusedIndex < items.length){
        items[focusedIndex].click();
      } else if (items.length > 0){
        items[0].click();
      }
    } else if (e.key === 'Escape'){
      e.preventDefault();
      closeDropdown();
      btn.focus();
    }
  };

  function updateHighlight(items){
    items.forEach((it, idx) => {
      it.classList.toggle('is-focused', idx === focusedIndex);
      if (idx === focusedIndex){
        it.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  const onDocClick = (e) => {
    if (!wrap.isConnected){
      document.removeEventListener('click', onDocClick);
      return;
    }
    if (!wrap.contains(e.target)){
      closeDropdown();
    }
  };
  document.addEventListener('click', onDocClick);

  return wrap;
}

let _gygCatalogPromise = null;
let _gygCodeMap = null;

function loadGygCatalogMap() {
  if (_gygCodeMap) return Promise.resolve(_gygCodeMap);
  if (!_gygCatalogPromise) {
    _gygCatalogPromise = (async () => {
      try {
        const res = await fetch('/static/data/gyg_catalog.json');
        if (!res.ok) return {};
        const cat = await res.json();
        const map = {};
        for (const [gid, item] of Object.entries(cat)) {
          const vm = item.matched_viator || item.viator_match || item.viator_mapping;
          if (vm) {
            const vc = (vm.viator_product_code || vm.product_code || '').trim().toUpperCase();
            if (vc && !map[vc]) {
              map[vc] = item.product_reference_code || item.reference_code || String(item.tour_id || gid);
            }
          }
        }
        _gygCodeMap = map;
        return map;
      } catch (e) {
        console.warn('Failed to load gyg_catalog.json', e);
        _gygCodeMap = {};
        return _gygCodeMap;
      }
    })();
  }
  return _gygCatalogPromise;
}

function renderGygRefWidget(p, onUpdate) {
  const isGygRow = (
    p.platform_id === 2 ||
    p.platform_code === 'getyourguide' ||
    (p.account_name && String(p.account_name).toLowerCase().includes('gyg')) ||
    (p.viator_account_id && String(p.viator_account_id).toLowerCase().includes('gyg')) ||
    (/^\d{6,8}$/.test(String(p.product_code || '')))
  ) && (p.platform_id !== 1 && p.platform_code !== 'viator');

  if (isGygRow) return null;

  const wrap = el('div', 'p-gyg-ref-widget');
  wrap.onclick = e => e.stopPropagation();

  const pCode = String(p.product_code || '').trim().toUpperCase();
  const currentRef = p.gyg_reference || (_gygCodeMap && _gygCodeMap[pCode]) || '';

  wrap.innerHTML = `
    <div class="gyg-ref-form">
      <input type="text"
             class="gyg-ref-input mono"
             data-product-code="${esc(pCode)}"
             placeholder="Paste GYG ref code.."
             value="${esc(currentRef)}"
             spellcheck="false"
             autocomplete="off"
             title="${currentRef ? 'GetYourGuide Reference Code: ' + esc(currentRef) : 'Paste GYG reference code'}" />
      <button type="button" class="gyg-ref-save-btn" title="Save GYG Reference Code">
        <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2">
          <path d="M3 8.5l3.5 3.5 6.5-7"/>
        </svg>
        <span>Save</span>
      </button>
    </div>`;

  const input = wrap.querySelector('.gyg-ref-input');
  const saveBtn = wrap.querySelector('.gyg-ref-save-btn');

  if (input) {
    input.onclick = e => e.stopPropagation();
    input.onkeydown = e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        doSave(input.value.trim());
      }
    };
  }

  if (saveBtn) {
    saveBtn.onclick = (e) => {
      e.stopPropagation();
      doSave(input ? input.value.trim() : '');
    };
  }

  async function doSave(newVal) {
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = `<span>Saving...</span>`;
    }
    try {
      const res = await fetch('/api/products/map-gyg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: p.id,
          product_code: p.product_code,
          gyg_ref: newVal
        })
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.detail || data.message || 'Failed to save');
      }
      p.gyg_reference = newVal || null;
      if (_gygCodeMap) {
        if (newVal) _gygCodeMap[pCode] = newVal;
        else delete _gygCodeMap[pCode];
      }
      if (data.gyg_tour_id) p.gyg_tour_id = data.gyg_tour_id;
      if (data.tour_listings) p.tour_listings = data.tour_listings;
      if (data.tour_id) p.tour_id = data.tour_id;

      if (input) {
        input.value = newVal || '';
        input.title = newVal ? `GetYourGuide Reference Code: ${newVal}` : 'Paste GYG reference code';
      }

      if (newVal) {
        toast(data.mapped ? `Linked to GYG product (${data.gyg_tour_id || newVal})!` : `GYG reference code saved! Auto-mapping ready.`);
      } else {
        toast(`GYG reference code unlinked.`);
      }
      if (onUpdate) onUpdate(data);
    } catch (err) {
      toast(`Error: ${err.message}`, { type: 'error' });
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = `
          <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M3 8.5l3.5 3.5 6.5-7"/>
          </svg>
          <span>Save</span>`;
      }
    }
  }

  return wrap;
}

let _t; const debounce = fn => { clearTimeout(_t); _t=setTimeout(fn,260); };
export async function viewProducts(){
  const v = $('#v-products');
  if (!v.dataset.painted) skeleton(v, 'list', 'products');
  const ps = new URLSearchParams();
  if (S.acct) ps.set('account',S.acct);
  // every filter travels as a query param, so a filtered view is a shareable URL and the
  // server does the narrowing — filtering 1,100 rows in the browser would mean shipping
  // all of them first
  for (const k of ['q','lifecycle','platform','reviews','missing','month','changed','country','city'])
    if (S.pf[k]) ps.set(k, S.pf[k]);
  if (S.pf.status) ps.set('status', S.pf.status);
  // Served from the cache when we have it, so coming back to this tab is instant;
  // a refresh goes out behind it and repaints only if something actually changed.
  const key = '/api/products?'+ps;
  const fparams = q(S.pf.country ? 'country='+encodeURIComponent(S.pf.country) : '');
  const [d, opts0] = await Promise.all([
    cachedApi(key, () => { if (S.tab === 'products' && key === '/api/products?'+ps)
                             viewProducts(); }),
    cachedApi('/api/filters'+fparams),   // months come from the data, so no empty option exists
  ]);

  // Ensure persistent 3-tier sequence:
  // 1: Mapped products
  // 2: Viator products that still need GYG code for mapping
  // 3: GetYourGuide products which have no match until now
  if (d && Array.isArray(d.products)) {
    d.products.sort((a, b) => {
      const getTier = (p) => {
        if (p.tier != null) return p.tier;
        const isGyg = (
          p.platform_id === 2 ||
          p.platform_code === 'getyourguide' ||
          (p.account_name && String(p.account_name).toLowerCase().includes('gyg')) ||
          (p.viator_account_id && String(p.viator_account_id).toLowerCase().includes('gyg')) ||
          (/^\d{6,8}$/.test(String(p.product_code || '')))
        ) && (p.platform_id !== 1 && p.platform_code !== 'viator');
        const listings = p.tour_listings || [];
        const gygSib = listings.find(l => l.platform === 'getyourguide' && l.code !== p.product_code);
        const viatorSib = listings.find(l => l.platform === 'viator' || !l.platform);
        if (!isGyg) {
          const hasRef = Boolean(p.gyg_reference || p.gyg_tour_id || gygSib);
          return hasRef ? 1 : 2;
        } else {
          return viatorSib ? 1 : 3;
        }
      };
      const tA = getTier(a);
      const tB = getTier(b);
      if (tA !== tB) return tA - tB;
      return String(a.product_code || '').localeCompare(String(b.product_code || ''), undefined, { numeric: true, sensitivity: 'base' });
    });
  }

  v.dataset.painted='1';
  v.innerHTML='';

  const LIFECYCLE = [['LIVE','Live'],['DRAFT','Draft'],['PENDING','Pending review'],
                     ['REJECTED','Rejected'],['REMOVED','Removed']];
  const REVIEWS = [['0','No reviews yet'],['1','Exactly 1 review'],['2-5','2 to 5 reviews'],
                   ['6-20','6 to 20 reviews'],['21+','21 or more'],['any','Has reviews']];
  // "has anything about this listing moved since we first saw it?" — the two states
  // people actually ask about when they open this page
  const CHANGED = [['yes','Changed since first capture'],
                   ['no','Not changed yet']];
  const opts = (list, cur) => list.map(([val,lab]) =>
    `<option value="${esc(val)}" ${cur===val?'selected':''}>${esc(lab)}</option>`).join('');

  const f = el('div','filters');
  f.innerHTML = `
    <input type="text" id="pq" placeholder="Search by name or product code"
           value="${esc(S.pf.q)}" style="min-width:240px;flex:1;max-width:360px">
    <div id="pcountry_mount"></div>
    <div id="pcity_mount"></div>
    <select id="pplat" title="Platform"><option value="">All platforms</option>
      ${opts((opts0.platforms||[]).map(p=>[p.code, p.name]), S.pf.platform)}</select>
    <select id="pmonth" title="Month the product was first captured">
      <option value="">Any month</option>
      ${opts((opts0.months||[]).map(m=>[m.month||m, `${monthName(m.month||m)}` + (m.n!=null?` (${m.n})`:'')]), S.pf.month)}</select>
    <select id="plife" title="Lifecycle status"><option value="">Any status</option>
      ${opts(LIFECYCLE, S.pf.lifecycle)}</select>
    <select id="previews" title="Review count"><option value="">Any reviews</option>
      ${opts(REVIEWS, S.pf.reviews)}</select>
    <select id="pchanged" title="Whether anything has changed since the first capture">
      <option value="">Changed or not</option>
      ${opts(CHANGED, S.pf.changed)}</select>
    <span class="pill">${d.products.length} shown</span>
    <button class="btn ghost sm" id="pclear">Clear</button>
    <div style="margin-left:auto;display:flex;align-items:center;gap:8px">
      <button class="btn sm" id="btnExportCities" style="padding:6px 14px;font-weight:600;display:flex;align-items:center;gap:6px;cursor:pointer;border:1.5px solid #000000;color:#000000;background:#ffffff;border-radius:6px;transition:all 0.15s ease;" onmouseenter="this.style.background='#F3F4F6'" onmouseleave="this.style.background='#FFFFFF'" title="Export comprehensive Cities Catalog Excel report based on latest data">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        <span>Export Cities</span>
      </button>
      <button class="btn primary sm" id="btnAddProductBtn" style="padding:6px 14px;font-weight:600;display:flex;align-items:center;gap:6px;cursor:pointer">
        <span>+</span> Add Product
      </button>
    </div>`;
  v.appendChild(f);
  const set = (k, val) => { S.pf[k] = val; viewProducts(); };
  f.querySelector('#pq').oninput = e=>{S.pf.q=e.target.value; debounce(viewProducts);};

  f.querySelector('#pcountry_mount').replaceWith(createSearchableSelect({
    id: 'pcountry',
    title: 'Country',
    allLabel: 'All countries',
    searchPlaceholder: 'Search country…',
    options: opts0.countries || [],
    value: S.pf.country,
    onChange: val => {
      S.pf.country = val;
      S.pf.city = '';
      viewProducts();
    }
  }));

  f.querySelector('#pcity_mount').replaceWith(createSearchableSelect({
    id: 'pcity',
    title: 'City / Destination',
    allLabel: 'All cities',
    searchPlaceholder: 'Search city…',
    options: opts0.cities || [],
    value: S.pf.city,
    onChange: val => set('city', val)
  }));
  f.querySelector('#pplat').onchange   = e=>set('platform', e.target.value);
  f.querySelector('#pmonth').onchange  = e=>set('month', e.target.value);
  f.querySelector('#plife').onchange   = e=>set('lifecycle', e.target.value);
  f.querySelector('#previews').onchange= e=>set('reviews', e.target.value);
  f.querySelector('#pchanged').onchange= e=>set('changed', e.target.value);
  f.querySelector('#pclear').onclick = ()=>{
    Object.assign(S.pf, {q:'',status:'',lifecycle:'',platform:'',
                         reviews:'',missing:'',month:'',changed:'',
                         country:'',city:''});
    viewProducts();
  };
  const exportBtn = f.querySelector('#btnExportCities');
  if (exportBtn) {
    exportBtn.onclick = async () => {
      const origHtml = exportBtn.innerHTML;
      exportBtn.disabled = true;
      exportBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>
        <span>Exporting…</span>
      `;
      try {
        const params = S.acct ? `?account=${encodeURIComponent(S.acct)}` : '';
        const url = `/api/export/cities${params}`;
        const headers = session.token ? { 'Authorization': 'Bearer ' + session.token } : {};
        const resp = await fetch(url, { headers });
        if (!resp.ok) {
          throw new Error((await resp.text()) || 'Failed to generate cities report');
        }
        const blob = await resp.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        const dStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        a.download = `Viator_Cities_Catalog_${dStr}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
        toast('Cities catalog exported successfully!');
      } catch (err) {
        toast('Export failed: ' + (err.message || 'Error generating workbook'), 'error');
      } finally {
        exportBtn.disabled = false;
        exportBtn.innerHTML = origHtml;
      }
    };
  }
  const addBtn = f.querySelector('#btnAddProductBtn');
  if (addBtn) addBtn.onclick = () => openCreateProductModal(S.acct, () => viewProducts());
  // Say what is being filtered in words. A count alone ("447 shown") leaves people
  // wondering why the other 670 vanished.
  const active = [
    S.pf.q && `matching “${S.pf.q}”`,
    S.pf.country && `in ${S.pf.country}`,
    S.pf.city && `city: ${S.pf.city}`,
    S.pf.platform && `on ${S.pf.platform}`,
    S.pf.lifecycle && (LIFECYCLE.find(x=>x[0]===S.pf.lifecycle)||[,S.pf.lifecycle])[1],
    S.pf.reviews && (REVIEWS.find(x=>x[0]===S.pf.reviews)||[,S.pf.reviews])[1],
    S.pf.missing && 'no longer listed on the platform',
    S.pf.month && `first captured in ${monthName(S.pf.month)}`,
    S.pf.changed && (CHANGED.find(x=>x[0]===S.pf.changed)||[,S.pf.changed])[1],
  ].filter(Boolean);
  if (active.length){
    const note = el('div','hint');
    note.style.margin = '-6px 0 12px';
    note.innerHTML = `Showing <b>${d.products.length}</b> product(s): ${
      active.map(a=>esc(a)).join(' · ')}`;
    v.appendChild(note);
  }
  if (!d.products.length){
    // three different reasons for an empty list — say which one it is
    const acc = S.accounts.find(a=>a.viator_account_id===S.acct);
    const anyFilter = Object.values(S.pf).some(Boolean);
    let msg;
    if (anyFilter){
      msg = '<div class="big">No products match those filters</div>'+
        'Clear the search box or set the dropdowns back to “Any”.';
    } else if (acc && acc.synced){
      msg = '<div class="big">This account has no products</div>'+
        `Last checked ${esc(when(acc.last_sync_at))}. The sync completed normally — `+
        'Viator simply lists nothing for this account.';
    } else if (S.acct){
      msg = '<div class="big">Not captured yet</div>'+
        'Press <b>+ Add Account</b>, sign in to this account, then press <b>Fetch</b>.';
    } else {
      msg = '<div class="big">Nothing captured yet</div>'+
        'Press <b>+ Add Account</b> to open the browser, sign in there, then press <b>Fetch</b>.';
    }
    v.appendChild(el('div','card empty', msg));
    return;
  }
  const L = el('div','plist');
  d.products.forEach(p=>{
    const row = el('div','prow');
    // Left: what this listing IS. Right: where it lives. Every fact on the left is a
    // labelled pair rather than a run of dots, so the column can be read down.
    //
    // ALWAYS four cells, in the same order. Skipping a field when it had no value gave
    // one row three columns and the next four, so the labels marched across the page
    // instead of lining up. A blank says something too — for a draft it says the field
    // was never fetched, which is not the same as zero.
    // A count with nothing behind it shows 0, on request. Strictly a draft's review count
    // is unknown rather than zero — drafts are never deep-fetched — but 0 is what the
    // client wants to read, and Reviews and Changes are counts either way.
    const fact = (k, v) => `<div class="pfact"><span class="pf-k">${esc(k)}</span>
      <span class="pf-v">${v || '0'}</span></div>`;
    const hasRating = p.review_rating != null && !isNaN(Number(p.review_rating)) && Number(p.review_rating) > 0;
    const hasCount = p.review_count != null && Number(p.review_count) > 0;
    const starSpan = hasRating ? `<span class="hint" style="color:#d97706;font-weight:600">★ ${Number(p.review_rating).toFixed(1)}</span>` : '';
    const rr = (hasCount && hasRating) ? `${p.review_count} ${starSpan}`
      : (hasCount ? `${p.review_count}` : (hasRating ? starSpan : '<span class="hint">Not rated</span>'));

    row.innerHTML = `
      <div class="pmain">
        <div class="ptitle-row">
          <div class="ptitle" title="${esc(p.title||'')}">${esc(p.title||'(untitled)')}</div>
          <div class="ptitle-gyg-slot"></div>
        </div>
        <div class="pmeta">
          <span class="mono">${esc(p.product_code)}</span>
          ${p.location?'· '+esc(p.location):''}
          ${!S.acct?'· '+esc(p.account_name||p.viator_account_id):''}
        </div>
        <div class="pfacts">
          ${fact('Status', p.missing_since
            ? '<span class="badge b-rejected">Removed from Viator</span>'
            : statusBadge(p.status))}
          ${fact('Quality', qualBadge(p.quality_level)
            || '<span class="hint">Not rated</span>')}
          ${fact('Reviews', rr)}
          ${fact('Changes', p.change_count
            ? `<b style="color:var(--accent)">${p.change_count}</b>` : '<span>0</span>')}
        </div>
      </div>
      <div class="pplat">${platformGrid(p, opts0.platforms)}</div>`;

    const gygSlot = row.querySelector('.ptitle-gyg-slot');
    if (gygSlot) {
      const widget = renderGygRefWidget(p, () => {
        invalidate('/api/products');
        viewProducts();
      });
      if (widget) gygSlot.appendChild(widget);
    }

    row.onclick = () => {
      const isGyg = (
        p.platform_id === 2 ||
        p.platform_code === 'getyourguide' ||
        (p.account_name && String(p.account_name).toLowerCase().includes('gyg')) ||
        (p.viator_account_id && String(p.viator_account_id).toLowerCase().includes('gyg')) ||
        (/^\d{6,8}$/.test(String(p.product_code || '')))
      ) && (p.platform_id !== 1 && p.platform_code !== 'viator');
      if (isGyg) {
        openGygDrawer(p.product_code, p.id, p.tour_id);
        return;
      }
      openDrawer(p.id);
    };
    L.appendChild(row);
  });
  v.appendChild(L);

  loadGygCatalogMap().then(map => {
    if (!map) return;
    const inputs = L.querySelectorAll('.gyg-ref-input');
    inputs.forEach(inp => {
      if (!inp.value) {
        const pc = inp.getAttribute('data-product-code');
        if (pc && map[pc]) {
          inp.value = map[pc];
          inp.title = `GetYourGuide Reference Code: ${map[pc]}`;
        }
      }
    });
  });
}

