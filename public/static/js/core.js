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
  chip.innerHTML = `${spinMark}<div>
      <div>Loading ${esc([...new Set(items.map(i=>i.what))].join(', '))}…</div>
      <div class="src">${slow ? 'this can take a few seconds' : ''}</div>
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
export const REFRESH_KEY = 'authRefresh';
export const session = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  refresh: localStorage.getItem(REFRESH_KEY) || '',
  user: null,                       // filled by /api/auth/me once the token is accepted
  required: true,                   // until /api/auth/config says otherwise
  // email -> full name, loaded once at start-up, so the edit history can say
  // "Maniha Hussain" where the database only records an email address
  people: {},
};
export function setToken(t, r){
  session.token = t || '';
  if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY);
  // r is undefined when a caller only replaces the access token; only an explicit
  // value (including '') touches the stored refresh token.
  if (r === undefined) return;
  session.refresh = r || '';
  if (r) localStorage.setItem(REFRESH_KEY, r); else localStorage.removeItem(REFRESH_KEY);
}

/* Supabase access tokens last an hour. Rather than bounce someone to the login screen
   mid-task, a 401 spends the refresh token on a new one and replays the request once.
   Only if THAT fails is the session really over.

   One shared promise, so twelve panels loading at once trigger one refresh between them
   instead of twelve races that would each invalidate the previous one's token. */
let refreshing = null;
async function renew(){
  if (!session.refresh) return false;
  if (!refreshing) refreshing = (async () => {
    try {
      const r = await fetch('/api/auth/refresh', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({refresh_token: session.refresh})});
      if (!r.ok) return false;
      const d = await r.json();
      if (!d.access_token) return false;
      setToken(d.access_token, d.refresh_token || session.refresh);
      if (d.user) session.user = d.user;
      return true;
    } catch { return false; }        // offline: not a sign-out, let the caller report it
    // Cleared synchronously. Deferring it by a tick meant the SECOND expiry reused this
    // already-settled promise, got back "renewed" without renewing anything, and replayed
    // with the old token — a 401 that looked exactly like a dead session. Callers already
    // awaiting hold the reference, so clearing it here costs them nothing.
    finally { refreshing = null; }
  })();
  return refreshing;
}
/* Set by app.js. Called when the server stops accepting our token — the session expired
   or an admin deleted the account — so the login screen comes back instead of every
   panel filling with "Please sign in to continue." */
let onSignedOut = () => {};
export const setSignedOutHandler = fn => { onSignedOut = fn; };

/* The loading mark used everywhere the app waits — the chip, the skeletons, the product
   drawer. The same fill as the boot splash so waiting looks like one thing throughout,
   rather than a logo in one place and an anonymous spinner in the others.

   CSS clip-path, not the splash's SVG wave mask: several of these can be on screen at once
   and duplicated mask ids all resolve to the first <mask> in the document. At this size the
   wave detail would be invisible anyway. It loops rather than tracking a percentage,
   because a single request has no progress to report — the loop means "working". */
export const spinMark = '<span class="spinmark" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><path d="M7 24 A17 17 0 0 1 24 7 A17 17 0 0 1 41 24 A17 17 0 0 1 24 41 L7 41 Z" stroke-width="7" stroke-linejoin="round"/><circle cx="24" cy="24" r="5.2"/></svg><svg viewBox="0 0 48 48" fill="none"><path d="M7 24 A17 17 0 0 1 24 7 A17 17 0 0 1 41 24 A17 17 0 0 1 24 41 L7 41 Z" stroke-width="7" stroke-linejoin="round"/><circle cx="24" cy="24" r="5.2"/></svg></span>';

/* The full mark — rings, orbits, trace, waves — for anywhere with room for it. The same
   composition as the boot splash, but looping rather than tracking progress: a view has no
   stages to report, only "still working".

   Each call gets its own mask ids. Duplicated ids all resolve to the first <mask> in the
   document, so two of these on screen would share one wave and fill in lockstep. */
let markSeq = 0;
export function traceMark(px){
  const n = ++markSeq;
  const logo = (cls, mask) =>
    `<g class="${cls}"${mask ? ` mask="url(#${mask})"` : ''}>` +
    `<path class="lg-ring" d="M7 24 A17 17 0 0 1 24 7 A17 17 0 0 1 41 24 A17 17 0 0 1 24 41 L7 41 Z"/>` +
    `<circle class="lg-dot" cx="24" cy="24" r="5.2"/></g>`;
  // Size and positioning inline, not left to the stylesheet. The ring layer is
  // `position:absolute;inset:0`, so if this box is ever unpositioned or unsized — a
  // stylesheet that has not landed yet, a cached older one — the ring resolves against
  // some far larger ancestor and renders as a circle the width of the page. Seen once,
  // for real. Inline styles cannot arrive late.
  const sz = px || 150;
  return `<div class="tmark" style="--sz:${sz}px;width:${sz}px;height:${sz}px;
      position:relative;display:grid;place-items:center">
    <svg class="bootrings" viewBox="0 0 200 200" aria-hidden="true">
      <circle class="trk" cx="100" cy="100" r="88"/>
      <circle class="arc" cx="100" cy="100" r="96"/>
      <g class="sat s1"><circle cx="100" cy="12" r="3.2"/></g>
      <g class="sat s2"><circle cx="100" cy="12" r="2.4"/></g>
      <g class="sat s3"><circle cx="100" cy="4" r="1.8"/></g>
    </svg>
    <svg class="bootlogo" viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <mask id="mkB${n}" maskUnits="userSpaceOnUse" x="-8" y="-8" width="64" height="64">
          <g class="wavebody back"><path class="waveb" fill="#fff" d="M0 9 q9 -1.8 18 0 t18 0 t18 0 t18 0 t18 0 t18 0 t18 0 t18 0 V80 H-4 Z"/></g></mask>
        <mask id="mk${n}" maskUnits="userSpaceOnUse" x="-8" y="-8" width="64" height="64">
          <g class="wavebody"><path class="wave" fill="#fff" d="M0 8 q6 -2.6 12 0 t12 0 t12 0 t12 0 t12 0 t12 0 t12 0 t12 0 t12 0 t12 0 t12 0 t12 0 V80 H-4 Z"/></g></mask>
      </defs>
      ${logo('ghost')}
      <g class="trace"><path class="lg-ring" d="M7 24 A17 17 0 0 1 24 7 A17 17 0 0 1 41 24 A17 17 0 0 1 24 41 L7 41 Z"/></g>
      ${logo('liquid back', 'mkB' + n)}
      ${logo('liquid', 'mk' + n)}
    </svg>
  </div>`;
}

/* ---------- boot splash ----------------------------------------------------------------
   Drives the logo fill in #boot (markup lives in the HTML so it paints before the modules
   that would otherwise have to inject it).

   The level tracks REAL stages — session check, cache hydrate, accounts, first view — so a
   slow account load holds the fill where it is instead of animating past it and then
   sitting at 100% waiting. It only ever moves forward: stages can complete out of order
   (hydrate resolves from disk in milliseconds, accounts may not), and a bar that slid
   backwards would read as something going wrong. */
let bootLevel = 0, bootOver = false;

/* Wrapped whole. This runs at module load, and core.js is what every other module
   imports — a throw in here would stop the entire dashboard loading for the sake of a
   decoration. The splash degrades to a plain fill instead. */
(function bootSetup(){
 try {
  const b = document.getElementById('boot');
  if (!b) return;
  // Measure the ring so the draw-on has no gap and no stall at the join. A guessed
  // stroke-dasharray is visibly wrong at one end or the other.
  const path = document.getElementById('bootTrace');
  if (path && path.getTotalLength){
    try { b.style.setProperty('--len', path.getTotalLength().toFixed(1)); } catch {}
  }
  // Letters get their own elements so they can arrive in sequence. Done here rather than
  // in the HTML so the markup stays readable as words.
  const w = b.querySelector('.bootword');
  if (w){
    const html = [...w.childNodes].map(n => {
      const bold = n.nodeName === 'B';
      return [...(n.textContent || '')].map((ch, i) =>
        `<span style="animation-delay:${(i * 34)}ms"${bold ? ' class="hi"' : ''}>${ch}</span>`
      ).join('');
    }).join('<span style="width:.5em"></span>');
    w.innerHTML = html;
    w.querySelectorAll('.hi').forEach(n => n.style.color = 'var(--brand)');
  }
 } catch {}
})();

/* The level. Only ever moves forward: stages finish out of order — hydrate resolves from
   disk in milliseconds, accounts may not — and a level that dropped would read as a fault.
   58 is the wave body at rest (fully below the mark); 0 puts the crest above it. */
export function bootProgress(p, stage){
  if (bootOver) return;
  const b = document.getElementById('boot');
  if (!b) return;
  bootLevel = Math.max(bootLevel, Math.min(1, p));
  b.style.setProperty('--wavey', (58 - bootLevel * 58).toFixed(1) + 'px');
  b.style.setProperty('--p', bootLevel.toFixed(3));      // the readout ring
  const el = document.getElementById('bootStage');
  if (el && stage && el.textContent !== stage){
    // fade out, swap, fade in — a hard text swap mid-animation reads as a glitch
    el.classList.add('swap');
    setTimeout(() => { el.textContent = stage; el.classList.remove('swap'); }, 200);
  }
}

/* Fill the rest of the way, let the waves land, the ring close and the gloss cross, then
   uncover the page. Snapping from 60% straight to gone looks like a glitch. */
export function bootDone(){
  if (bootOver) return;
  const b = document.getElementById('boot');
  if (!b){ bootOver = true; return; }
  bootProgress(1, 'Ready');
  bootOver = true;
  b.classList.add('full');
  // Hidden, NOT removed. Signing in runs boot() a second time — hydrate, accounts, first
  // render, the longest wait in the app — and once this element was gone that whole stretch
  // showed nothing at all. `gone` already makes it inert (visibility + pointer-events).
  setTimeout(() => b.classList.add('gone'), 760);
}

/* Show the splash for a fresh boot. First load arrives with it already up, so this is a
   no-op there; after a sign-in it brings it back and replays from empty. */
export function bootStart(stage){
  const b = document.getElementById('boot');
  if (!b) return;
  bootOver = false;
  bootLevel = 0;
  b.classList.remove('gone', 'full');
  b.style.setProperty('--wavey', '58px');
  b.style.setProperty('--p', '0');
  const el = document.getElementById('bootStage');
  if (el){ el.classList.remove('swap'); el.textContent = stage || 'Starting up'; }
  // Restart the draw-on. A CSS animation does not replay just because its element became
  // visible again: it has to be cleared and re-applied with a reflow in between, or the
  // mark simply reappears already drawn.
  const t = b.querySelector('.trace .lg-ring');
  if (t){
    t.style.animation = 'none';
    void t.getBoundingClientRect();
    t.style.animation = '';
  }
}

/* A splash that outlives a failure is worse than no splash: the dashboard would be there,
   working, behind an opaque cover. Anything unhandled during boot still uncovers it. */
setTimeout(() => { if (!bootOver) bootDone(); }, 15000);
window.addEventListener('error', () => bootDone());
window.addEventListener('unhandledrejection', () => bootDone());

export const apiRaw = async (p,o,retried) => {
  const opt = {...(o||{})};
  if (session.token)
    opt.headers = {...(opt.headers||{}), Authorization: `Bearer ${session.token}`};
  const r = await fetch(p,opt);
  if(!r.ok){
    const d = (await r.json().catch(()=>({}))).detail;
    // A 401 from login or refresh is a real answer — wrong password, dead refresh token —
    // so it must not trigger a renew (that would recurse) and must not read as "your
    // session ended". Every other path, /api/auth/me included, gets the renew: reopening
    // the dashboard the next morning arrives here with an hour-old access token, and
    // excluding all of /api/auth/ would have sent that straight to the login screen.
    if (r.status === 401 && p !== '/api/auth/login' && p !== '/api/auth/refresh'){
      // The hour is up. Renew and replay once before giving up on the session.
      if (!retried && await renew()) return apiRaw(p,o,true);
      setToken('',''); session.user = null; onSignedOut();
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




/* ---------- client-side cache ----------------------------------------------------------
   The dashboard re-fetched everything on every tab switch, so going back to Products cost
   the full trip to Supabase again — seconds, for data that had not changed.

   Stale-while-revalidate: a cached answer is served IMMEDIATELY, and if it is older than
   TTL a refresh goes out behind it; when that lands, `onFresh` lets the view repaint. So
   the second visit is instant and still ends up current.

   Held in memory only. localStorage was the obvious alternative and is the wrong tool
   here: the products payload is hundreds of kilobytes, serialising it costs more than the
   request saves on a fast connection, and it would outlive a sign-out.

   Correctness rules, because a stale audit figure is worse than a slow one:
     * anything that WRITES clears the cache (see invalidate() calls in edit.js, app.js);
     * switching account clears it, since every key is account-scoped by query string;
     * a failed request is never cached. */
const CACHE = new Map();

/* The 45-second timer was a guess at how long an answer might stay true, and it was an
   expensive one: this data only moves when a sync or an edit writes, so a ten-minute
   sitting re-downloaded the 2.5 MB product list about thirteen times for nothing.

   /api/status now reports a stamp — a fingerprint of the newest sync, change, product
   count and edit. While the stamp holds, the answer is still true and there is nothing to
   ask for. The timer survives only as a fallback for a server too old to send one. */
export const CACHE_TTL = 45000;         // fallback: no stamp available
const STAMPED_TTL = 900000;             // 15 min backstop once a stamp is being reported
let TTL = CACHE_TTL, STAMP = '';
const STAMP_KEY = 'traceStamp';

/* Fed by the status poll. Returns true when the data changed underneath us. */
export function noteStamp(s){
  if (!s) return false;                 // older server, or its stamp query failed
  TTL = STAMPED_TTL;
  const moved = !!STAMP && STAMP !== s;
  STAMP = s;
  try { localStorage.setItem(STAMP_KEY, s); } catch {}
  if (moved) invalidate();              // something wrote — every cached answer is suspect
  return moved;
}

/* ---------- the durable half -------------------------------------------------------
   The Map above is empty on every page load, so it only ever made the SECOND visit to a
   tab fast. The wait people actually notice is opening the dashboard, and that was a cold
   start every single time — measured, /api/products alone is 2.5 MB and ~2.9 s.

   IndexedDB, not localStorage: the earlier decision to reject localStorage was right, for
   the right reason (serialising megabytes on the main thread costs more than it saves, and
   there is a ~5 MB ceiling). IndexedDB stores structured values off the main thread with
   no such cap.

   Keyed by SIGNED-IN USER as well as path. Scope filtering happens on the server, so a
   member reading an answer cached for an admin would see rows they are not allowed. */
const DB_NAME = 'opatrip-trace', STORE = 'answers';
let idbOpen = null;
const KEY_SEP = '::';
const whose = () => (session.user || {}).email || '-';
const diskKey = path => whose() + KEY_SEP + path;

function db(){
  if (idbOpen) return idbOpen;
  // Every failure resolves to null rather than rejecting: private windows, disabled
  // storage and quota errors must degrade to "no disk cache", never to a broken dashboard.
  idbOpen = new Promise(res => {
    let r;
    try { r = indexedDB.open(DB_NAME, 1); } catch { return res(null); }
    r.onupgradeneeded = () => { try { r.result.createObjectStore(STORE); } catch {} };
    r.onsuccess = () => res(r.result);
    r.onerror = r.onblocked = () => res(null);
  });
  return idbOpen;
}
async function tx(mode, fn){
  const d = await db(); if (!d) return null;
  try { return fn(d.transaction(STORE, mode).objectStore(STORE)); } catch { return null; }
}
const toDisk = (path, data) => tx('readwrite',
  s => s.put({at: Date.now(), stamp: STAMP, data}, diskKey(path)));

/* Load this user's saved answers into the Map. Called once, before the first render, so
   the dashboard paints from disk instead of waiting on the network. */
export async function hydrate(){
  const mine = whose() + KEY_SEP;
  // Start from an empty Map. Anything already in memory was cached for a different
  // identity or a previous boot, and hydrate's whole job is to load THIS user's rows.
  CACHE.clear();
  // The stamp this browser last saw. If a saved answer was captured under it and it has
  // not moved, the answer is still true and the reload costs no requests at all.
  let last = ''; try { last = localStorage.getItem(STAMP_KEY) || ''; } catch {}
  // Adopt it as the current stamp. Without this the module starts at '' after every
  // reload, so the first poll compared against nothing and reported "no change" — and a
  // write that happened while the page was CLOSED would have gone unnoticed until the
  // next one. The first poll now compares the server's stamp against what we last saw.
  STAMP = last;
  return new Promise(res => {
    tx('readonly', s => {
      let n = 0, cur;
      try { cur = s.openCursor(); } catch { return res(0); }
      cur.onerror = () => res(n);
      cur.onsuccess = e => {
        const c = e.target.result;
        if (!c){ return res(n); }
        const k = String(c.key);
        // Everything on disk is stale by definition — `at: 0` makes cachedApi serve it
        // instantly AND immediately revalidate behind it, which is exactly the contract.
        if (k.startsWith(mine) && c.value && c.value.data !== undefined){
          const still = last && c.value.stamp === last;
          CACHE.set(k.slice(mine.length), {at: still ? Date.now() : 0,
                    stamp: c.value.stamp || '', data: c.value.data, inflight: null});
          n++;
        }
        c.continue();
      };
    }).then(t => { if (t === null) res(0); });
  });
}

/* Drop cached answers. No argument clears everything; a string clears every key
   containing it, so invalidate('/api/products') also drops every filtered variant.

   Must reach the disk too. Clearing only the Map would leave the stale copy on disk to be
   resurrected by the next reload — a stale audit figure surviving the very write that was
   supposed to correct it. */
export function invalidate(part){
  if (!part){ CACHE.clear(); tx('readwrite', s => s.clear()); return; }
  for (const k of [...CACHE.keys()]) if (k.includes(part)) CACHE.delete(k);
  tx('readwrite', s => {
    const cur = s.openCursor();
    cur.onsuccess = e => {
      const c = e.target.result; if (!c) return;
      const k = String(c.key);
      if (k.slice(k.indexOf(KEY_SEP) + KEY_SEP.length).includes(part)) c.delete();
      c.continue();
    };
  });
}

/* Sign-out. Not invalidate(): that clears the store for everyone on this machine, and the
   point here is that the person leaving stops being able to read their own rows. */
export function forgetMyCache(){
  const mine = whose() + KEY_SEP;
  CACHE.clear();
  return tx('readwrite', s => {
    const cur = s.openCursor();
    cur.onsuccess = e => {
      const c = e.target.result; if (!c) return;
      if (String(c.key).startsWith(mine)) c.delete();
      c.continue();
    };
  });
}

export async function cachedApi(path, onFresh){
  const now = Date.now();
  let e = CACHE.get(path);
  if (e && e.data !== undefined){
    // Nothing has written since this was cached, so there is nothing to ask for. This is
    // what removes the periodic 2.5 MB refetch — and with it the JSON.stringify of both
    // copies that used to decide whether the answer had moved.
    if (STAMP && e.stamp === STAMP){ e.at = now; return e.data; }
    if (now - e.at > TTL && !e.inflight){
      // refresh behind the answer we just gave; a failure leaves the cached copy alone
      e.inflight = apiRaw(path).then(d => {
        e.at = Date.now(); e.inflight = null; e.stamp = STAMP;
        // Only reached on the no-stamp fallback path now, so this comparison runs rarely
        // instead of on every revalidation of the product list.
        const changed = JSON.stringify(d) !== JSON.stringify(e.data);
        e.data = d; toDisk(path, d);
        if (changed && onFresh) onFresh(d);
      }).catch(() => { e.inflight = null; });
    }
    return e.data;
  }
  if (!e){ e = {at: 0, stamp: '', data: undefined, inflight: null}; CACHE.set(path, e); }
  if (!e.inflight){
    e.inflight = api(path).then(d => {
      e.data = d; e.at = Date.now(); e.stamp = STAMP; e.inflight = null;
      toDisk(path, d); return d;
    }).catch(err => { CACHE.delete(path); throw err; });
  }
  return e.inflight;
}

/* Fetch something now so it is already there when it is asked for. Silent: a prefetch
   that fails must never show an error for a page nobody has opened. */
export function prefetch(path){ cachedApi(path).catch(() => {}); }

export const q = k => S.acct ? `?account=${encodeURIComponent(S.acct)}${k?'&'+k:''}` : (k?'?'+k:'');

