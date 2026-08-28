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

  const sampleTemplate = `${initialTitle || 'Private Berlin Michelin-Star Tour for French Couples'}
────────────────────────────────────────
OVERVIEW
Duration: ${curP.duration || '2h 30m'}
Theme: ${curP.themes || 'History, Heritage, Culture'}
Category: ${curP.category || 'History & Culture'}
Languages: French, English
Max travelers: 15
Group type: Private
Skip the line: Yes
Customizable: Yes
Customizable parts: Start Time, Duration, Inclusions
Product type: STANDARD_TOUR
Itinerary type: STANDARD
Tour modes: WALKING_TOUR, VEHICLE_TOUR
Product types: CULTURAL_TOURS, HISTORICAL_TOURS
Reseller status: NOT_RESELLER
Guide certified: Yes
Guide is driver: Yes
Helpline: +49 30 1234567
Public page: https://www.viator.com/tours/Berlin/sample
Location: Berlin, Germany

ATTRACTIONS
1. Brandenburg Gate — 20 min, admission: Free Entry — Marvel at the iconic 18th-century neoclassical monument and hear stories of the Cold War divide
2. Reichstag Building — 25 min, admission: Included — Explore the historic parliament building with reserved admission to the iconic glass dome
3. Soviet War Memorial Tiergarten — 15 min, admission: Free Entry — Walk through the serene memorial garden flanking 1945 artillery monuments
4. Memorial to the Murdered Jews of Europe — 20 min, admission: Free Entry — Walk through the field of 2,711 concrete stelae with guided historical context
5. Potsdamer Platz — 15 min, admission: Free Entry — Explore the bustling epicenter of modern Berlin architecture and former No Man's Land
6. Topography of Terror — 30 min, admission: Included — Guided walkthrough of the indoor and outdoor exhibition along the surviving Berlin Wall segment
7. Checkpoint Charlie — 15 min, admission: Free Entry — Stop at the famed Cold War crossing point and guardhouse for photos and historical stories

INCLUSIONS
Professional local guide: Stu Helm
All admission tickets (including special exhibition entry)
Food tastings and refreshments
Private vehicle transport

EXCLUSIONS
Gratuities (at client's discretion)
Personal shopping expenses

DESCRIPTION
Step into the soul of Berlin's history on this private 2.5-hour walking tour through the legendary streets of Berlin. Beginning at iconic Brandenburg Gate, the journey winds through the Reichstag and Memorials.

ADDITIONAL INFO
Wheelchair accessible
Near public transportation
Stroller accessible
Comfortable walking shoes recommended

FAQS
What should I wear? — Comfortable walking shoes are recommended.
Is transport included? — Yes, private Mercedes vehicle is included.

PRICING
Public price: 829
Guide fee: 232
Currency: USD
Price unit: PER_PERSON
Dynamic pricing: No
Base margin: 22
Boost margin: 2
Accelerate opted in: Yes

MEETING & PICKUP
Meeting point: Pariser Platz, 10117 Berlin, Germany
Meeting address: Pariser Platz, 10117 Berlin, Germany
Meeting arrangement: MEET_AT_DEPARTURE_POINT
Pickup transport type: VEHICLE
Pickup vehicle: Mercedes Executive Van
Route map: https://maps.google.com/?q=Berlin
Ends where starts: Yes
Pickup optional: No

BOOKING
Confirmation type: INSTANT
Cut-off hours: 24
Cancellation policy: STANDARD
Bad-weather cancellation: Yes
Email every booking: Yes

TRAVELLER REQUIREMENTS
Required info: Full names, Passport details, Mobile phone number

TICKETS & VOUCHER
Ticket format: ELECTRONIC
Tickets per booking: PER_BOOKING
Show barcode on ticket: Yes
Special instructions: Present your mobile voucher to the tour guide at the fountain.

CONNECTIVITY
Supplier code: PROD-BER-001
Reservation system: Custom Viator Connect

LINKS
Admission source links:
https://www.example.com/admission-tickets
Hours source links:
https://www.example.com/hours-and-times

QUALITY & STATUS
Quality level: GOOD
Status: LIVE
Reviews count: 18
Review rating: 4.95`;

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

export async function openCreateProductModal(preselectedAccount = null) {
  const host = $('#dialog-host');
  if (!host) return;
  host.innerHTML = '';
  const wrap = el('div');

  // Fetch accounts list
  let accts = [];
  try {
    const res = await api('/api/accounts');
    accts = (res && res.accounts) || [];
  } catch(e) {
    console.error('Failed to load accounts for create product modal', e);
  }

  const defaultAcctId = preselectedAccount || S.acct || (accts[0] ? accts[0].id : '');

  const sampleTemplate = `Berlin's Best: Third Reich and Cold War 2-Hour Walking Tour
────────────────────────────────────────
OVERVIEW
Duration: 2h 0m
Theme: History, Heritage, Culture
Category: History & Culture
Languages: French, English
Max travelers: 15
Group type: Private
Skip the line: Yes
Customizable: Yes
Customizable parts: Start Time, Duration, Inclusions
Product type: STANDARD_TOUR
Itinerary type: STANDARD
Tour modes: WALKING_TOUR, VEHICLE_TOUR
Product types: CULTURAL_TOURS, HISTORICAL_TOURS
Reseller status: NOT_RESELLER
Guide certified: Yes
Guide is driver: Yes
Helpline: +49 30 1234567
Public page: https://www.viator.com/tours/Berlin/sample
Location: Berlin, Germany

ATTRACTIONS
1. Brandenburg Gate — 20 min, admission: Free Entry — Marvel at the iconic 18th-century neoclassical monument and hear stories of the Cold War divide
2. Reichstag Building — 25 min, admission: Included — Explore the historic parliament building with reserved admission to the iconic glass dome
3. Soviet War Memorial Tiergarten — 15 min, admission: Free Entry — Walk through the serene memorial garden flanking 1945 artillery monuments
4. Memorial to the Murdered Jews of Europe — 20 min, admission: Free Entry — Walk through the field of 2,711 concrete stelae with guided historical context
5. Potsdamer Platz — 15 min, admission: Free Entry — Explore the bustling epicenter of modern Berlin architecture and former No Man's Land
6. Topography of Terror — 30 min, admission: Included — Guided walkthrough of the indoor and outdoor exhibition along the surviving Berlin Wall segment
7. Checkpoint Charlie — 15 min, admission: Free Entry — Stop at the famed Cold War crossing point and guardhouse for photos and historical stories

INCLUSIONS
Professional local guide: Stu Helm
All admission tickets (including special exhibition entry)
Food tastings and refreshments
Private vehicle transport

EXCLUSIONS
Gratuities (at client's discretion)
Personal shopping expenses

DESCRIPTION
Step into the soul of Berlin's history on this private 2.5-hour walking tour through the legendary streets of Berlin. Beginning at iconic Brandenburg Gate, the journey winds through the Reichstag and Memorials.

ADDITIONAL INFO
Wheelchair accessible
Near public transportation
Stroller accessible
Comfortable walking shoes recommended

FAQS
What should I wear? — Comfortable walking shoes are recommended.
Is transport included? — Yes, private Mercedes vehicle is included.

PRICING
Public price: 829
Guide fee: 232
Currency: USD
Price unit: PER_PERSON
Dynamic pricing: No
Base margin: 22
Boost margin: 2
Accelerate opted in: Yes

MEETING & PICKUP
Meeting point: Pariser Platz, 10117 Berlin, Germany
Meeting address: Pariser Platz, 10117 Berlin, Germany
Meeting arrangement: MEET_AT_DEPARTURE_POINT
Pickup transport type: VEHICLE
Pickup vehicle: Mercedes Executive Van
Route map: https://maps.google.com/?q=Berlin
Ends where starts: Yes
Pickup optional: No

BOOKING
Confirmation type: INSTANT
Cut-off hours: 24
Cancellation policy: STANDARD
Bad-weather cancellation: Yes
Email every booking: Yes

TRAVELLER REQUIREMENTS
Required info: Full names, Passport details, Mobile phone number

TICKETS & VOUCHER
Ticket format: ELECTRONIC
Tickets per booking: PER_BOOKING
Show barcode on ticket: Yes
Special instructions: Present your mobile voucher to the tour guide at the fountain.

CONNECTIVITY
Supplier code: PROD-BER-001
Reservation system: Custom Viator Connect

LINKS
Admission source links:
https://www.example.com/admission-tickets
Hours source links:
https://www.example.com/hours-and-times

QUALITY & STATUS
Quality level: GOOD
Status: LIVE
Reviews count: 18
Review rating: 4.95`;

  const acctOptions = accts.map(a => {
    const isSel = (String(a.id) === String(defaultAcctId) || a.code === defaultAcctId || a.name === defaultAcctId);
    return `<option value="${esc(a.id)}" ${isSel ? 'selected' : ''}>${esc(a.name || a.code)} (${a.product_count || 0} products)</option>`;
  }).join('');

  wrap.innerHTML = `<div class="scrim"></div>
    <div class="modal card" style="max-width:860px;width:95%;max-height:92vh;display:flex;flex-direction:column;padding:24px;border-radius:12px;box-shadow:0 20px 40px rgba(0,0,0,0.18)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div>
          <h2 style="font-size:20px;margin:0 0 4px;font-weight:700">Add New Product</h2>
          <div class="hint" style="font-size:13px">Select an existing account and paste raw tour details. All recognized fields will be extracted and auto-calculated into a new listing.</div>
        </div>
        <button class="btn ghost sm" id="btnCloseCreateModal" style="font-size:20px;line-height:1;padding:4px 8px;cursor:pointer">&times;</button>
      </div>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;padding:12px 14px;border-radius:8px;margin-bottom:12px;display:flex;align-items:center;gap:12px">
        <label style="font-weight:600;font-size:13px;color:#1e293b;white-space:nowrap">Select Existing Account:</label>
        <select id="createAcctSelect" style="flex:1;max-width:400px;padding:6px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;background:#fff;cursor:pointer">
          ${acctOptions || '<option value="">(No accounts found - default)</option>'}
        </select>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:10px;align-items:center">
        <button class="btn sm" id="btnFillCreateSample" style="background:#f1f5f9;border:1px solid #cbd5e1;color:#334155;font-weight:600;cursor:pointer">
          📋 Load Full Sample Format
        </button>
        <span class="hint" style="font-size:12px">Paste your raw tour text below or load the format template.</span>
      </div>

      <div style="flex:1;min-height:340px;display:flex;flex-direction:column;margin-bottom:14px">
        <textarea id="rawCreateProductText" style="flex:1;width:100%;height:350px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:13px;line-height:1.5;padding:12px;border:1px solid #cbd5e1;border-radius:8px;resize:vertical;outline:none;background:#fafbfc" placeholder="${esc(sampleTemplate)}"></textarea>
      </div>

      <div id="rawCreateErr" class="banner hidden" style="margin-bottom:12px"></div>

      <div style="display:flex;gap:10px;justify-content:flex-end;align-items:center">
        <button class="btn ghost" id="btnCancelCreate">Cancel</button>
        <button class="btn primary" id="btnSaveCreate" style="padding:8px 20px;font-weight:600;display:flex;align-items:center;gap:6px">
          <span>+</span> Save & Create Product
        </button>
      </div>
    </div>`;

  host.appendChild(wrap);

  const txt = wrap.querySelector('#rawCreateProductText');
  const sel = wrap.querySelector('#createAcctSelect');
  const err = wrap.querySelector('#rawCreateErr');
  const done = () => { host.innerHTML = ''; };

  wrap.querySelector('.scrim').onclick = done;
  wrap.querySelector('#btnCloseCreateModal').onclick = done;
  wrap.querySelector('#btnCancelCreate').onclick = done;

  wrap.querySelector('#btnFillCreateSample').onclick = () => {
    txt.value = sampleTemplate;
    txt.focus();
  };

  const btnSave = wrap.querySelector('#btnSaveCreate');
  btnSave.onclick = async () => {
    const rawVal = txt.value.trim();
    if (!rawVal) {
      err.textContent = 'Please enter or paste raw product text.';
      err.classList.remove('hidden');
      return;
    }
    const selectedAcct = sel ? sel.value : (defaultAcctId || '');
    if (!selectedAcct) {
      err.textContent = 'Please select an existing account.';
      err.classList.remove('hidden');
      return;
    }

    btnSave.disabled = true;
    btnSave.textContent = 'Creating Product...';
    err.classList.add('hidden');

    try {
      const res = await api('/api/products/create-from-raw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: selectedAcct,
          raw_text: rawVal,
          editor_email: S.user ? S.user.email : null
        })
      });

      if (!res || !res.ok) {
        throw new Error((res && res.detail) || (res && res.message) || 'Failed to create product.');
      }

      done();
      toast(`Created new product ${res.product_code || ''} successfully!`, 'ok');
      invalidate('/api/products');
      invalidate('/api/overview');
      invalidate('/api/accounts');
      if (typeof viewProducts === 'function') {
        viewProducts();
      }
      if (res.product_id && typeof openDrawer === 'function') {
        openDrawer(res.product_id);
      }
    } catch(ex) {
      err.textContent = ex.message || 'An error occurred while creating the product.';
      err.classList.remove('hidden');
      btnSave.disabled = false;
      btnSave.innerHTML = '<span>+</span> Save & Create Product';
    }
  };
}

/* uploadImage() and deleteImage() were removed with photo storage. The dashboard
   no longer shows or accepts photos; POST /api/product/<id>/image refuses too, so
   there is no client left for them. A photo CHANGED on Viator is still recorded --
   see the Edit history on the product page. */
