import { S } from '../state.js';
import { $, api, el, esc, q } from '../core.js';
import { connBadge, list, qualBadge, sentence, statusBadge } from '../format.js';
import { skeleton } from '../ui.js';
import { openDrawer, when } from './drawer.js';

/* ======================= products ======================= */

let _t; const debounce = fn => { clearTimeout(_t); _t=setTimeout(fn,260); };
export async function viewProducts(){
  const v = $('#v-products');
  if (!v.dataset.painted) skeleton(v, 'list', 'products');
  const ps = new URLSearchParams();
  if (S.acct) ps.set('account',S.acct);
  if (S.pf.q) ps.set('q',S.pf.q);
  if (S.pf.status) ps.set('status',S.pf.status);
  if (S.pf.connection) ps.set('connection',S.pf.connection);
  const d = await api('/api/products?'+ps);
  v.dataset.painted='1';
  v.innerHTML='';
  const f = el('div','filters');
  f.innerHTML = `
    <input type="text" id="pq" placeholder="Search by name or product code"
           value="${esc(S.pf.q)}" style="min-width:280px;flex:1;max-width:420px">
    <select id="pstatus"><option value="">Any status</option>
      ${['ACTIVE','DRAFT','PENDING_FIRST_ACTIVATION','REJECTED'].map(x=>
        `<option value="${x}" ${S.pf.status===x?'selected':''}>${esc(
          x==='PENDING_FIRST_ACTIVATION'?'Pending activation':sentence(x))}</option>`).join('')}
    </select>
    <select id="pconn"><option value="">Any connection</option>
      ${['Connected','Partially connected','Not connected'].map(x=>
        `<option ${S.pf.connection===x?'selected':''}>${x}</option>`).join('')}
    </select>
    <span class="pill">${d.products.length} shown</span>`;
  v.appendChild(f);
  f.querySelector('#pq').oninput = e=>{S.pf.q=e.target.value; debounce(viewProducts);};
  f.querySelector('#pstatus').onchange = e=>{S.pf.status=e.target.value; viewProducts();};
  f.querySelector('#pconn').onchange = e=>{S.pf.connection=e.target.value; viewProducts();};
  if (!d.products.length){
    // three different reasons for an empty list — say which one it is
    const acc = S.accounts.find(a=>a.viator_account_id===S.acct);
    const anyFilter = S.pf.q || S.pf.status || S.pf.connection;
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
          ${p.change_count?`· <b style="color:var(--accent)">${p.change_count} change${p.change_count===1?'':'s'}</b>`:''}
        </div>
      </div>
      <div class="pbadges">
        ${p.missing_since?'<span class="badge b-rejected">Removed from Viator</span>':''}
        ${p.is_draft_stub?'<span class="badge b-stub">Draft — not fetched</span>':''}
        ${qualBadge(p.quality_level)}${connBadge(p.connection_state)}${statusBadge(p.status)}
      </div>`;
    if (p.missing_since) row.style.opacity = '.72';
    row.onclick = ()=>openDrawer(p.id);
    L.appendChild(row);
  });
  v.appendChild(L);
}

