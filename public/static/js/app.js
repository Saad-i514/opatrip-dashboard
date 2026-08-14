import { S } from './state.js';
import { $, api, esc, post } from './core.js';
import { label } from './format.js';
import { loadAccounts, renderFilterBar } from './ui.js';
import { renderSyncProgress } from './progress.js';
import { confirmDialog } from './toast.js';
import { installReadOnly, automationNotice, setOwner } from './readonly.js';
import { viewStats } from './views/stats.js';
import { viewProducts } from './views/products.js';
import { when } from './views/drawer.js';
import { viewActivity, viewAudit, viewCategories, viewSyncs } from './views/misc.js';
import { viewAccounts } from './views/accounts.js';

/* ======================= status polling ======================= */
export async function poll(){
  try{
    const st = await api('/api/status');
    const pill = $('#statusPill');
    pill.className = 'pill '+(st.status==='running'?'run':st.status==='done'?'done'
      :(st.status==='error'||String(st.status).startsWith('paused'))?'err':'');
    $('#statusTxt').textContent = st.status==='running'
      ? `capturing ${st.seen}/${st.total}${st.changes?` · ${st.changes} change(s)`:''}`
      : (st.status==='done'?'finished':st.status==='idle'?'idle':String(st.status).replace(/_/g,' '));
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
    viewActivity(st);
    if (st.status==='done' && poll._last==='running'){
      refresh(); loadAccounts(); loadStorage();   // the upload queue starts now
    }
    poll._last = st.status;
    poll._n = (poll._n||0)+1;
    // watch the photo queue drain; the reachability probe behind this is cached
    if (poll._n%5===0) loadStorage();
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
  categories:viewCategories, audit:viewAudit, syncs:viewSyncs,
  activity:()=>viewActivity(null)};
export const TITLES = {stats:['Dashboard','Everything at a glance'],
  accounts:['Accounts','Coverage and capture freshness'],
  products:['Products','Every captured listing'],
  categories:['Breakdown','Distribution by category'],
  audit:['Change history','What changed, when and by whom'],
  syncs:['Sync runs','Every capture run'],
  activity:['Activity','Live log of the current run']};
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
  Object.keys(VIEWS).forEach(t=>$('#v-'+t).classList.toggle('hidden', t!==S.tab));
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
  loadAccounts().then(()=>go(S.tab)); };
/* Read-only deployment: these three would start or stop a capture, which happens on a
   staff laptop, not here. They explain that instead of failing. */
$('#btnAdd').onclick = automationNotice;
$('#btnStop').onclick = automationNotice;
$('#btnFetch').onclick = automationNotice;
installReadOnly();

/* Where is data actually being written? Shown permanently, because "is it saving to the
   cloud?" should never require reading a log file. */
export async function loadStorage(){
  const host = $('#storagebar'); if (!host) return;
  try{
    const s = await api('/api/storage');
    // name the real backend, so every "Loading … from X" line is accurate
    S.source = s.cloud ? 'Supabase' : 'the local database';
    const dot = ok => `<span style="color:${ok?'var(--green)':'var(--red)'}">●</span>`;
    // The image queue line went with photo storage. Nothing new is downloaded or
    // uploaded, so a draining-queue indicator would only ever describe an old backlog.
    host.innerHTML =
      `<div style="font-weight:600;color:var(--ink-2);margin-bottom:3px">Storage</div>
       <div>${dot(s.postgres.ok)} ${s.cloud?'Supabase Postgres':'local SQLite'}</div>`
       + (!s.cloud ? `<div style="color:var(--red);margin-top:4px">saving locally only</div>`
                   : '');
  }catch(e){ host.innerHTML = '<span style="color:var(--red)">storage status unavailable</span>'; }
}

loadStorage();          // names S.source for every label below
loadAccounts().then(()=>go('stats'));
poll();
