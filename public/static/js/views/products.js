import { S } from '../state.js';
import { $, api, el, esc, q } from '../core.js';
import { monthName, qualBadge } from '../format.js';
import { skeleton } from '../ui.js';
import { openDrawer, when } from './drawer.js';

/* ======================= products ======================= */


/* Reviews, shown on the row itself: it is the field people are filtering on, and a
   filter whose result you cannot see is hard to trust. Zero is called out rather than
   printed as "0 reviews" among the rest — it is the actionable state. */
function reviewChip(p){
  if (p.review_count == null) return '';
  if (p.review_count === 0)
    return '· <b style="color:var(--accent)">no reviews</b>';
  const stars = p.review_rating ? ` ★${Number(p.review_rating).toFixed(1)}` : '';
  return `· ${p.review_count} review${p.review_count===1?'':'s'}${esc(stars)}`;
}

/* Which platforms this tour is listed on. The Platforms grid was a whole tab of its own;
   the client asked for it here instead, on the row, next to the quality badge. Falls back
   to this listing's own platform so a tour that was never grouped still says where it is.
   Connection and lifecycle badges were removed from the row on the same request. */
function platformBadges(p){
  const names = (p.tour_platforms && p.tour_platforms.length)
    ? p.tour_platforms : (p.platform_name ? [p.platform_name] : []);
  return names.map(n=>`<span class="badge b-plat">${esc(n)}</span>`).join('');
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
  for (const k of ['q','lifecycle','platform','connection','reviews','missing','month'])
    if (S.pf[k]) ps.set(k, S.pf[k]);
  if (S.pf.status) ps.set('status', S.pf.status);
  const [d, opts0] = await Promise.all([
    api('/api/products?'+ps),
    api('/api/filters'+q()),      // months come from the data, so no empty option exists
  ]);
  v.dataset.painted='1';
  v.innerHTML='';

  const LIFECYCLE = [['LIVE','Live'],['DRAFT','Draft'],['PENDING','Pending review'],
                     ['REJECTED','Rejected'],['REMOVED','Removed']];
  const REVIEWS = [['0','No reviews yet'],['1','Exactly 1 review'],['2-5','2 to 5 reviews'],
                   ['6-20','6 to 20 reviews'],['21+','21 or more'],['any','Has reviews']];
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
    <select id="pconn" title="Book on Connection"><option value="">Any connection</option>
      ${opts([['Connected','Connected'],['Partially connected','Partially connected'],
              ['Not connected','Not connected']], S.pf.connection)}</select>
    <span class="pill">${d.products.length} shown</span>
    <button class="btn ghost sm" id="pclear">Clear</button>`;
  v.appendChild(f);
  const set = (k, val) => { S.pf[k] = val; viewProducts(); };
  f.querySelector('#pq').oninput = e=>{S.pf.q=e.target.value; debounce(viewProducts);};
  f.querySelector('#pplat').onchange   = e=>set('platform', e.target.value);
  f.querySelector('#pmonth').onchange  = e=>set('month', e.target.value);
  f.querySelector('#plife').onchange   = e=>set('lifecycle', e.target.value);
  f.querySelector('#previews').onchange= e=>set('reviews', e.target.value);
  f.querySelector('#pconn').onchange   = e=>set('connection', e.target.value);
  f.querySelector('#pclear').onclick = ()=>{
    Object.assign(S.pf, {q:'',status:'',lifecycle:'',platform:'',connection:'',
                         reviews:'',missing:'',month:''});
    viewProducts();
  };
  // Say what is being filtered in words. A count alone ("447 shown") leaves people
  // wondering why the other 670 vanished.
  const active = [
    S.pf.q && `matching “${S.pf.q}”`,
    S.pf.platform && `on ${S.pf.platform}`,
    S.pf.lifecycle && (LIFECYCLE.find(x=>x[0]===S.pf.lifecycle)||[,S.pf.lifecycle])[1],
    S.pf.reviews && (REVIEWS.find(x=>x[0]===S.pf.reviews)||[,S.pf.reviews])[1],
    S.pf.connection, S.pf.missing && 'no longer listed on the platform',
    S.pf.month && `first captured in ${monthName(S.pf.month)}`,
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
    const img = p.thumbnail_path
      ? `<img class="thumb" src="/api/thumb/${p.id}" loading="lazy" alt=""${
          p.thumbnail_url?` onerror="this.src='${esc(p.thumbnail_url)}'"`:''}>`
      : (p.thumbnail_url?`<img class="thumb" src="${esc(p.thumbnail_url)}" loading="lazy" alt="">`
                        :`<div class="thumb ph">no photo</div>`);
    row.innerHTML = `${img}
      <div style="min-width:0">
        <div class="ptitle">${esc(p.title||'(untitled)')}</div>
        <div class="pmeta">
          <span class="mono">${esc(p.product_code)}</span>
          ${p.location?'· '+esc(p.location):''}
          ${!S.acct?'· '+esc(p.account_name||p.viator_account_id):''}
          ${p.image_count?`· ${p.image_count} photo${p.image_count===1?'':'s'}`:''}
          ${reviewChip(p)}
          ${p.change_count?`· <b style="color:var(--accent)">${p.change_count} change${p.change_count===1?'':'s'}</b>`:''}
        </div>
      </div>
      <div class="pbadges">
        ${p.missing_since?'<span class="badge b-rejected">Removed from Viator</span>':''}
        ${p.is_draft_stub?'<span class="badge b-stub">Draft — not fetched</span>':''}
        ${qualBadge(p.quality_level)}${platformBadges(p)}
      </div>`;
    if (p.missing_since) row.style.opacity = '.72';
    row.onclick = ()=>openDrawer(p.id);
    L.appendChild(row);
  });
  v.appendChild(L);
}

