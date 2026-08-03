import { $, api, el, esc, q } from '../core.js';
import { connBadge, qualBadge, rows, statusBadge, sub, valueBox } from '../format.js';
import { skeleton } from '../ui.js';
import { bars } from './stats.js';
import { trunc, when } from './drawer.js';

/* ======================= breakdown / history / runs ======================= */
export async function viewCategories(){
  const v = $('#v-categories');
  skeleton(v, 'rows', 'the category breakdown');
  const s = await api('/api/stats'+q());
  v.innerHTML='';
  const g = el('div','grid2');
  g.appendChild(bars('Locations', s.by_location));
  g.appendChild(bars('Status', s.by_status, statusBadge));
  g.appendChild(bars('Book on Connection', s.by_connection, connBadge));
  g.appendChild(bars('Quality', s.by_quality, qualBadge));
  v.appendChild(g);
  // "Not captured (draft)" is a real bucket on these charts and deserves a sentence
  // rather than leaving people to guess why a listing has no location.
  const drafty = ['by_location','by_connection','by_quality']
    .reduce((n,k)=>n+((s[k]||{})['Not captured (draft)']||0), 0);
  if (drafty){
    const note = el('div','hint');
    note.style.marginTop = '14px';
    note.innerHTML = '<b>“Not captured (draft)”</b> is not missing data. Drafts are '
      + 'recorded from the account roster and deliberately never deep-fetched, and the '
      + 'roster carries no location and only partial connection detail. Those fields '
      + 'fill in by themselves once a draft goes live and is captured in full. '
      + '<b>“Unknown”</b> is different: there the portal itself had no value.';
    v.appendChild(note);
  }
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
    b.appendChild(el('div','empty','<div class="big">Nothing has changed yet</div>'+
      'The first time a product is captured it becomes the starting point. From the '+
      'second check onwards, anything Viator changes shows up here — with the old and '+
      'new value side by side.'));
  } else {
    b.appendChild(el('div','hint',
      'Every line is one thing that changed on Viator between two checks. '
      + 'Click a value to see it in full.'));
    // One card per change, written as a sentence. The old version was a table of dotted
    // field paths, run ids and operator emails — accurate, but you had to know the schema
    // to read it. The same facts are here; the reader no longer has to.
    const feed = el('div','feed'); feed.style.marginTop='12px';
    d.changes.forEach(c=>{
      const it = el('div','feeditem chg');
      it.innerHTML = `<div class="dot3">⟳</div>
        <div style="min-width:0">
          <div style="font-weight:600">${esc(trunc(c.title))}</div>
          <div class="hint" style="margin:2px 0 7px">
            <span class="mono">${esc(c.product_code)}</span>
            · ${esc(c.account_name||c.viator_account_id)}</div>
          <div class="chg-what">Something on this product was changed</div>
          <div class="chg-vals">
            <div><div class="chg-lbl">Before</div>${valueBox(c.old_value,'old','Value before')}</div>
            <div class="chg-arrow">→</div>
            <div><div class="chg-lbl">After</div>${valueBox(c.new_value,null,'Value after')}</div>
          </div>
        </div>
        <div class="hint" style="text-align:right;white-space:nowrap">
          ${esc(when(c.detected_at))}<br>
          <span title="the person who ran the check that spotted it"
            >found by ${esc((c.operator_email||'').split('@')[0])}</span></div>`;
      feed.appendChild(it);
    });
    b.appendChild(feed);
  }
  c.appendChild(b); v.appendChild(c);
}
export async function viewSyncs(){
  const v = $('#v-syncs');
  skeleton(v, 'rows', 'sync runs');
  const d = await api('/api/syncs'+q());
  v.innerHTML='';
  const c = el('div','card');
  // The success rate used to be a card on the dashboard. It measures the TOOL, not the
  // catalogue, so it belongs where someone is already looking at runs.
  const done = d.syncs.filter(s=>s.status==='done').length;
  const rate = d.syncs.length ? Math.round(done/d.syncs.length*100) : 0;
  c.appendChild(el('div','card-h','<h3>Sync runs</h3>'+
    (d.syncs.length ? `<span class="sub">${done} of ${d.syncs.length} completed`
      + ` · ${rate}% success</span>` : '')));
  const b = el('div','pad');
  if (!d.syncs.length){ b.appendChild(el('div','hint','No runs yet.')); }
  else {
    const NICE = {done:'Completed', running:'Running', paused_signed_out:'Paused — signed out',
      paused_challenge:'Paused — challenge', interrupted:'Interrupted', error:'Stopped',
      stopped:'Stopped by you'};
    const t = el('div','tblwrap');
    t.innerHTML = `<table><thead><tr><th>Run</th><th>Account</th><th>Started</th>
      <th>Result</th><th class="num">Products</th><th class="num">Changes</th>
      <th>Run by</th></tr></thead><tbody>${
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

