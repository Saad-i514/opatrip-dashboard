/* Toasts + confirm dialogs.

   Replaces window.alert/confirm: those block the page, look nothing like the rest of the
   UI, and give no room to say what actually happened. These stack, auto-dismiss, and can
   carry an undo action. */
import { $, el, esc } from './core.js';

function host(){
  let h = $('#toastHost');
  if (!h){
    h = el('div'); h.id = 'toastHost'; h.className = 'toasthost';
    document.body.appendChild(h);
  }
  return h;
}

const ICON = {ok:'✓', err:'!', info:'i', warn:'▲'};

/** toast('Saved', {kind:'ok', detail:'…', action:{label:'Undo', fn}}) */
export function toast(message, opts = {}){
  const {kind = 'ok', detail = '', action = null, timeout = kind === 'err' ? 8000 : 4200} = opts;
  const t = el('div', `toast t-${kind}`);
  t.innerHTML = `<span class="tico">${ICON[kind] || ICON.info}</span>
    <div style="min-width:0;flex:1">
      <div class="tmsg">${esc(message)}</div>
      ${detail ? `<div class="tdet">${esc(detail)}</div>` : ''}
    </div>`;
  if (action){
    const b = el('button', 'tact', esc(action.label));
    b.onclick = () => { close(); action.fn(); };
    t.appendChild(b);
  }
  const x = el('button', 'tx', '×');
  t.appendChild(x);
  host().appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  let timer = null;
  function close(){
    clearTimeout(timer);
    t.classList.remove('in');
    setTimeout(() => t.remove(), 220);
  }
  x.onclick = close;
  // hovering pauses the countdown — a message you are still reading shouldn't vanish
  const arm = () => { timer = setTimeout(close, timeout); };
  t.onmouseenter = () => clearTimeout(timer);
  t.onmouseleave = arm;
  arm();
  return close;
}

/** Copy text to the clipboard, and say whether it worked. */
export async function copyText(text){
  let done = false;
  try {
    // navigator.clipboard only exists in a secure context. 127.0.0.1 counts; a LAN
    // address over plain http does not, so the fallback below is what runs there.
    if (navigator.clipboard && window.isSecureContext){
      await navigator.clipboard.writeText(text); done = true;
    }
  } catch(e){}
  if (!done){
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta); ta.select();
    try { done = document.execCommand('copy'); } catch(e){}
    ta.remove();
  }
  toast(done ? `Copied ${text.length} character(s)`
             : 'Could not copy — select the text and press Ctrl+C',
        {kind: done ? 'ok' : 'warn'});
  return done;
}

/** Promise<boolean> confirm dialog. `danger` makes the primary button destructive. */
export function confirmDialog({title, body = '', okLabel = 'Confirm',
                               cancelLabel = 'Cancel', danger = false}){
  return new Promise(resolve => {
    const h = $('#modalHost'); h.innerHTML = '';
    const wrap = el('div');
    wrap.innerHTML = `<div class="scrim"></div>
      <div class="modal card">
        <h2 style="font-size:18px;margin-bottom:6px">${esc(title)}</h2>
        <p class="hint" style="margin:0 0 20px">${esc(body)}</p>
        <div style="display:flex;gap:9px;justify-content:flex-end">
          <button class="btn ghost" data-no>${esc(cancelLabel)}</button>
          <button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(okLabel)}</button>
        </div></div>`;
    h.appendChild(wrap);
    const done = v => { h.innerHTML = ''; resolve(v); };
    wrap.querySelector('.scrim').onclick = () => done(false);
    wrap.querySelector('[data-no]').onclick = () => done(false);
    wrap.querySelector('[data-yes]').onclick = () => done(true);
    wrap.querySelector('[data-yes]').focus();
  });
}
