/* Editing.

   Edits are an OVERRIDE LAYER: the captured Viator snapshot is never rewritten, so a
   later sync cannot destroy someone's correction and every edit keeps its author. The
   editor's email is asked for on every edit — traceability is the whole point.

   Entry points:
     askEditor()   – identify the person
     editAll()     – the full grouped form, every field at once
     editField()   – one field
     editSection() – every editable field in one block, what the portal's Edit opens
*/
import { S } from './state.js';
import { $, api, cachedApi, el, esc, invalidate, post, session } from './core.js';
import { toast } from './toast.js';

export const EMAIL_OK = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

/* Field definitions come from the SERVER (/api/editable), so adding an editable field is
   a one-line change in db.EDITABLE_FIELDS — this file needs no edit at all. */
let FIELDS = null;
export async function editableFields(){
  if (!FIELDS) FIELDS = (await cachedApi('/api/editable')).fields;
  return FIELDS;
}

/* Who is making this change?

   Nobody is asked any more. You signed in, so the server already knows, and it uses the
   signed-in identity regardless of what the browser sends — an edit can no longer be
   filed under a colleague's address by typing theirs into a box.

   The prompt is only reached when the app is running with no sign-in at all (no Supabase
   keys — a developer on a local copy), where there is genuinely nobody to ask. */
export function askEditor(){
  const u = session.user;
  if (u && !u.local && u.email) return Promise.resolve(u.email);
  return new Promise(resolve => {
    const host = $('#modalHost'); host.innerHTML = '';
    const wrap = el('div');
    wrap.innerHTML = `<div class="scrim"></div>
      <div class="modal card">
        <h2 style="font-size:18px;margin-bottom:5px">Who is making this change?</h2>
        <p class="hint" style="margin:0 0 18px">Your email is stored with the change so it
          can be traced back to a person. Nothing is sent anywhere else.</p>
        <label class="fl">Your email
          <input type="email" id="eEmail" placeholder="you@company.com"
                 value="${esc(S.editor)}">
        </label>
        <div id="eErr" class="banner hidden" style="margin-bottom:14px"></div>
        <div style="display:flex;gap:9px;justify-content:flex-end">
          <button class="btn ghost" id="eCancel">Cancel</button>
          <button class="btn primary" id="eGo">Continue</button>
        </div></div>`;
    host.appendChild(wrap);
    const inp = $('#eEmail'), err = $('#eErr');
    const done = v => { host.innerHTML = ''; resolve(v); };
    wrap.querySelector('.scrim').onclick = () => done(null);
    $('#eCancel').onclick = () => done(null);
    const submit = () => {
      const v = inp.value.trim();
      if (!EMAIL_OK(v)){
        err.className = 'banner';
        err.textContent = 'Please enter a valid email — the change is recorded against it.';
        inp.focus(); return;
      }
      S.editor = v; localStorage.setItem('editorEmail', v); done(v);
    };
    $('#eGo').onclick = submit;
    inp.onkeydown = ev => { if (ev.key === 'Enter') submit(); };
    inp.focus(); inp.select();
  });
}

function widget(f, value){
  const v = value == null ? '' : String(value);
  if (f.type === 'textarea')
    return `<textarea id="f_${f.key}" data-k="${f.key}" rows="3">${esc(v)}</textarea>`;
  if (f.type === 'select'){
    const opts = ['', ...(f.options || [])];
    return `<select id="f_${f.key}" data-k="${f.key}">${opts.map(o =>
      `<option value="${esc(o)}" ${o === v ? 'selected' : ''}>${
        esc(o || '— not set —')}</option>`).join('')}</select>`;
  }
  return `<input type="${f.type === 'date' ? 'date' : 'text'}" id="f_${f.key}"
    data-k="${f.key}" value="${esc(v)}">`;
}

/** The full grouped form. Saves only the fields that actually changed. */
export async function editAll(pid, product, edits, onSaved){
  const who = await askEditor();
  if (!who) return;
  const fields = await editableFields();
  const groups = [...new Set(fields.map(f => f.group))];
  const host = $('#modalHost'); host.innerHTML = '';
  const wrap = el('div');
  wrap.innerHTML = `<div class="scrim"></div>
    <div class="modal card wide">
      <h2 style="font-size:18px;margin-bottom:5px">Edit product details</h2>
      <p class="hint" style="margin:0 0 6px">Saved as corrections on top of the captured
        data. The original stays in the snapshot and the next sync will not overwrite it.</p>
      <div class="hint" style="margin-bottom:6px">Signed as <b>${esc(who)}</b></div>
      ${groups.map(g => `<div class="subhead">${esc(g)}</div>
        <div class="formgrid">${fields.filter(f => f.group === g).map(f => `
          <label>${esc(f.label)}${(edits || {})[f.key]
            ? '<span class="changed-dot" title="currently overridden"></span>' : ''}
            ${widget(f, (product || {})[f.key])}</label>`).join('')}</div>`).join('')}
      <label class="fl" style="margin-top:18px">Reason for these changes (optional)
        <input type="text" id="fNote" placeholder="why"></label>
      <div style="display:flex;gap:9px;justify-content:flex-end;position:sticky;bottom:0;
                  background:var(--surface);padding-top:12px">
        <button class="btn ghost" id="fCancel">Cancel</button>
        <button class="btn primary" id="fGo">Save changes</button>
      </div></div>`;
  host.appendChild(wrap);
  const close = () => { host.innerHTML = ''; };
  wrap.querySelector('.scrim').onclick = close;
  $('#fCancel').onclick = close;

  const before = {};
  fields.forEach(f => { before[f.key] = (product || {})[f.key] ?? ''; });

  $('#fGo').onclick = async () => {
    const btn = $('#fGo');
    const changed = fields
      .map(f => [f, ($(`#f_${f.key}`) || {}).value ?? ''])
      .filter(([f, v]) => String(v) !== String(before[f.key] ?? ''));
    if (!changed.length){ close(); toast('Nothing changed', {kind: 'info'}); return; }
    btn.disabled = true; btn.textContent = `Saving ${changed.length}…`;
    const note = $('#fNote').value.trim() || null;
    const failed = [];
    for (const [f, v] of changed){
      try {
        await post(`/api/product/${pid}/edit`,
                   {field: f.key, value: v, editor_email: who, note});
      } catch (ex){ failed.push(`${f.label}: ${ex.message}`); }
    }
    close();
    if (failed.length)
      toast(`${changed.length - failed.length} of ${changed.length} saved`,
            {kind: 'err', detail: failed[0]});
    else
      toast(`Saved ${changed.length} change${changed.length === 1 ? '' : 's'}`,
            {kind: 'ok', detail: changed.map(([f]) => f.label).join(', ')});
    if (onSaved) onSaved();
  };
}

/** One BLOCK's fields at once — what the portal's per-section "Edit" button opens.

    Viator edits a product a block at a time, not a field at a time, so this takes the
    fields that block is showing and puts them in one form. Same override semantics as
    every other edit here: the snapshot is untouched, only what actually changed is sent,
    and each save carries the editor's email. */
export async function editSection(pid, title, items, onSaved){
  if (!items.length) return;
  const who = await askEditor();
  if (!who) return;
  const host = $('#modalHost'); host.innerHTML = '';
  const wrap = el('div');
  const val = it => it.value == null ? ''
    : (typeof it.value === 'object' ? JSON.stringify(it.value, null, 1) : String(it.value));
  wrap.innerHTML = `<div class="scrim"></div>
    <div class="modal card wide">
      <h2 style="font-size:18px;margin-bottom:5px">Edit ${esc(title)}</h2>
      <p class="hint" style="margin:0 0 6px">Saved as corrections on top of what Viator
        gave us. The captured value is kept and the next sync will not overwrite this.</p>
      <div class="hint" style="margin-bottom:12px">Signed as <b>${esc(who)}</b></div>
      <div class="formgrid">${items.map((it, i) => {
        const v = val(it);
        const long = v.length > 60 || v.includes('\n');
        return `<label>${esc(it.label)}
          ${long ? `<textarea data-i="${i}" rows="3">${esc(v)}</textarea>`
                 : `<input type="text" data-i="${i}" value="${esc(v)}">`}</label>`;
      }).join('')}</div>
      <label class="fl" style="margin-top:16px">Reason for these changes (optional)
        <input type="text" id="fNote" placeholder="why"></label>
      <div id="fErr" class="banner hidden" style="margin:12px 0"></div>
      <div style="display:flex;gap:9px;justify-content:flex-end;position:sticky;bottom:0;
                  background:var(--surface);padding-top:12px">
        <button class="btn ghost" id="fCancel">Cancel</button>
        <button class="btn primary" id="fGo">Save changes</button>
      </div></div>`;
  host.appendChild(wrap);
  const close = () => { host.innerHTML = ''; };
  wrap.querySelector('.scrim').onclick = close;
  $('#fCancel').onclick = close;
  $('#fGo').onclick = async () => {
    const btn = $('#fGo');
    const changed = items
      .map((it, i) => [it, (wrap.querySelector(`[data-i="${i}"]`) || {}).value ?? ''])
      .filter(([it, v]) => String(v) !== val(it));
    if (!changed.length){ close(); toast('Nothing changed', {kind: 'info'}); return; }
    btn.disabled = true; btn.textContent = `Saving ${changed.length}…`;
    const note = $('#fNote').value.trim() || null;
    const failed = [];
    for (const [it, v] of changed){
      try { await post(`/api/product/${pid}/edit`,
                       {field: it.path, value: v, editor_email: who, note}); }
      catch (ex){ failed.push(`${it.label}: ${ex.message}`); }
    }
    invalidate();          // the block just changed; nothing may serve the old copy
    close();
    if (failed.length) toast(`${changed.length - failed.length} of ${changed.length} saved`,
                             {kind: 'err', detail: failed[0]});
    else toast(`Saved ${changed.length} change${changed.length === 1 ? '' : 's'}`,
               {kind: 'ok', detail: changed.map(([it]) => it.label).join(', ')});
    if (onSaved) onSaved();
  };
}

/** Edit ANY captured field, identified by its dotted path in the snapshot.

    This is what the pen next to each field calls. The server validates the path against
    what was actually captured, so a field you can see is a field you can correct — and
    the captured value is shown beside the box so the change is never blind. */
export async function editValue(pid, {path, label: lbl, value}, onSaved){
  const who = await askEditor();
  if (!who) return;
  const cur = value == null ? ''
            : (typeof value === 'object' ? JSON.stringify(value, null, 1) : String(value));
  const long = cur.length > 60 || cur.includes('\n');
  const host = $('#modalHost'); host.innerHTML = '';
  const wrap = el('div');
  wrap.innerHTML = `<div class="scrim"></div>
    <div class="modal card">
      <h2 style="font-size:18px;margin-bottom:5px">Edit ${esc(lbl)}</h2>
      <p class="hint" style="margin:0 0 4px">Recorded as a correction by
        <b>${esc(who)}</b>. The captured value is kept, and the next sync will not
        overwrite this.</p>
      <div class="mono hint" style="margin-bottom:16px">${esc(path)}</div>
      <div class="formgrid"><label>${esc(lbl)}
        ${long ? `<textarea id="fVal" rows="6">${esc(cur)}</textarea>`
               : `<input type="text" id="fVal" value="${esc(cur)}">`}</label></div>
      <label class="fl" style="margin-top:14px">Reason (optional)
        <input type="text" id="fNote" placeholder="why this was changed"></label>
      <div id="fErr" class="banner hidden" style="margin:12px 0"></div>
      <div style="display:flex;gap:9px;justify-content:space-between;align-items:center">
        <button class="btn ghost sm" id="fRevert" ${value == null ? 'disabled' : ''}
          title="Remove the manual override and go back to what Viator says">Revert</button>
        <span style="display:flex;gap:9px">
          <button class="btn ghost" id="fCancel">Cancel</button>
          <button class="btn primary" id="fGo">Save</button>
        </span>
      </div></div>`;
  host.appendChild(wrap);
  const close = () => { host.innerHTML = ''; };
  wrap.querySelector('.scrim').onclick = close;
  $('#fCancel').onclick = close;

  const save = async (v) => {
    const btn = $('#fGo'); btn.disabled = true; btn.textContent = 'Saving…';
    try{
      await post(`/api/product/${pid}/edit`, {
        field: path, value: v, editor_email: who,
        note: $('#fNote').value.trim() || null});
      invalidate();          // the change must show at once, not in 45 seconds
      close();
      toast(`${lbl} updated`, {kind: 'ok', detail: `recorded against ${who}`});
      if (onSaved) onSaved();
    }catch(ex){
      $('#fErr').className = 'banner'; $('#fErr').textContent = ex.message;
      btn.disabled = false; btn.textContent = 'Save';
    }
  };
  $('#fGo').onclick = () => save($('#fVal').value);
  $('#fRevert').onclick = () => save(null);   // clears the override
  const inp = $('#fVal'); if (inp){ inp.focus(); inp.select(); }
}

/** One field, for the inline Edit buttons. */
export async function editField(pid, key, current, onSaved){
  const who = await askEditor();
  if (!who) return;
  const fields = await editableFields();
  const f = fields.find(x => x.key === key);
  if (!f) return toast(`${key} can't be edited`, {kind: 'err'});
  const host = $('#modalHost'); host.innerHTML = '';
  const wrap = el('div');
  wrap.innerHTML = `<div class="scrim"></div>
    <div class="modal card">
      <h2 style="font-size:18px;margin-bottom:5px">Edit ${esc(f.label)}</h2>
      <p class="hint" style="margin:0 0 18px">The captured value is kept; this is recorded
        as a correction by <b>${esc(who)}</b>.</p>
      <div class="formgrid"><label>${esc(f.label)}${widget(f, current)}</label></div>
      <label class="fl" style="margin-top:14px">Reason (optional)
        <input type="text" id="fNote" placeholder="why this was changed"></label>
      <div id="fErr" class="banner hidden" style="margin:14px 0"></div>
      <div style="display:flex;gap:9px;justify-content:flex-end">
        <button class="btn ghost" id="fCancel">Cancel</button>
        <button class="btn primary" id="fGo">Save edit</button>
      </div></div>`;
  host.appendChild(wrap);
  const close = () => { host.innerHTML = ''; };
  wrap.querySelector('.scrim').onclick = close;
  $('#fCancel').onclick = close;
  $('#fGo').onclick = async () => {
    const btn = $('#fGo'); btn.disabled = true; btn.textContent = 'Saving…';
    try{
      await post(`/api/product/${pid}/edit`, {
        field: key, value: $(`#f_${key}`).value, editor_email: who,
        note: $('#fNote').value.trim() || null});
      close();
      toast(`${f.label} updated`, {kind: 'ok', detail: `recorded against ${who}`});
      if (onSaved) onSaved();
    }catch(ex){
      $('#fErr').className = 'banner'; $('#fErr').textContent = ex.message;
      btn.disabled = false; btn.textContent = 'Save edit';
    }
  };
  const inp = $(`#f_${key}`); if (inp) inp.focus();
}

/** Opens modal for adding bulk/raw structured text to the product. */
export async function openAddDataModal(pid, cur, onSaved) {
  const who = await askEditor();
  if (!who) return;

  const host = $('#modalHost'); host.innerHTML = '';
  const wrap = el('div');
  
  const curP = (cur && cur.product) || {};
  const initialTitle = curP.title || '';

  const sampleTemplate = `${initialTitle || 'Private LGBT+ History & Nightlife Tour of Soho, London'}
────────────────────────────────────────
OVERVIEW
Duration: ${curP.duration || '3h 0m'}
Theme: ${curP.themes || 'Lifestyle & Celebrations — LGBT, Nightlife, Party/Celebration'}
Category: ${curP.category || 'Walking Tours'}
Languages: English
Max travelers: 15
Meeting point: Trafalgar Square, London

ATTRACTIONS
1. Trafalgar Square, London — 10 min, admission: NA
2. Old Compton Street, London — 15 min, admission: NA
3. Admiral Duncan, London — 20 min, admission: NA
4. Soho Square, London — 12 min, admission: NA
5. Piccadilly Circus, London — 10 min, admission: NA
6. Rupert Street Bar, London — 25 min, admission: Yes
7. Comptons of Soho, London — 14 min, admission: NA

INCLUSIONS
Professional local guide: Stu Helm
All admission tickets (including Rupert Street Bar weekend cover charge)
Food tastings

EXCLUSIONS
Gratuities (at client's discretion)
Shopping and personal expenses

DESCRIPTION
Step into the soul of London's LGBTQ+ history on this private 3-hour walking tour through the legendary streets of Soho. Beginning at iconic Trafalgar Square, the journey winds through Old Compton Street — the undisputed centre of London's gay village — before ducking into the Admiral Duncan, a pub that has stood as a beacon of community and resilience since 1832. Stroll through the leafy calm of Soho Square, absorb the neon spectacle of Piccadilly Circus, and raise a glass at Rupert Street Bar, one of the capital's longest-running LGBTQ+ venues, with your cover charge included. The tour wraps up at Comptons of Soho, a Victorian institution and enduring symbol of queer culture since 1986. Food tastings are included along the way, and your expert private guide brings every story to life — from hard-won freedoms to the vibrant scene thriving today.

PRICING
Public price: 829
Guide fee: 232
Currency: USD

MEETING & PICKUP
Meeting point: Trafalgar Square, London
Meeting arrangement: MEET_AT_DEPARTURE_POINT
Pickup type: VEHICLE
Pickup vehicle: Mercedes Executive Van
Route map: https://maps.google.com/?q=Soho+London

LINKS
Admission source links:
https://www.example.com/admission-tickets
Hours source links:
https://www.example.com/hours-and-times

QUALITY
Quality level: GOOD
Status: LIVE`;

  wrap.innerHTML = `<div class="scrim"></div>
    <div class="modal card" style="max-width:850px;width:95%;max-height:92vh;display:flex;flex-direction:column;padding:24px;border-radius:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div>
          <h2 style="font-size:20px;margin:0 0 4px;font-weight:700">Add Data to Product</h2>
          <div class="hint" style="font-size:13px">Paste structured multiline text below. All recognized sections and fields will be automatically extracted and saved into this product.</div>
        </div>
        <button class="btn ghost sm" id="btnCloseRawModal" style="font-size:20px;line-height:1;padding:4px 8px;cursor:pointer">&times;</button>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:10px;align-items:center">
        <button class="btn sm" id="btnFillSample" style="background:#f1f5f9;border:1px solid #cbd5e1;color:#334155;font-weight:600;cursor:pointer">
          📋 Load Full Sample Format
        </button>
        <span class="hint" style="font-size:12px">Use section headers like OVERVIEW, ATTRACTIONS, INCLUSIONS, EXCLUSIONS, DESCRIPTION, PRICING, LINKS, QUALITY</span>
      </div>

      <div style="flex:1;min-height:360px;display:flex;flex-direction:column;margin-bottom:14px">
        <textarea id="rawProductText" style="flex:1;width:100%;height:380px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:13px;line-height:1.5;padding:12px;border:1px solid #cbd5e1;border-radius:8px;resize:vertical;outline:none;background:#fafbfc" placeholder="${esc(sampleTemplate)}"></textarea>
      </div>

      <div id="rawErr" class="banner hidden" style="margin-bottom:12px"></div>

      <div style="display:flex;gap:10px;justify-content:flex-end;align-items:center">
        <button class="btn ghost" id="btnCancelRaw">Cancel</button>
        <button class="btn primary" id="btnSaveRaw" style="padding:8px 20px;font-weight:600">Save & Update Product</button>
      </div>
    </div>`;

  host.appendChild(wrap);

  const txt = wrap.querySelector('#rawProductText');
  const err = wrap.querySelector('#rawErr');
  const done = () => { host.innerHTML = ''; };

  wrap.querySelector('.scrim').onclick = done;
  wrap.querySelector('#btnCloseRawModal').onclick = done;
  wrap.querySelector('#btnCancelRaw').onclick = done;

  wrap.querySelector('#btnFillSample').onclick = () => {
    txt.value = sampleTemplate;
    txt.focus();
  };

  wrap.querySelector('#btnSaveRaw').onclick = async () => {
    const rawVal = txt.value.trim();
    if (!rawVal) {
      err.className = 'banner';
      err.textContent = 'Please enter or paste your formatted product text.';
      txt.focus();
      return;
    }

    const saveBtn = wrap.querySelector('#btnSaveRaw');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving & Updating…';
    err.className = 'banner hidden';

    try {
      const res = await post(`/api/product/${pid}/raw-data`, {
        raw_text: rawVal,
        editor_email: who
      });
      if (res && res.ok) {
        toast('Product data successfully updated!', {kind: 'ok'});
        done();
        invalidate();
        if (onSaved) onSaved();
      } else {
        throw new Error(res?.error || res?.message || 'Failed to update product data');
      }
    } catch (e) {
      err.className = 'banner';
      err.textContent = e.message || String(e);
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save & Update Product';
    }
  };

  txt.focus();
}

/* uploadImage() and deleteImage() were removed with photo storage. The dashboard
   no longer shows or accepts photos; POST /api/product/<id>/image refuses too, so
   there is no client left for them. A photo CHANGED on Viator is still recorded --
   see the Edit history on the product page. */
