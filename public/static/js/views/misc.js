import { $, api, el, esc, q } from '../core.js';
import { connBadge, qualBadge, rows, statusBadge, sub, valueBox } from '../format.js';
import { skeleton } from '../ui.js';
import { bars } from './stats.js';
import { fieldLabel, trunc, when } from './drawer.js';

/* ======================= breakdown / history / runs ======================= */
export async function viewCategories(){
  const v = $('#v-categories');
  skeleton(v, 'rows', 'the category breakdown');
  const s = await api('/api/stats'+q());
  v.innerHTML='';
  const g = el('div','grid2');
  g.appendChild(bars('Locations', s.by_location));
  g.appendChild(bars('Status', s.by_status, statusBadge));
  g.appendChild(bars('Connection', s.by_connection, connBadge));
  g.appendChild(bars('Quality', s.by_quality, qualBadge));
  v.appendChild(g);
}
export async function viewAudit(){
  const v = $('#v-audit');
  skeleton(v, 'rows', 'change history');
  const d = await api('/api/audit'+q('limit=300'));
  v.innerHTML='';
  const c = el('div','card');
  c.appendChild(el('div','card-h',
    `<h3>Change history</h3><span class="sub">${d.changes.length} most recent</span>`));
  const b = el('div','pad');
  if (!d.changes.length){
    b.appendChild(el('div','empty','<div class="big">No changes yet</div>'+
      'The first capture is the baseline. Run a second sync and anything that '+
      'differs will be listed here.'));
  } else {
    const t = el('div','tblwrap');
    t.innerHTML = `<table><thead><tr><th>When</th><th>Product</th><th>What changed</th>
      <th>Before</th><th>After</th><th>Account</th><th>Run by</th></tr></thead><tbody>${
      d.changes.map(c=>`<tr>
        <td class="hint" style="white-space:nowrap">${esc(when(c.detected_at))}</td>
        <td><div style="font-weight:600">${esc(trunc(c.title))}</div>
            <div class="mono hint">${esc(c.product_code)}</div></td>
        <td>${esc(fieldLabel(c.field_path))}</td>
        <td>${valueBox(c.old_value, 'old', 'Value before')}</td>
        <td>${valueBox(c.new_value, null, 'Value after')}</td>
        <td class="hint">${esc(c.account_name||c.viator_account_id)}</td>
        <td class="hint">${esc(c.operator_email)}</td></tr>`).join('')}</tbody></table>`;
    b.appendChild(t);
  }
  c.appendChild(b); v.appendChild(c);
}
export async function viewSyncs(){
  const v = $('#v-syncs');
  skeleton(v, 'rows', 'sync runs');
  const d = await api('/api/syncs'+q());
  v.innerHTML='';
  const c = el('div','card');
  c.appendChild(el('div','card-h','<h3>Sync runs</h3>'));
  const b = el('div','pad');
  if (!d.syncs.length){ b.appendChild(el('div','hint','No runs yet.')); }
  else {
    const NICE = {done:'Completed', running:'Running', paused_signed_out:'Paused — signed out',
      paused_challenge:'Paused — challenge', interrupted:'Interrupted', error:'Stopped',
      stopped:'Stopped by you'};
    const t = el('div','tblwrap');
    t.innerHTML = `<table><thead><tr><th>Run</th><th>Account</th><th>Started</th>
      <th>Result</th><th>Products</th><th>Changes</th><th>Run by</th></tr></thead><tbody>${
      d.syncs.map(s=>{
        const cls = s.status==='done'?'b-active':s.status==='running'?'b-pending'
          :(s.status||'').startsWith('paused')||s.status==='interrupted'?'b-stub'
          :s.status==='error'?'b-rejected':'b-draft';
        return `<tr><td class="mono">#${s.id}</td>
          <td>${esc(s.account_name||s.viator_account_id)}</td>
          <td class="hint" style="white-space:nowrap">${esc(when(s.started_at))}</td>
          <td><span class="badge ${cls}">${esc(NICE[s.status]||s.status)}</span>
            ${s.message?`<div class="hint">${esc(trunc(s.message))}</div>`:''}</td>
          <td class="v num">${s.products_seen}</td><td class="v num">${s.changes_found}</td>
          <td class="hint">${esc(s.operator_email)}</td></tr>`;}).join('')}</tbody></table>`;
    b.appendChild(t);
  }
  c.appendChild(b); v.appendChild(c);
}
export function viewActivity(st){
  const v = $('#v-activity');
  if (!v.dataset.init){
    v.innerHTML = '<div class="card"><div class="card-h"><h3>Activity</h3>'+
      '<span class="sub">live log of the current run</span></div>'+
      '<div class="pad"><div class="logbox" id="logbox"></div></div></div>';
    v.dataset.init='1';
  }
  const box = $('#logbox');
  if (box && st) box.innerHTML = (st.log||[]).map(l =>
    `<div><b>${esc((l.t||'').slice(11,19))}</b> ${esc(l.msg)}</div>`).join('')
    || 'Nothing yet.';
  if (box) box.scrollTop = box.scrollHeight;
}

