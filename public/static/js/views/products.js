import { S } from '../state.js';
import { $, cachedApi, el, esc, q } from '../core.js';
import { monthName, qualBadge, statusBadge } from '../format.js';
import { skeleton } from '../ui.js';
import { openDrawer, when } from './drawer.js';
import { openCreateProductModal } from '../edit.js';

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
    return `<div class="pp-row"><span class="pp-n">${esc(pl.name)}</span>${
      l ? statusBadge(l.status)
        : '<span class="badge b-notlisted">Not uploaded</span>'}</div>`;
  }).join('')}</div>`;
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
  for (const k of ['q','lifecycle','platform','reviews','missing','month','changed'])
    if (S.pf[k]) ps.set(k, S.pf[k]);
  if (S.pf.status) ps.set('status', S.pf.status);
  // Served from the cache when we have it, so coming back to this tab is instant;
  // a refresh goes out behind it and repaints only if something actually changed.
  const key = '/api/products?'+ps;
  const [d, opts0] = await Promise.all([
    cachedApi(key, () => { if (S.tab === 'products' && key === '/api/products?'+ps)
                             viewProducts(); }),
    cachedApi('/api/filters'+q()),   // months come from the data, so no empty option exists
  ]);
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
    <button class="btn primary sm" id="btnAddProductBtn" style="margin-left:auto;padding:6px 14px;font-weight:600;display:flex;align-items:center;gap:6px;cursor:pointer">
      <span>+</span> Add Product
    </button>`;
  v.appendChild(f);
  const set = (k, val) => { S.pf[k] = val; viewProducts(); };
  f.querySelector('#pq').oninput = e=>{S.pf.q=e.target.value; debounce(viewProducts);};
  f.querySelector('#pplat').onchange   = e=>set('platform', e.target.value);
  f.querySelector('#pmonth').onchange  = e=>set('month', e.target.value);
  f.querySelector('#plife').onchange   = e=>set('lifecycle', e.target.value);
  f.querySelector('#previews').onchange= e=>set('reviews', e.target.value);
  f.querySelector('#pchanged').onchange= e=>set('changed', e.target.value);
  f.querySelector('#pclear').onclick = ()=>{
    Object.assign(S.pf, {q:'',status:'',lifecycle:'',platform:'',
                         reviews:'',missing:'',month:'',changed:''});
    viewProducts();
  };
  const addBtn = f.querySelector('#btnAddProductBtn');
  if (addBtn) addBtn.onclick = () => openCreateProductModal(S.acct);
  // Say what is being filtered in words. A count alone ("447 shown") leaves people
  // wondering why the other 670 vanished.
  const active = [
    S.pf.q && `matching “${S.pf.q}”`,
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
    const rr = p.review_count ? `${p.review_count}${p.review_rating
          ? ` <span class="hint">★ ${Number(p.review_rating).toFixed(1)}</span>` : ''}`
      : '0';
    row.innerHTML = `
      <div class="pmain">
        <div class="ptitle">${esc(p.title||'(untitled)')}</div>
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
    if (p.missing_since) row.style.opacity = '.72';
    row.onclick = ()=>openDrawer(p.id);
    L.appendChild(row);
  });
  v.appendChild(L);
}

