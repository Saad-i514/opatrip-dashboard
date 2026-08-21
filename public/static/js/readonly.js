/* Read-only deployment: capture cannot be started from the web.

   The three controls that would start or stop a capture stay VISIBLE and clickable —
   hiding them would leave people hunting for a feature and eventually asking why the
   data is stale. Clicking one explains who runs captures and how to reach them.

   This is the courteous half of the guarantee, not the guarantee itself. The deployed
   server has no capture code and no /api/fetch route at all (see web.py), so editing
   this file in a browser gets you nothing. */
import { $, esc } from './core.js';

/* Filled from /api/status so the name and address have ONE source — config.py on the
   server. These defaults only show if the status call has not landed yet. */
export const OWNER = {name: 'Maniha', role: 'Head of Automation Department',
                      email: 'maniha@opatrip.com'};
export function setOwner(o){ if (o && o.email) Object.assign(OWNER, o); }

export function automationNotice(){
  const host = $('#modalHost');
  host.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="scrim"></div>
    <div class="modal wide an-modal" role="dialog" aria-modal="true" aria-labelledby="anTitle">
      <div class="an-badge">● Runs on your laptop, not here</div>
      <h2 id="anTitle" style="font-size:19px;margin:10px 0 8px">
        Fetching data is done with the Automation Tool</h2>
      <p class="an-body">
        To fetch data, please run the <b>Automation Tool on your laptop</b>, following the
        guide and guidance provided by
        <b>${esc(OWNER.name)}</b> (${esc(OWNER.role)},
        <a href="mailto:${esc(OWNER.email)}">${esc(OWNER.email)}</a>).
        If you face any issue, please let her know.
      </p>
      <p class="an-body">
        Your co-operation means a lot to us in improving our systems. Everything else on
        this dashboard works normally — products, reports, change history, photos and
        edits are all live.
      </p>
      <div class="an-why">
        <b>Why it works this way.</b> The capture tool signs in to the Viator supplier
        portal with a real staff account. Keeping that on your own laptop keeps those
        credentials off a shared server — and keeps each person's sign-in traceable to
        them.
      </div>
      <div style="display:flex;gap:9px;justify-content:flex-end;margin-top:18px">
        <button class="btn ghost" data-close>Close</button>
        <a class="btn primary" href="mailto:${esc(OWNER.email)}?subject=${
          encodeURIComponent('Automation Tool — help needed')}">Email ${esc(OWNER.name)}</a>
      </div>
    </div>`;
  host.appendChild(wrap);
  const close = () => { host.innerHTML = ''; document.removeEventListener('keydown', k); };
  const k = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', k);
  wrap.querySelector('.scrim').onclick = close;
  wrap.querySelector('[data-close]').onclick = close;
  wrap.querySelector('[data-close]').focus();
}

/** Point every capture control at the notice, and make sure none of them looks broken. */
export function installReadOnly(){
  for (const id of ['#btnFetch', '#btnStop', '#btnAdd']){
    const b = $(id);
    if (!b) continue;
    // Fetch ships disabled (it waits for a browser session that can never exist here),
    // and a disabled button swallows clicks — so it would silently do nothing.
    b.disabled = false;
    b.onclick = automationNotice;
    b.title = `Captures run on your laptop — click for ${OWNER.name}'s details`;
  }
  // The limit box was removed from the top bar, so there is nothing to disable here.
}
