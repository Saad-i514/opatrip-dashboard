import { S } from '../state.js';
import { $, api, el, esc } from '../core.js';
import { daysSince, list, rows, sub } from '../format.js';
import { loadAccounts, skeleton } from '../ui.js';
import { go } from '../app.js';

/* ======================= accounts coverage =======================
   With 25 accounts, "which have I actually captured, and how stale are they?" is the
   question the old dashboard could not answer at all. */
export async function viewAccounts(){
  const v = $('#v-accounts');
  skeleton(v, 'rows', 'accounts');
  const d = await api('/api/accounts');
  const list = d.accounts;
  v.innerHTML = '';
  const synced = list.filter(a=>a.synced);
  const never = list.filter(a=>!a.synced);
  const totP = list.reduce((s,a)=>s+(a.product_count||0),0);
  const days = daysSince;   // shared parser: handles the +00:00 offset

  const tiles = el('div','tiles');
  [['Accounts', list.length, `${synced.length} captured`],
   ['Products', totP, 'across every account'],
   ['Never captured', never.length, never.length?'need a first run':'all covered'],
   ['Photos', list.reduce((s,a)=>s+(a.image_count||0),0), 'stored in R2']]
   .forEach(([l,n,s2])=>tiles.appendChild(el('div','tile',
     `<div class="l">${l}</div><div class="n">${n}</div><div class="s">${esc(s2)}</div>`)));
  v.appendChild(tiles);

  const card = el('div','card');
  card.appendChild(el('div','card-h','<h3>Account coverage</h3>'+
    '<span class="sub">how recently each account was captured</span>'));
  const wrap = el('div','tblwrap');
  const rowsHtml = list.map(a=>{
    const dd = days(a.last_sync_at);
    const fresh = dd==null ? ['b-draft','never captured']
      : dd < 2 ? ['b-active', `${Math.round(dd*24)}h ago`]
      : dd < 14 ? ['b-pending', `${Math.round(dd)} days ago`]
      : ['b-rejected', `${Math.round(dd)} days ago`];
    return `<tr>
      <td><div style="font-weight:600">${esc(a.name||a.viator_account_id)}</div>
          <div class="mono hint">${esc(a.viator_account_id)}</div></td>
      <td class="v num">${a.product_count||0}</td>
      <td class="v num">${a.draft_count||0}</td>
      <td class="v num">${a.image_count||0}</td>
      <td class="v num">${a.missing_count?`<b style="color:var(--red)">${a.missing_count}</b>`:'0'}</td>
      <td><span class="badge ${fresh[0]}">${esc(fresh[1])}</span></td>
      <td class="hint">${esc(a.signin_email||'')}</td>
      <td><button class="btn sm ghost" data-pick="${esc(a.viator_account_id)}">View</button></td>
    </tr>`;}).join('');
  wrap.innerHTML = `<table><thead><tr><th>Account</th><th>Products</th><th>Drafts</th>
    <th>Photos</th><th>Removed</th><th>Last capture</th><th>Last operator</th><th></th>
    </tr></thead><tbody>${rowsHtml}</tbody></table>`;
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

