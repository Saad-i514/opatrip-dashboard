/* Editing.

   Edits are an OVERRIDE LAYER: the captured Viator snapshot is never rewritten, so a
   later sync cannot destroy someone's correction and every edit keeps its author. The
   editor's email is asked for on every edit — traceability is the whole point.

   Entry points:
     askEditor()   – identify the person
     editAll()     – the full grouped form, every field at once
     editField()   – one field
     uploadImage() / deleteImage() – photos, stored in R2 like any captured image
*/
import { S } from './state.js';
import { $, api, el, esc, post } from './core.js';
import { toast, confirmDialog } from './toast.js';

export const EMAIL_OK = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

/* Field definitions come from the SERVER (/api/editable), so adding an editable field is
   a one-line change in db.EDITABLE_FIELDS — this file needs no edit at all. */
let FIELDS = null;
export async function editableFields(){
  if (!FIELDS) FIELDS = (await api('/api/editable')).fields;
  return FIELDS;
}

export function askEditor(){
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

/** Attach a photo. Goes straight to R2 and is flagged as manually added. */
export async function uploadImage(pid, file, onSaved){
  if (!file) return;
  if (!/^image\//.test(file.type))
    return toast('That is not an image', {kind: 'err', detail: file.name});
  const who = await askEditor();
  if (!who) return;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('editor_email', who);
  const close = toast(`Uploading ${file.name}…`, {kind: 'info', timeout: 120000});
  try{
    const r = await fetch(`/api/product/${pid}/image`, {method: 'POST', body: fd});
    const j = await r.json().catch(() => ({}));
    close();
    if (!r.ok) throw new Error(j.detail || r.statusText);
    toast('Photo added', {kind: 'ok',
      detail: `${(j.bytes / 1024).toFixed(0)} KB stored in Cloudflare R2`});
    if (onSaved) onSaved();
  }catch(ex){
    close();
    toast('Upload failed', {kind: 'err', detail: ex.message});
  }
}

export async function deleteImage(pid, imageId, onSaved){
  const who = await askEditor();
  if (!who) return;
  const yes = await confirmDialog({
    title: 'Remove this photo?',
    body: 'It will be deleted from this product. Photos captured from Viator cannot be '
        + 'removed — they are part of the audit record.',
    okLabel: 'Remove photo', danger: true});
  if (!yes) return;
  try{
    const r = await fetch(
      `/api/product/${pid}/image/${imageId}?editor_email=${encodeURIComponent(who)}`,
      {method: 'DELETE'});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || r.statusText);
    toast('Photo removed', {kind: 'ok'});
    if (onSaved) onSaved();
  }catch(ex){
    toast('Could not remove it', {kind: 'err', detail: ex.message});
  }
}
