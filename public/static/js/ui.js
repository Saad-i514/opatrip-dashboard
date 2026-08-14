import { S } from './state.js';
import { $, api, esc, post } from './core.js';
import { list, rows } from './format.js';
import { go } from './app.js';

/* ---------- skeletons ----------
   Shown the instant a view is opened, so the page keeps its shape and says what it is
   fetching instead of blanking out for several seconds. */
export const skLines = n => Array.from({length:n},
  ()=>`<span class="sk sk-line" style="width:${55+Math.random()*40}%"></span>`).join('');
export function skeleton(host, kind, what){
  const note = `<div class="loading-note"><div class="sp"></div>
    Loading ${esc(what)}${S.source ? ' from ' + esc(S.source) : ''}…</div>`;
  let body = '';
  if (kind === 'kpis'){
    body = `<div class="kpis">${Array.from({length:6},()=>
      `<div class="skcard"><span class="sk" style="width:34px;height:34px;
        border-radius:10px"></span><span class="sk sk-line" style="width:52%;
        height:26px;margin-top:14px"></span><span class="sk sk-line"
        style="width:70%"></span></div>`).join('')}</div>
      <div class="chartwrap">${Array.from({length:2},()=>
      `<div class="skcard"><span class="sk sk-title"></span>${skLines(5)}</div>`).join('')}</div>`;
  } else if (kind === 'rows'){
    body = `<div class="card pad"><span class="sk sk-title"></span>${skLines(9)}</div>`;
  } else if (kind === 'list'){
    body = `<div class="plist">${Array.from({length:7},()=>
      `<div class="prow">
       <div style="min-width:0"><span class="sk sk-line" style="width:58%"></span>
       <span class="sk sk-line" style="width:34%"></span></div>
       <span class="sk" style="width:90px;height:22px;border-radius:99px"></span></div>`
      ).join('')}</div>`;
  } else {
    body = `<div class="card pad">${skLines(6)}</div>`;
  }
  host.innerHTML = note + body;
}

/* ======================= accounts & sessions ======================= */
export async function loadAccounts(){
  const d = await api('/api/accounts'); S.accounts = d.accounts;
  $('#acct').innerHTML = '<option value="">All accounts</option>' + d.accounts.map(a =>
    `<option value="${esc(a.viator_account_id)}">${esc(a.name||a.viator_account_id)}`+
    ` · ${a.product_count} products</option>`).join('');
  if (S.acct) $('#acct').value = S.acct;
  const cnt = $('#cntAccounts'); if (cnt) cnt.textContent = d.accounts.length;
}
/* The open-browser session bar lived here. There is no browser on the server, so that
   endpoint always answers empty and the bar is simply never shown. */

/* The account filter is remembered in localStorage, so it silently survives restarts —
   and then every count on the page is that ONE account's, which reads exactly like
   missing data. Whenever a filter is active, say so on every tab and offer one click to
   clear it. Counts come from /api/accounts, which already carries product_count. */
export function renderFilterBar(){
  const host = $('#filterbar');
  if (!host) return;
  if (!S.acct || !S.accounts.length){ host.innerHTML = ''; return; }
  const a = S.accounts.find(x => x.viator_account_id === S.acct);
  const mine = a ? a.product_count : 0;
  const all = S.accounts.reduce((s,x) => s + (x.product_count || 0), 0);
  host.innerHTML = `<div class="sessbar">
    <span class="badge b-stub">Filtered</span>
    <div style="flex:1;min-width:0">Showing <b>${esc(a ? (a.name || S.acct) : S.acct)}</b>
      only — <b>${mine}</b> of <b>${all}</b> products across
      ${S.accounts.length} account${S.accounts.length===1?'':'s'}.
      <div class="hint">Every figure below counts this account only.</div></div>
    <button class="btn sm" id="clearFilter">Show all accounts</button></div>`;
  $('#clearFilter').onclick = () => {
    S.acct = ''; localStorage.setItem('acct', '');
    const sel = $('#acct'); if (sel) sel.value = '';
    loadAccounts().then(() => go(S.tab));
  };
}

