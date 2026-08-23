import { S } from './state.js';
import { spinMark, traceMark, cachedApi, $, api, esc, post } from './core.js';
import { list, rows } from './format.js';
import { go } from './app.js';

/* ---------- what a view shows while it loads ----------
   Grey placeholder blocks used to stand in for the content. They were replaced by the
   mark, filling: the wait now looks like the rest of the app rather than like the page
   half-failing to render.

   skLines is kept because the product drawer still uses it — a side panel has a known
   shape worth holding, where a whole view does not. */
export const skLines = n => Array.from({length:n},
  ()=>`<span class="sk sk-line" style="width:${55+Math.random()*40}%"></span>`).join('');

/* `kind` is still accepted so every call site reads the same, but every view now gets the
   same treatment — there is nothing left to vary. */
export function skeleton(host, kind, what){
  host.innerHTML = `<div class="vload">
      <div class="vload-mark">${traceMark(158)}</div>
      <div class="vload-t">Loading ${esc(what)}…</div>
    </div>`;
}

/* ======================= accounts & sessions ======================= */
export async function loadAccounts(){
  const d = await cachedApi('/api/accounts'); S.accounts = d.accounts;
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

