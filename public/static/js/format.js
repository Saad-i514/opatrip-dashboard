import { el, esc, q } from './core.js';
import { when } from './views/drawer.js';
import { go } from './app.js';

/* ======================= value formatting =======================
   The capture stores the portal's raw JSON. Everything below turns that into plain
   English: CONSTANT_CASE -> "Sentence case", camelCase keys -> spaced labels, booleans
   -> Yes/No, 10:00:00 -> 10:00 AM, minutes -> 2h 30m. Unknown fields still render, just
   with a derived label, so nothing is hidden when the portal adds something new.        */
export const words = s => String(s)
  .replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ')
  .replace(/\s+/g,' ').trim();
export const sentence = s => { s = words(s).toLowerCase();
  return s.charAt(0).toUpperCase()+s.slice(1); };
export const LABELS = {
  productCode:'Product code', localizedViatorUrl:'Public page', briefDescription:'Description',
  isActive:'Active', durationInMinutes:'Duration', privateTour:'Private tour',
  isCustomizable:'Customizable', skipTheLine:'Skip the line', productItineraryType:'Itinerary type',
  bookingCutoffType:'Cut-off measured from', bookingCutoffInHours:'Cut-off',
  confirmationType:'Confirmation', isSendNotificationForEachBooking:'Email me every booking',
  ticketType:'Ticket format', ticketsPerBooking:'Tickets per booking',
  exchangePoint:'Exchange point', barcodeType:'Barcode format',
  showBarcodeOnTicket:'Show barcode on ticket', specialInstructions:'Special instructions',
  supplierProductCode:'Your system’s product code', priceUnit:'Priced per',
  priceUnitType:'Price unit type', pickupOptionType:'Pickup', endsAtStartPoint:'Ends where it starts',
  isPickupOfferedAndOptional:'Pickup optional', baseMargin:'Commission',
  minimumAge:'Minimum age', maximumAge:'Maximum age', isUsed:'In use',
  totalReviewCount:'Reviews', performanceStatus:'Performance', quality_level:'Quality',
  commission_percent:'Commission', isHumanGuideCertified:'Guide certified',
  isHumanGuideDriver:'Guide is the driver', startDate:'From', endDate:'To',
  timeZone:'Time zone', isAutoExtended:'Auto-extends', displayText:'Detail',
};
export const label = k => LABELS[k] || words(k).replace(/^./,c=>c.toUpperCase());

export function fmtTime(v){
  const m = /^(\d{2}):(\d{2})(:\d{2})?$/.exec(String(v)); if(!m) return null;
  let h = +m[1]; const ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12;
  return `${h}:${m[2]} ${ap}`;
}
export function fmtDate(v){
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v)); if(!m) return null;
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${+m[3]} ${M[+m[2]-1]} ${m[1]}`;
}
export function fmtDuration(min){
  min = Number(min); if(!isFinite(min)||min<=0) return null;
  const h = Math.floor(min/60), m = min%60;
  return h ? (m ? `${h}h ${m}m` : `${h} hour${h>1?'s':''}`) : `${m} min`;
}
export function fmtVal(v, key){
  if (v === null || v === undefined || v === '') return '<span class="hint">—</span>';
  if (typeof v === 'boolean') return v ? '<span class="yes">Yes</span>'
                                       : '<span class="no">No</span>';
  if (typeof v === 'number'){
    if (/margin|commission|percent/i.test(key||'')) return esc(v)+'%';
    if (/hours?$/i.test(key||'')) return esc(v)+(v===1?' hour':' hours');
    if (/durationInMinutes/i.test(key||'')) return esc(fmtDuration(v)||v);
    return esc(v);
  }
  const s = String(v);
  if (/^https?:\/\//.test(s))
    return `<a href="${esc(s)}" target="_blank" rel="noopener">${esc(
      s.length>52 ? s.slice(0,52)+'…' : s)}</a>`;
  return esc(fmtTime(s) || fmtDate(s) ||
    (/^[A-Z][A-Z0-9_]{2,}$/.test(s) ? sentence(s) : s));
}

/* rows(obj) — aligned label/value pairs, skipping empties and nested noise */
/* ---------- inline editing context ----------
   sections.js is pure rendering and knows nothing about products or the API. Rather than
   thread a product id through fifteen section functions, the drawer sets the context once
   before it builds them. */
let EDITCTX = null;
export function setEditContext(ctx){ EDITCTX = ctx; }
export function editContext(){ return EDITCTX; }

/** Read a dotted path out of the captured snapshot. */
export function getPath(obj, path){
  let cur = obj;
  for (const part of String(path).split('.')){
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

/* rows(pairs) — aligned label / value / edit triples.

   A pair is [label, displayValue] or [label, displayValue, snapshotPath]. Where a path is
   given AND an edit context is active, the row gets a pen button in a THIRD grid column,
   so every pen lines up vertically no matter how long the values are.

   Rows carrying a path are rendered even when empty: that is what makes information
   possible to ADD, not just correct. */
export function rows(pairs){
  const ctx = EDITCTX;
  const editable = !!ctx && pairs.some(p => Array.isArray(p) && p.length > 2 && p[2]);
  const wrap = el('div', editable ? 'rows editable' : 'rows');
  let any = false;
  pairs.forEach(entry => {
    const [k, v, path] = entry;
    const ed = (ctx && path) ? (ctx.edits || {})[path] : null;
    const blank = v === undefined || v === null || v === ''
                  || (Array.isArray(v) && !v.length);
    if (blank && !ed && !(editable && path)) return;
    any = true;
    const text = typeof k === 'string' ? label(k) : k;
    wrap.appendChild(el('div','k', esc(text)));
    const cell = el('div','v');
    if (ed){
      // a manual override wins the display, and says so
      cell.innerHTML = (ed.value == null || ed.value === '')
        ? '<span class="hint">—</span>' : esc(ed.value);
      cell.innerHTML += ' <span class="badge b-stub">edited</span>'
        + `<span class="was">by ${esc(ed.editor_email)}`
        + (ed.captured_value != null
           ? ` · Viator had: <span class="old">${esc(String(ed.captured_value).slice(0,70))}</span>`
           : '') + '</span>';
    } else if (blank){
      cell.innerHTML = '<span class="hint">Not set</span>';
    // Primitives go through fmtVal so a boolean shows as Yes/No rather than "false";
    // strings are already-built HTML (chips, lists, links) and pass through untouched.
    } else if (v instanceof Node) cell.appendChild(v);
    else if (typeof v === 'boolean' || typeof v === 'number') cell.innerHTML = fmtVal(v, k);
    else cell.innerHTML = v;
    wrap.appendChild(cell);
    if (editable){
      const act = el('div','act');
      if (path){
        const b = el('button','penbtn');
        b.innerHTML = '&#9998;';                 // pencil
        b.title = `Edit ${text}`;
        b.setAttribute('aria-label', `Edit ${text}`);
        b.dataset.path = path;
        b.onclick = () => ctx.edit({
          path, label: text,
          value: ed ? ed.value : getPath(ctx.snapshot, path)});
        act.appendChild(b);
      }
      wrap.appendChild(act);      // always appended, so the grid stays aligned
    }
  });
  return any ? wrap : null;
}
/* A value someone may need to READ IN FULL and copy — what Viator had before a manual
   edit, or the old side of a change. A table column is ~130px wide, so no amount of
   in-cell wrapping shows a 700-character description: the cell stays a preview, and
   CLICKING it opens the whole value with a Copy button.
   `tone`: 'old' colours it as the superseded value. No line-through — striking out 700
   characters makes the text people came here to read hard to read.
   `label` titles the popup ("Viator had", "Before", …).                                */
/* ---------- photo changes, told as one sentence ----------------------------------------
   Photos are no longer stored, but a photo swapped on Viator is still detected: the
   snapshot holds product.media (each photo's ref, CDN URL, caption and order) and diff()
   walks those paths like any other field.

   The trouble is the volume. Because a photo is keyed by its Viator ref, REPLACING one
   rewrites every field under the old ref to null and writes a new ref beside it — one
   deletion measured 64 change rows for what a person would call three edits, reading
   "Photos › IMG-fd6375b7… › Is Error: False → None". True, and useless.

   So the rows are grouped for DISPLAY only — one line per product per moment, naming what
   happened and to how many photos. Nothing is dropped from the audit trail; `changes`
   still holds every path, which is the point of having it. */
const PHOTO_PATH = /^product\.(media|heroPhoto)\b/;
const isSet = v => v !== null && v !== undefined && v !== '';
export function groupChanges(list){
  const out = [], bucket = new Map();
  (list || []).forEach(c => {
    const path = c.field_path || '';
    if (!PHOTO_PATH.test(path)){ out.push({photos: false, c}); return; }
    // one group per product per detection moment — that is one sync noticing one edit
    const key = `${c.product_code || ''}|${c.detected_at || ''}`;
    let g = bucket.get(key);
    if (!g){ g = {photos: true, c, refs: new Map()}; bucket.set(key, g); out.push(g); }
    const m = /\[([^\]]+)\]/.exec(path);
    const ref = m ? m[1] : '(photo)';
    if (!g.refs.has(ref)) g.refs.set(ref, {added: 0, removed: 0, moved: 0, edited: 0});
    const s = g.refs.get(ref);
    const had = isSet(c.old_value), has = isSet(c.new_value);
    if (!had && has) s.added++;
    else if (had && !has) s.removed++;
    else if (/sortOrder$/.test(path)) s.moved++;
    else s.edited++;
  });
  return out;
}
/* "2 photos added · 1 photo removed". Deliberately NOT "replaced": a replacement looks
   exactly like an add plus a remove from here, and saying which it was would be a guess. */
export function photoSummary(g){
  let add = 0, rem = 0, mov = 0, edt = 0;
  g.refs.forEach(s => {
    if (s.added && !s.removed) add++;
    else if (s.removed && !s.added) rem++;
    else if (s.edited) edt++;
    else if (s.moved) mov++;
  });
  const say = (n, word) => n ? `${n} ${n === 1 ? 'photo' : 'photos'} ${word}` : null;
  return [say(add, 'added'), say(rem, 'removed'), say(edt, 'updated'),
          say(mov, 'reordered')].filter(Boolean).join(' · ') || 'photos changed';
}

/* readable(x) — the last resort for an object no renderer has a specific shape for.
   That fallback used to be JSON.stringify(x), which put this in front of someone who
   only wanted to read a price list:

     {"exclusionRef":"dfe37607-…","extraChargeName":"Entrance fee Mozart's Birthplace",
      "productOptions":[{"productOptionRef":"OPT-…","productOptionTitle":"DEFAULT"}]}

   It fired whenever the portal named a field something we had not listed — here the name
   lives in `extraChargeName`, and only `displayText`/`type` were being checked. So the
   fix is not another key in the list: it is to stop dumping JSON at all. Take the field
   that holds the name, and drop every ref, id and code — nobody reading a listing needs
   a UUID. Returns '' when there is genuinely nothing sayable, so callers can skip it. */
const NAMEY = /(name|title|text|label|question|description|type)$/i;
const REFY = /(ref|id|uuid|code|key)$/i;
export function readable(x){
  if (x === null || x === undefined) return '';
  if (typeof x !== 'object') return String(x);
  if (Array.isArray(x)) return x.map(readable).filter(Boolean).join(', ');
  const said = k => typeof x[k] === 'string' && x[k].trim() ? x[k].trim() : null;
  const keys = Object.keys(x).filter(k => !REFY.test(k) && said(k));
  const main = keys.find(k => NAMEY.test(k));
  return main ? said(main) : keys.map(said).join(' · ');
}
export function fullText(v){
  let s = (v === null || v === undefined) ? '' : String(v);
  // pretty-print JSON: a one-line blob is exactly the thing that most needs unpacking
  try { const p = JSON.parse(s);
        if (p && typeof p === 'object') s = JSON.stringify(p, null, 2); } catch(e){}
  return s;
}
export function valueBox(v, tone, label){
  const s = fullText(v);
  if (!s) return '<span class="hint">(none)</span>';
  const short = s.length > 90 ? s.slice(0, 90) + '…' : s;
  // The full text is carried in a hidden element, not a data- attribute: textContent
  // hands back the exact original with no escaping round trip to get wrong.
  return `<span class="valcell${tone === 'old' ? ' vc-old' : ''}" role="button" tabindex="0"`
    + ` title="Click to see the full value">`
    + `<span class="vc-prev">${esc(short)}</span>`
    + (s.length > 90 ? `<span class="vc-more">${s.length} chars · click to open</span>` : '')
    + `<span class="vc-full" hidden>${esc(s)}</span>`
    + `<span class="vc-label" hidden>${esc(label || 'Value')}</span></span>`;
}

/** The whole value, in a dialog, with a Copy button. */
export async function showValue(title, text){
  const { copyText } = await import('./toast.js');
  const h = document.getElementById('modalHost');
  h.innerHTML = '';
  const wrap = el('div');
  wrap.innerHTML = `<div class="scrim"></div>
    <div class="modal wide">
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:10px">
        <h2 style="font-size:17px">${esc(title)}</h2>
        <span class="hint">${text.length} characters</span></div>
      <div class="fullval">${esc(text)}</div>
      <div style="display:flex;gap:9px;justify-content:flex-end;margin-top:16px">
        <button class="btn ghost" data-close>Close</button>
        <button class="btn primary" data-copy>Copy</button></div></div>`;
  h.appendChild(wrap);
  const close = () => { h.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.querySelector('.scrim').onclick = close;
  wrap.querySelector('[data-close]').onclick = close;
  wrap.querySelector('[data-copy]').onclick = () => copyText(text);
  wrap.querySelector('[data-copy]').focus();
}

// One delegated listener for every value cell on the page, present and future — the
// tables are built as innerHTML strings, so per-cell handlers would need re-binding on
// every repaint.
// CAPTURE phase (the trailing `true`), not bubble: a bubble listener on document runs
// AFTER the row it sits inside has already handled the click, so opening a value would
// also open the product drawer behind it. Capture runs before the row sees the event.
function openCell(cell){
  showValue(cell.querySelector('.vc-label').textContent,
            cell.querySelector('.vc-full').textContent);
}
document.addEventListener('click', ev => {
  const cell = ev.target.closest && ev.target.closest('.valcell');
  if (!cell) return;
  ev.stopPropagation();
  ev.preventDefault();
  openCell(cell);
}, true);
document.addEventListener('keydown', ev => {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  const cell = ev.target.closest && ev.target.closest('.valcell');
  if (!cell) return;
  ev.preventDefault(); ev.stopPropagation();
  openCell(cell);
}, true);


/* "2026-08" -> "August 2026". A month shown as 2026-08 is a database column wearing a
   costume. Lives here so the filter dropdown and the progress table cannot disagree. */
export const MONTH_NAMES = ['January','February','March','April','May','June','July',
                            'August','September','October','November','December'];
export function monthName(m){
  const [y, mm] = String(m || '').split('-');
  return MONTH_NAMES[Number(mm) - 1] ? `${MONTH_NAMES[Number(mm) - 1]} ${y}` : (m || '');
}

export const chips = arr => `<div class="chips">${arr.filter(x=>x!=null&&x!=='')
  .map(x=>`<span class="chip">${esc(x)}</span>`).join('')}</div>`;
export const list = arr => `<ul class="plain">${arr.filter(Boolean)
  .map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`;
export const sub = t => el('div','subhead', esc(t));
/* One titled block, the way the portal draws one: a white card, its heading top-left and
   room for an "Edit" button top-right (drawer.js fills that in for blocks that hold
   editable fields). Every section on every tab goes through here, so they all get the
   same shape rather than each tab inventing its own. */
export function section(title, node){
  if (!node) return null;
  const s = el('section','vsec');
  const h = el('div','vsec-top');
  h.appendChild(el('h4','vsec-h', esc(title || '')));
  s.appendChild(h);
  const b = el('div','vsec-b');
  b.appendChild(node);
  s.appendChild(b);
  return s;
}

/* The portal marks what is included with a ringed tick and what is not with a ringed
   cross, rather than running both down the same bulleted list. `kind` picks the mark. */
export function iconList(arr, kind){
  const ul = el('ul','iconlist ' + (kind || 'inc'));
  (arr || []).forEach(t => {
    const li = el('li');
    li.innerHTML = `<span class="ico-r" aria-hidden="true">${
      kind === 'exc' ? '&#10005;' : kind === 'info' ? 'i' : '&#10003;'}</span>`;
    li.appendChild(document.createTextNode(String(t)));
    ul.appendChild(li);
  });
  return ul;
}

/* ---------- badges ---------- */
/* Status, as a table rather than an if-chain — the same shape as QUALITY above, and for
   the same reason: an unrecognised value must render as itself, never fall into whatever
   the last branch happened to be. Each entry carries a dot colour so the state is
   readable at a glance without reading the word.
   Both the platform's own words (ACTIVE, INACTIVE…) and the canonical ones
   (LIVE, REMOVED…) map here, so a badge means the same thing wherever it is drawn. */
export const STATUS_LABEL = {
  ACTIVE:                    ['Live',              'b-active'],
  LIVE:                      ['Live',              'b-active'],
  DRAFT:                     ['Draft',             'b-draft'],
  PENDING:                   ['Pending review',    'b-pending'],
  UNDER_REVIEW:              ['Pending review',    'b-pending'],
  PENDING_FIRST_ACTIVATION:  ['Pending activation','b-pending'],
  REJECTED:                  ['Rejected',          'b-rejected'],
  INACTIVE:                  ['Removed',           'b-removed'],
  REMOVED:                   ['Removed',           'b-removed'],
  NOT_LISTED:                ['Not uploaded',      'b-draft'],
};
export function statusBadge(s){
  const k = (s || '').toUpperCase();
  if (!k) return '<span class="badge b-draft">Unknown</span>';
  const hit = STATUS_LABEL[k];
  const [label, cls] = hit || [sentence(k), 'b-draft'];
  return `<span class="badge ${cls}"><i class="dot"></i>${esc(label)}</span>`;
}
/* "Book on Connection" is Viator's own name for a product bookable through the API
   connection. The badge shows the state; the column header carries the full term. */
export const CONNECTION_LABEL = {
  'Connected':           ['Bookable',           'b-conn'],
  'Partially connected': ['Partly bookable',    'b-pending'],
  'Not connected':       ['Not bookable',       'b-noconn'],
};
export const connBadge = c => {
  if (!c) return '';
  const hit = CONNECTION_LABEL[c];
  const [label, cls] = hit || [c, 'b-draft'];
  return `<span class="badge ${cls}" title="Book on Connection: ${esc(c)}">`
       + `<i class="dot"></i>${esc(label)}</span>`;
};
/* Viator's own quality ratings. Anything NOT in this table is not a rating and must
   never be painted as a quality failure — the old version tested `q === 'GOOD'` and sent
   everything else to "Needs work", which mislabelled two things at once:
     * EXCELLENT (better than GOOD) was reported as "Needs work";
     * the Breakdown chart's own bucket label for un-rated drafts landed there too, so
       "Needs work" appeared three separate times on one chart.
   Unrecognised values now render as themselves, in neutral styling, which also means a
   new Viator rating shows up honestly instead of being called a failure. */
export const QUALITY = {
  EXCELLENT:    ['Excellent',    'b-good'],
  GOOD:         ['Good quality', 'b-good'],
  UNACCEPTABLE: ['Needs work',   'b-bad'],
};
export const qualBadge = q => {
  if (!q) return '';
  const hit = QUALITY[String(q).toUpperCase()];
  return hit ? `<span class="badge ${hit[1]}">${hit[0]}</span>`
             : `<span class="badge b-draft">${esc(q)}</span>`;
};

/* Timestamps are stored as ISO strings that ALREADY carry an offset ("…T03:59:03+00:00").
   Appending "Z" to those makes "+00:00Z", which Date rejects — every "last capture" cell
   read "NaN days ago". Only bare SQLite-style stamps need the timezone added. */
export function parseTs(t){
  if (!t) return null;
  let s = String(t).trim().replace(' ', 'T');
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) s += 'Z';
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
export function daysSince(t){
  const d = parseTs(t);
  return d ? (Date.now() - d.getTime()) / 864e5 : null;
}
