import { S } from './state.js';
import { $, api, esc, hydrate, invalidate, noteStamp, post, prefetch, q, session,
         setSignedOutHandler } from './core.js';
import { label } from './format.js';
import { loadAccounts, renderFilterBar } from './ui.js';
import { renderSyncProgress } from './progress.js';
import { confirmDialog } from './toast.js';
import { installReadOnly, automationNotice, setOwner } from './readonly.js';
import { ensureSignedIn, renderWhoAmI, showLogin } from './login.js';
import { viewStats } from './views/stats.js';
import { viewProducts } from './views/products.js';
import { when } from './views/drawer.js';
// Activity is the live log of a capture run, and this deployment cannot capture.
import { viewCategories, viewSyncs } from './views/misc.js';
import { viewAccounts } from './views/accounts.js';
import { viewAdmin } from './views/admin.js';

/* ======================= status polling ======================= */
export async function poll(){
  try{
    const st = await api('/api/status');
    // The "idle" pill was removed from the top bar. A run still announces itself through
    // the progress panel and the Activity log, which say more than one word did.
    setOwner(st.automation_owner);
    if (st.read_only) installReadOnly();
    const b = $('#banner');
    if ((st.stale_files||[]).length){
      b.className='banner';
      b.innerHTML = `<b>The server is running old code.</b> `+
        `${st.stale_files.map(esc).join(', ')} changed on disk after it started, so new `+
        `features will return “Not Found”. Stop it and run `+
        `<span class="mono">python app.py</span> again.`;
    } else if (st.status==='paused_signed_out'){
      b.className='banner';
      b.innerHTML = `<b>Paused — you were signed out.</b> ${st.seen} product(s) captured and `+
        'saved. The browser window is on the login page: <b>sign in there</b>, come back '+
        'and press <b>Fetch</b> — it carries on from where it stopped.';
    } else if (st.status==='paused_challenge'){
      b.className='banner';
      b.innerHTML='<b>Paused — needs you.</b> A “verify you’re human” check appeared. '+
        'Solve it in the browser window, then press <b>Fetch</b> to carry on.';
    } else if (st.message && st.status==='error'){
      b.className='banner'; b.textContent = 'Stopped: '+st.message;
    } else b.className='banner hidden';
    renderSyncProgress(st);
    // No stamp is sent here — this app's /api/status does no database work and must not
    // start, since a serverless process cannot be relied on to keep the memoised value
    // between invocations. noteStamp('') is a no-op, so the cache falls back to its timer
    // and this line starts working the day the endpoint does report one.
    if (noteStamp(st.stamp)){ refresh(); loadAccounts(); }
    else if (st.status==='done' && poll._last==='running'){
      invalidate();        // a capture just wrote; everything on screen is now old
      refresh(); loadAccounts();
    }
    poll._last = st.status;
    poll._n = (poll._n||0)+1;
  }catch(e){}
  setTimeout(poll,2000);
}

/* The add-account modal is gone with the endpoint it drove: /api/session/open opened a
   real browser to sign in with. Adding an account is part of running a capture, so it
   belongs to the desktop tool; the notice explains where to do it. */

/* ======================= routing ======================= */
// The Platforms tab was removed on request — which platforms a tour is listed on is now
// a badge on the product row itself. /api/matrix still exists for anything that needs it.
export const VIEWS = {stats:viewStats, products:viewProducts, accounts:viewAccounts,
  categories:viewCategories, syncs:viewSyncs, admin:viewAdmin};
export const TITLES = {stats:['Dashboard','Everything at a glance'],
  accounts:['Accounts','Coverage and capture freshness'],
  products:['Products','Every captured listing'],
  categories:['Breakdown','Distribution by category'],
  syncs:['Sync runs','Every capture run'],
  admin:['Admin','Who can sign in, and what they can see']};
export function refresh(){
  // Promise.resolve: not every view is async (Activity renders synchronously), and
  // calling .catch on its undefined return threw.
  Promise.resolve((VIEWS[S.tab]||viewStats)()).catch(e=>{
    const v=$('#v-'+S.tab);
    if(v) v.innerHTML=`<div class="card empty">${esc(e.message)}</div>`; });
}
export function go(tab){
  S.tab = tab;
  document.querySelectorAll('#tabs .navbtn').forEach(x=>
    x.setAttribute('aria-selected', x.dataset.t===tab));
  // guarded: a stale link to a tab that has since been removed would otherwise
  // throw on a null element and leave the dashboard blank
  Object.keys(VIEWS).forEach(t=>{ const n = $('#v-'+t);
    if (n) n.classList.toggle('hidden', t!==S.tab); });
  const [t1,t2] = TITLES[tab] || ['Dashboard',''];
  $('#pageTitle').textContent = t1;
  const acc = S.accounts.find(a=>a.viator_account_id===S.acct);
  $('#pageCrumb').textContent = (acc ? acc.name || acc.viator_account_id : 'All accounts')
    + (t2 ? ' · ' + t2 : '');
  renderFilterBar();
  refresh();
}
$('#tabs').onclick = e=>{
  const b = e.target.closest('button[data-t]'); if(!b) return;
  go(b.dataset.t);
};
$('#acct').onchange = e=>{ S.acct=e.target.value; localStorage.setItem('acct',S.acct);
  // every cache key carries the account in its query string, so a switch invalidates
  // all of them at once rather than leaving another account's rows on screen
  invalidate();
  loadAccounts().then(()=>go(S.tab)); };
/* Read-only deployment: these three would start or stop a capture, which happens on a
   staff laptop, not here. They explain that instead of failing. */
$('#btnAdd').onclick = automationNotice;
$('#btnStop').onclick = automationNotice;
$('#btnFetch').onclick = automationNotice;
installReadOnly();

/* The Storage box is gone from the sidebar, and loadStorage() with it. It also set
   S.source, which named the backend in every "Loading products from ..." label;
   those now just say "Loading products...". That removes a request at start-up and
   another every fifth status poll. /api/storage still exists.  */

/* ======================= start up =======================
   Nothing is fetched until we know who is asking. The login screen calls back here on a
   successful sign-in, so this runs once as a guest (and stops) and once as a user. */
let started = false;
async function boot(){
  if (!await ensureSignedIn()) return;      // login screen is up; it will call us back
  if (started) return;
  started = true;
  renderWhoAmI();
  // Paint from IndexedDB before anything asks the network. Every restored answer is
  // marked stale, so each view still revalidates behind what it just drew.
  await hydrate();
  const admin = (session.user || {}).role === 'admin';
  document.querySelectorAll('[data-admin-only]').forEach(n =>
    n.classList.toggle('hidden', !admin));
  api('/api/people').then(p => { session.people = p.names || {}; }).catch(() => {});
  await loadAccounts();
  go('stats');
  // Products is the heaviest page and the one people open next. Fetching it now, while
  // they are reading the dashboard, means the tab is already populated when they click.
  prefetch('/api/products' + (S.acct ? '?account=' + encodeURIComponent(S.acct) : '?'));
  prefetch('/api/filters' + q());
  poll();
}
window.addEventListener('signed-in', boot);
setSignedOutHandler(() => showLogin('Your session has ended — please sign in again.'));
boot();
