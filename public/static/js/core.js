import { S } from './state.js';

export const $ = s => document.querySelector(s);
export const el = (t,c,h) => { const e=document.createElement(t); if(c)e.className=c;
  if(h!==undefined)e.innerHTML=h; return e; };
/* The apostrophe matters: several attributes are built as onerror="this.src='...'", so a
   value containing ' closed the string early and the rest of a portal-supplied URL became
   executable markup. Escaping it here fixes every call site at once. */
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/* ---------- loading indication ----------
   Every request registers itself, so the UI can always say what it is waiting for and
   where it is coming from. Reads are labelled by endpoint; anything unlabelled still
   shows generic progress rather than nothing. */
export const LOADING = new Map();     // id -> {what, where, t0}
export let LOAD_SEQ = 0;
export const WHAT = {
  '/api/overview':'dashboard figures', '/api/products':'products',
  '/api/accounts':'accounts', '/api/matrix':'platform grid', '/api/reports':'reports',
  '/api/stats':'category breakdown', '/api/audit':'change history',
  '/api/syncs':'sync runs', '/api/edits':'edit history', '/api/storage':'storage status',
  '/api/product/':'product detail', '/api/snapshot/':'snapshot',
};
export function labelFor(path){
  const clean = String(path).split('?')[0];
  for (const k in WHAT) if (clean.startsWith(k)) return WHAT[k];
  return 'data';
}
// Background heartbeats must never drive the loading UI: /api/status is polled every 2s,
// so counting it meant a permanent "Loading…" chip that told the user nothing.
export const QUIET = ['/api/status', '/api/sessions', '/api/storage'];
export const isQuiet = p => QUIET.some(q => String(p).split('?')[0] === q);
// Only surface a request that is actually slow enough to notice. Flashing the chip for a
// 90ms call is worse than showing nothing.
export const SHOW_AFTER = 250;

export function paintLoading(){
  const bar = $('#loadbar'), chip = $('#loadchip');
  const visible = [...LOADING.values()].filter(i => Date.now() - i.t0 > SHOW_AFTER);
  const n = visible.length;
  if (!n){
    bar.style.width = '100%'; bar.style.opacity = '0';
    setTimeout(()=>{ bar.style.width='0'; bar.style.opacity='1'; }, 400);
    chip.classList.add('hidden');
    return;
  }
  // indeterminate but always-advancing: real progress is unknowable, so creep toward 90%
  const pct = Math.min(90, 18 + n * 8 + (Date.now()/60 % 40));
  bar.style.opacity = '1'; bar.style.width = pct + '%';
  const items = visible;
  const slow = items.some(i => Date.now() - i.t0 > 2500);
  chip.classList.remove('hidden');
  chip.innerHTML = `<div class="sp"></div><div>
      <div>Loading ${esc([...new Set(items.map(i=>i.what))].join(', '))}…</div>
      <div class="src">${items[0].where ? 'from ' + esc(items[0].where) : ''}${
        slow ? (items[0].where ? ' · ' : '') + 'this can take a few seconds' : ''}</div>
      </div>`;
}
setInterval(()=>{ if (LOADING.size) paintLoading(); }, 400);

// Left blank until /api/storage answers: naming a backend we haven't confirmed would
// be a guess, and the point of these labels is to be accurate.

export const api = async (p,o) => {
  if (isQuiet(p)) return apiRaw(p,o);   // heartbeats stay silent
  const id = ++LOAD_SEQ;
  LOADING.set(id, {what: labelFor(p), where: S.source, t0: Date.now()});
  paintLoading();
  try {
    return await apiRaw(p,o);
  } finally {
    LOADING.delete(id); paintLoading();
  }
};
/* The signed-in session. Kept here rather than in state.js because every request needs
   it: attaching the token in ONE place means no call site can forget, and a request that
   comes back 401 signs out from one place too. */
export const TOKEN_KEY = 'authToken';
export const session = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  user: null,                       // filled by /api/auth/me once the token is accepted
  required: true,                   // until /api/auth/config says otherwise
  // email -> full name, loaded once at start-up, so the edit history can say
  // "Maniha Hussain" where the database only records an email address
  people: {},
};
export function setToken(t){
  session.token = t || '';
  if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY);
}
/* Set by app.js. Called when the server stops accepting our token — the session expired
   or an admin deleted the account — so the login screen comes back instead of every
   panel filling with "Please sign in to continue." */
let onSignedOut = () => {};
export const setSignedOutHandler = fn => { onSignedOut = fn; };

export const apiRaw = async (p,o) => {
  const opt = {...(o||{})};
  if (session.token)
    opt.headers = {...(opt.headers||{}), Authorization: `Bearer ${session.token}`};
  const r = await fetch(p,opt);
  if(!r.ok){
    const d = (await r.json().catch(()=>({}))).detail;
    if (r.status === 401 && !p.startsWith('/api/auth/')){
      setToken(''); session.user = null; onSignedOut();
      throw new Error(d || 'Your session has ended — please sign in again.');
    }
    // A 404 on an API path almost always means the running server is older than these
    // files — the HTML is re-read from disk but the Python isn't.
    if (r.status === 404 && p.startsWith('/api/'))
      throw new Error(`${p} isn't available on the running server. It was started before `+
        `this feature existed — stop it and run "python app.py" again.`);
    throw new Error(d || r.statusText);
  }
  return r.json();
};
export const post = (p,b) => api(p,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(b)});
export const patch = (p,b) => api(p,{method:'PATCH',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(b)});
export const del = p => api(p,{method:'DELETE'});




export const q = k => S.acct ? `?account=${encodeURIComponent(S.acct)}${k?'&'+k:''}` : (k?'?'+k:'');

