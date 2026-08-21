import { S } from '../state.js';
import { $, cachedApi, el, esc } from '../core.js';
import { daysSince, list, rows, sub } from '../format.js';
import { loadAccounts, skeleton } from '../ui.js';
import { go } from '../app.js';

/* ======================= accounts coverage =======================
   With 25 accounts, "which have I actually captured, and how stale are they?" is the
   question the old dashboard could not answer at all. */
export async function viewAccounts(){
  const v = $('#v-accounts');
  skeleton(v, 'rows', 'accounts');
  const d = await cachedApi('/api/accounts');
  const list = d.accounts;
  v.innerHTML = '';
  const synced = list.filter(a=>a.synced);
  const never = list.filter(a=>!a.synced);
  const totP = list.reduce((s,a)=>s+(a.product_count||0),0);
  const days = daysSince;   // shared parser: handles the +00:00 offset

  const tiles = el('div','tiles');
  const sum = k => list.reduce((s,a)=>s+(a[k]||0),0);
  [['Accounts', list.length, `${synced.length} captured so far`],
   ['Total products', totP, 'across every account'],
   ['Live', sum('live_count'), 'selling right now'],
   ['Drafts', sum('draft_count'), 'not submitted yet'],
   ['Rejected', sum('rejected_count'), 'need fixing'],
   ['Never captured', never.length, never.length?'need a first run':'all covered']]
   .forEach(([l,n,s2])=>tiles.appendChild(el('div','tile',
     `<div class="l">${l}</div><div class="n">${n}</div><div class="s">${esc(s2)}</div>`)));
  v.appendChild(tiles);

  const card = el('div','card');
  card.appendChild(el('div','card-h','<h3>Every account at a glance</h3>'+
    '<span class="sub">how many products, and what state they are in</span>'));
  const wrap = el('div','tblwrap');
  const rowsHtml = list.map(a=>{
    const dd = days(a.last_sync_at);
    const fresh = dd==null ? ['b-draft','never captured']
      : dd < 2 ? ['b-active', `${Math.round(dd*24)}h ago`]
      : dd < 14 ? ['b-pending', `${Math.round(dd)} days ago`]
      : ['b-rejected', `${Math.round(dd)} days ago`];
    // a zero reads better as a quiet dash than as a column of 0s to scan past
    // 0 rather than a dash: a dash reads as "unknown", and these are known zeros
    const n = (v2, warn) => !v2 ? '0'
      : (warn ? `<b style="color:var(--red)">${v2}</b>` : String(v2));
    return `<tr>
      <td><div style="font-weight:600">${esc(a.name||a.viator_account_id)}</div>
          <div class="mono hint">${esc(a.viator_account_id)}</div></td>
      <td class="v num"><b>${a.product_count||0}</b></td>
      <td class="v num">${n(a.live_count)}</td>
      <td class="v num">${n(a.draft_count)}</td>
      <td class="v num">${n(a.no_review_count)}</td>
      <td><span class="badge ${fresh[0]}">${esc(fresh[1])}</span></td>
      <td><button class="btn sm ghost" data-pick="${esc(a.viator_account_id)}">Open</button></td>
    </tr>`;}).join('');
  // Pending, Rejected and Removed columns were dropped on request; the per-status counts
  // are still on /api/accounts, so restoring one is a header plus a cell.
  wrap.innerHTML = `<table><thead><tr><th>Account</th><th class="num">Total products</th>
    <th class="num">Live</th><th class="num">Draft</th><th class="num">No reviews</th>
    <th>Last Updated</th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
  card.appendChild(wrap); v.appendChild(card);
  wrap.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>{
    S.acct = b.dataset.pick; localStorage.setItem('acct', S.acct);
    $('#acct').value = S.acct; loadAccounts().then(()=>go('products'));
  });
  if (never.length){
    v.appendChild(el('div','card pad',
      `<b>${never.length} account${never.length===1?'':'s'} never captured.</b>
       <div class="hint" style="margin-top:5px">${esc(never.map(a=>
         a.name||a.viator_account_id).slice(0,8).join(' · '))}${
         never.length>8?' …':''}</div>`));
  }
}

