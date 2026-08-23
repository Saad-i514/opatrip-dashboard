/* The sign-in screen, and the "who am I" chip in the sidebar.

   Everything about passwords happens on Supabase's own auth service — this file sends an
   email and a password to our server, which forwards them, and keeps the token it gets
   back. No password is ever stored, and the token lives in localStorage so a page reload
   doesn't sign you out. */
import { $, api, apiRaw, el, esc, forgetMyCache, post, session, setToken } from './core.js';

/* Painted over the whole app. Not a modal: there is nothing behind it to look at, and a
   dismissible dialog in front of an empty dashboard reads like a bug. */
export function showLogin(message){
  const host = $('#authHost');
  host.innerHTML = `
    <div class="authwrap">
      <form class="authcard" id="loginForm" autocomplete="on">
        <div class="authbrand">
          <span class="heromark"><svg viewBox="0 0 48 48" fill="none" aria-hidden="true"
            ><path d="M7 24 A17 17 0 0 1 24 7 A17 17 0 0 1 41 24 A17 17 0 0 1 24 41 L7 41 Z"
              stroke="#AD68E2" stroke-width="7" stroke-linejoin="round"/><circle cx="24"
              cy="24" r="5.2" fill="#AD68E2"/></svg></span>
          <div class="authname"><span class="hname">Opatrip</span> Trace</div>
        </div>
        <h1>Sign in</h1>
        <p class="authsub">Use the email and password your administrator gave you.</p>
        <label class="fl">Email
          <input type="email" id="lEmail" name="email" autocomplete="username"
                 placeholder="you@opatrip.com" required></label>
        <label class="fl">Password
          <input type="password" id="lPass" name="password" autocomplete="current-password"
                 placeholder="Your password" required></label>
        <div id="lErr" class="banner hidden"></div>
        <button class="btn primary authgo" id="lGo" type="submit">Sign in</button>
        <p class="authfoot">Forgotten your password? Ask your administrator to set a new
          one — nobody here can read the old one.</p>
      </form>
    </div>`;
  const err = $('#lErr');
  if (message){ err.className = 'banner'; err.textContent = message; }
  const form = $('#loginForm');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const go = $('#lGo');
    const email = $('#lEmail').value.trim(), password = $('#lPass').value;
    if (!email || !password){
      err.className = 'banner';
      err.textContent = 'Please fill in both your email and your password.';
      return;
    }
    go.disabled = true; go.textContent = 'Signing in…';
    try{
      // apiRaw, not api: the loading chip belongs to the dashboard, which isn't up yet
      const r = await apiRaw('/api/auth/login', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({email, password})});
      setToken(r.access_token, r.refresh_token);
      session.user = r.user;
      host.innerHTML = '';
      document.body.classList.remove('locked');
      window.dispatchEvent(new CustomEvent('signed-in'));
    }catch(ex){
      err.className = 'banner';
      err.textContent = ex.message || "That email and password don't match.";
      go.disabled = false; go.textContent = 'Sign in';
      $('#lPass').select();
    }
  };
  document.body.classList.add('locked');
  setTimeout(() => $('#lEmail').focus(), 30);
}

export async function signOut(){
  try { await post('/api/auth/logout', {}); } catch(e){}
  // Drop this person's cached rows from disk before the identity goes — forgetMyCache
  // keys off session.user, and the reload below would otherwise leave them readable.
  try { await forgetMyCache(); } catch(e){}
  setToken('', ''); session.user = null;
  location.reload();          // simplest possible reset — no view can keep stale data
}

/* Is there a usable session? Resolves the current user, or shows the login screen. */
export async function ensureSignedIn(){
  const cfg = await apiRaw('/api/auth/config').catch(() => ({required: false}));
  session.required = !!cfg.required;
  if (!session.required){
    session.user = {name: 'Local', role: 'admin', scope: 'all', email: '', local: true};
    return true;
  }
  if (session.token){
    try{
      session.user = (await apiRaw('/api/auth/me')).user;
      return true;
    }catch(e){ setToken('', ''); }
  }
  showLogin();
  return false;
}

/* The sidebar identity chip: who you are, what you can see, and the way out. */
export function renderWhoAmI(){
  const u = session.user; if (!u) return;
  const av = $('#meAv'), nm = $('#meName'), rl = $('#meRole');
  if (!av) return;
  av.textContent = (u.name || u.email || '?').trim()[0].toUpperCase();
  nm.textContent = u.name || u.email || 'Signed in';
  rl.innerHTML = u.local
    ? 'running without a sign-in'
    : `${u.role === 'admin' ? 'Administrator' : 'Team member'} · ${
        u.scope === 'all' ? 'all accounts' : 'own accounts'}`;
  if (!u.local && !$('#btnSignOut')){
    const b = el('button', 'btn sm ghost', 'Sign out');
    b.id = 'btnSignOut';
    b.style.cssText = 'width:100%;margin-top:8px';
    b.onclick = signOut;
    $('.whoami').after(b);
  }
}
