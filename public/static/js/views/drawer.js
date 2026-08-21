import { S } from '../state.js';
import { $, cachedApi, el, esc, session } from '../core.js';
import { getPath, historyFor, label, personName, qualBadge, setEditContext,
         statusBadge, valueBox, whenLong } from '../format.js';
import { skLines } from '../ui.js';
import { buildSections, commissionOf, totalDuration, tree } from '../sections.js';
import { editSection, editValue } from '../edit.js';
import { secs } from '../progress.js';

/* ======================= drawer ======================= */
export async function openDrawer(pid){
  const host = $('#drawerHost');
  host.innerHTML = '<div class="scrim"></div><div class="drawer"><div class="dbody">'+
    `<div class="loading-note"><div class="sp"></div>Loading this product`+
    `${S.source ? ' from ' + esc(S.source) : ''}…</div>` +
    `<div class="card pad">${skLines(8)}</div>` +
    '</div></div>';
  host.querySelector('.scrim').onclick = closeDrawer;
  const d = await cachedApi('/api/product/'+pid);
  const p = d.product, cur = d.current;
  host.innerHTML='';
  const scrim = el('div','scrim'); scrim.onclick = closeDrawer; host.appendChild(scrim);
  const dr = el('div','drawer');

  // Laid out the way the portal's own product page opens: the title, then the status and
  // the product code on one quiet line beneath it. The thumbnail that used to sit here is
  // gone — Viator shows the photos in the Photos strip, and so do we, right below.
  const head = el('div','dhead');
  head.innerHTML = `<button class="vback" id="xClose">&lsaquo; Back to product list</button>
    <div class="dhead-top">
      <div style="flex:1;min-width:0">
        <h2 class="vtitle">${esc(p.title||'(untitled)')}</h2>
        <div class="vsubline">
          ${p.is_draft_stub?'<span class="badge b-stub">Draft — recorded only</span>':''}
          ${statusBadge(p.status)}
          <span class="hint">Product code: <span class="mono">${esc(p.product_code)}</span></span>
          <span class="hint">${esc(p.account_name||p.viator_account_id)}${
            p.location?' · '+esc(p.location):''}</span>
        </div>
      </div>
    </div>`;
  dr.appendChild(head);
  const body = el('div','dbody');

  if (p.missing_since){
    body.appendChild(el('div','banner',
      `<b>No longer listed on Viator.</b> This product stopped appearing in the account's `+
      `roster on ${esc(when(p.missing_since))}. Everything captured before then is kept `+
      `below, unchanged.`));
  }
  if (p.is_draft_stub){
    body.appendChild(el('div','banner',
      'This is a <b>draft</b>. By design only its name, code, location and connection '+
      'state are recorded — no tab data is fetched for drafts.'));
  }

  /* headline facts */
  if (cur && cur.product){
    const pp = cur.product, it = pp.itinerary||{};
    const rr = cur.review_rating||{};
    const tiles = el('div','tiles');
    [['Commission', (()=>{ const c = commissionOf(pp);
        return c!=null ? c+'%' : '—'; })(), (pp.pricing||{}).productProgramMargin
        && (pp.pricing||{}).productProgramMargin.isOptedIn ? 'incl. boost' : ''],
     ['Duration', totalDuration(it)||'—',''],
     ['Currency', pp.currency||'—',''],
     ['Reviews', rr.totalReviewCount||0, rr.totalReviewCount?`rated ${rr.rating}`:'none yet'],
     ['Changes', d.changes.length, 'since first capture']]
     .forEach(([l,n,s])=>tiles.appendChild(el('div','tile',
       `<div class="l">${l}</div><div class="n">${esc(n)}</div><div class="s">${esc(s)}</div>`)));
    body.appendChild(tiles);
  }

  /* The Photos card — the gallery, the captions and the upload box — was removed with
     photo storage itself. What a photo change did to the listing is still recorded: it
     appears in Change history below as one line per edit. */

  /* readable sections — every field row carries its own pen, wired through this
     context so sections.js stays pure rendering */
  if (cur && cur.product){
    EDITSNAP = {snapshot: cur, edits: d.edits || {}};
    setEditContext({
      pid: p.id,
      edits: d.edits || {},
      snapshot: cur,
      onSaved: () => openDrawer(p.id),
      edit: (spec) => editValue(p.id, spec, () => openDrawer(p.id)),
    });
    const secs = buildSections(cur);
    const c = el('div','card');
    // No card header: the portal puts the tab strip straight under the title, and a
    // "Product details" banner above tabs named after the portal's own tabs is a label
    // for something the tabs already say.
    const b = el('div','pad vpage');
    const strip = el('div','tabstrip'), panes = el('div');
    secs.forEach(([name,node],i)=>{
      const btn = el('button','tabbtn'+(i===0?' on':''),esc(name));
      const pane = el('div',i===0?'':'hidden');
      pane.style.marginTop='16px';
      pane.appendChild(node);
      addBlockEditButtons(pane, p.id);
      btn.onclick = ()=>{
        [...strip.children].forEach(x=>x.classList.remove('on'));
        [...panes.children].forEach(x=>x.classList.add('hidden'));
        btn.classList.add('on'); pane.classList.remove('hidden');
      };
      strip.appendChild(btn); panes.appendChild(pane);
    });
    b.appendChild(strip); b.appendChild(panes);
    c.appendChild(b); body.appendChild(c);
    setEditContext(null);   // never let another view inherit this product's context
  } else if (cur){
    const c = el('div','card');
    c.appendChild(el('div','card-h','<h3>Recorded fields</h3>'));
    const b = el('div','pad'); b.appendChild(tree(cur.stub||cur)); c.appendChild(b);
    body.appendChild(c);
  }

  /* Edit history — everything that ever happened to this product, in one list.
     Viator's own changes and this dashboard's corrections used to sit in two separate
     tables (and one of them on a different tab entirely), which meant nobody could see
     the order things happened in. */
  body.appendChild(editHistoryCard(d));

  /* The "Earlier captures" snapshot browser lived here. It listed run ids and raw
     JSON dumps — a debugging tool on a page people open to read a product. What
     changed, and when, is the Change history below; the raw data is still one click
     away under the developer section. */
  /* The raw-JSON toggle was removed from the product page: it is a debugging view on a
     screen people open to read a listing. The data is still served by /api/snapshot/<id>
     for anyone who needs it. */

  dr.appendChild(body); host.appendChild(dr);
  head.querySelector('#xClose').onclick = closeDrawer;
}
/* One box per FIELD, not per change.

   A field edited four times used to be four full-height cards, which pushed everything
   else off the page and buried the thing people actually want: what it says now. Each
   field gets a single box showing its LATEST change; clicking it opens the earlier ones,
   one at a time, with arrows — the shape of a spreadsheet's edit history.

   Every entry is still kept. Nothing is dropped, only folded. */
function editHistoryCard(d){
  const items = historyFor(d);
  const c = el('div','card');
  const b = el('div','pad');

  // group by what changed. Photos arrive as dozens of rows per edit (one per field per
  // photo), so they fold into a single "Photos" group rather than dozens of boxes.
  const groups = new Map();
  items.forEach(it => {
    const photo = /^product\.(media|heroPhoto)/.test(it.path || '');
    const key = photo ? 'Photos' : it.path;
    const label = photo ? 'Photos' : fieldLabel(it.path);
    if (!groups.has(key)) groups.set(key, {label, list: []});
    groups.get(key).list.push(it);
  });
  // newest first, by each field's most recent change
  const ordered = [...groups.values()].sort((a, b2) =>
    String(b2.list[0].at || '').localeCompare(String(a.list[0].at || '')));

  c.appendChild(el('div','card-h', '<h3>Edit history</h3>'
    + `<span class="sub">${ordered.length} field${ordered.length===1?'':'s'} changed · `
    + `${items.length} change${items.length===1?'':'s'} in total</span>`));

  if (!ordered.length){
    b.appendChild(el('div','empty','<div class="big">Nothing has changed yet</div>'
      + 'The first capture is the starting point. From the next check onwards, anything '
      + 'Viator changes — and anything anyone corrects here — is listed on this page.'));
    c.appendChild(b); return c;
  }
  b.appendChild(el('div','hint','One box per field, showing its most recent change. '
    + 'Click a box to step back through that field’s earlier changes.'));

  const feed = el('div','ehist');
  ordered.forEach(g => {
    const it = g.list[0];                       // the latest change to this field
    const name = personName(it.who, session.people);
    const row = el('div','eh');
    row.setAttribute('role','button'); row.tabIndex = 0;
    row.innerHTML = `
      <div class="eh-av" title="${esc(it.who)}">${esc((name[0]||'?').toUpperCase())}</div>
      <div style="min-width:0">
        <div class="eh-what">${esc(g.label)}</div>
        <div class="eh-rep">
          <div class="eh-side"><span class="eh-lbl">Before</span>
            ${valueBox(it.old,'old','Value before')}</div>
          <div class="eh-arrow" aria-hidden="true">→</div>
          <div class="eh-side after"><span class="eh-lbl">After</span>
            ${valueBox(it.now,null,'Value after')}</div>
        </div>
        <div class="eh-foot"><b>${esc(name)}</b>
          <span class="eh-when">${esc(whenLong(it.at))}</span>
          ${it.byUs ? '<span class="badge b-stub">edited here</span>'
                    : '<span class="badge b-draft">changed on Viator</span>'}
          ${g.list.length > 1
            ? `<span class="eh-more">${g.list.length} changes · click to see them</span>`
            : ''}</div>
      </div>`;
    const open = () => fieldHistory(g, 0);
    row.onclick = open;
    row.onkeydown = e => { if (e.key==='Enter'||e.key===' '){ e.preventDefault(); open(); } };
    feed.appendChild(row);
  });
  b.appendChild(feed);
  c.appendChild(b);
  return c;
}

/* One field's changes, one at a time, with arrows — the spreadsheet edit-history card the
   client asked for. `i` is the index into the group's list, which is newest first, so
   "back" walks towards the original value. */
function fieldHistory(g, i){
  const host = $('#modalHost');
  const it = g.list[i];
  const name = personName(it.who, session.people);
  const wrap = el('div');
  wrap.innerHTML = `<div class="scrim"></div>
    <div class="modal card fh">
      <div class="fh-top">
        <h2>Edit history</h2>
        <span class="fh-nav">
          <button class="fh-arrow" id="fhPrev" title="Newer change"
            ${i === 0 ? 'disabled' : ''}>&lsaquo;</button>
          <button class="fh-arrow" id="fhNext" title="Older change"
            ${i >= g.list.length - 1 ? 'disabled' : ''}>&rsaquo;</button>
        </span>
      </div>
      <div class="fh-who">
        <div class="eh-av">${esc((name[0]||'?').toUpperCase())}</div>
        <div><b>${esc(name)}</b>
          <div class="eh-when">${esc(whenLong(it.at))}</div></div>
        ${it.byUs ? '<span class="badge b-stub">edited here</span>'
                  : '<span class="badge b-draft">changed on Viator</span>'}
      </div>
      <div class="fh-field">${esc(g.label)}</div>
      <div class="eh-rep">
        <div class="eh-side"><span class="eh-lbl">Before</span>
          ${valueBox(it.old,'old','Value before')}</div>
        <div class="eh-arrow" aria-hidden="true">→</div>
        <div class="eh-side after"><span class="eh-lbl">After</span>
          ${valueBox(it.now,null,'Value after')}</div>
      </div>
      ${it.note ? `<div class="hint" style="margin-top:12px">Reason: ${esc(it.note)}</div>` : ''}
      ${it.byUs ? '' : `<div class="hint" style="margin-top:12px">Spotted by
         ${esc(name)}’s sync — Viator does not say which of its own users made the
         change.</div>`}
      <div class="fh-foot">
        <span class="hint">${i + 1} of ${g.list.length}${
          i === g.list.length - 1 ? ' · the first one recorded' : ''}</span>
        <button class="btn ghost" id="fhClose">Close</button>
      </div>
    </div>`;
  host.innerHTML = '';
  host.appendChild(wrap);
  const close = () => { host.innerHTML = ''; };
  wrap.querySelector('.scrim').onclick = close;
  $('#fhClose').onclick = close;
  const prev = $('#fhPrev'), next = $('#fhNext');
  if (!prev.disabled) prev.onclick = () => fieldHistory(g, i - 1);
  if (!next.disabled) next.onclick = () => fieldHistory(g, i + 1);
  // arrow keys, because a card with ‹ › on it invites them
  wrap.tabIndex = -1; wrap.focus();
  wrap.onkeydown = e => {
    if (e.key === 'ArrowLeft'  && i > 0) fieldHistory(g, i - 1);
    if (e.key === 'ArrowRight' && i < g.list.length - 1) fieldHistory(g, i + 1);
  };
}

/* The portal puts one "Edit" button at the top-right of each block, not a pencil beside
   each field. The pencils are still what knows which fields can be edited and what they
   currently hold, so this reads them out of the block, hangs a single Edit button on its
   heading, and hides them (CSS, .drawer .penbtn). Nothing about the edit itself changes:
   same paths, same override layer, same email prompt. */
function addBlockEditButtons(pane, pid){
  pane.querySelectorAll('.vsec').forEach(sec => {
    const pens = [...sec.querySelectorAll('.penbtn[data-path]')];
    if (!pens.length) return;
    const top = sec.querySelector('.vsec-top');
    if (!top || top.querySelector('.vedit')) return;
    const b = el('button','btn sm vedit','Edit');
    b.title = `Edit ${pens.length} field${pens.length===1?'':'s'} in this section`;
    b.onclick = () => {
      // read the values at click time, so an edit made a moment ago is reflected
      const items = pens.map(pen => ({
        path: pen.dataset.path,
        label: (pen.getAttribute('aria-label')||'').replace(/^Edit /,''),
        value: getPath(EDITSNAP.snapshot, pen.dataset.path),
      }));
      const edits = EDITSNAP.edits || {};
      items.forEach(it => { if (edits[it.path]) it.value = edits[it.path].value; });
      editSection(pid, top.querySelector('.vsec-h').textContent, items,
                  () => openDrawer(pid));
    };
    top.appendChild(b);
  });
}
/* The rendering context is cleared as soon as the sections are built (so no other view
   inherits it), but the Edit buttons are clicked long after. Keep what they need. */
let EDITSNAP = {snapshot: null, edits: {}};

export const trunc = s => { s = (s===null||s===undefined)?'(none)':String(s);
  try{ const p=JSON.parse(s); if(p&&typeof p==='object')
    s = Array.isArray(p)?`${p.length} item(s)`:Object.keys(p).slice(0,3).join(', ');
  }catch(e){}
  return s.length>72 ? s.slice(0,72)+'…' : s; };
export const when = t => String(t||'').replace('T',' ').replace('+00:00','').slice(0,16);
/* "product.voucher.ticketType" -> "Tickets › Ticket format" */
/* Section names match the portal's tabs, so a field path resolves to the place someone
   would go looking for it in Viator itself. */
export const PATH_SEC = {pricing:'Schedules & prices', ageBands:'Schedules & prices',
  productOptions:'Schedules & prices', currency:'Schedules & prices',
  bookingSettings:'Booking details', bookingConfirmationSettings:'Booking details',
  cancellationPolicy:'Booking details', travellerRequiredInfo:'Booking details',
  voucher:'Tickets', connectionDetails:'Product connection',
  externalReference:'Product connection',
  specialOfferInfo:'Special offers', media:'Photos', heroPhoto:'Photos',
  itinerary:'Product content', inclusions:'Product content',
  exclusions:'Product content', taxonomy:'Product content',
  additionalInfo:'Product content'};
export function fieldLabel(path){
  // "[=VALUE]" is an identity key from a set-like list — show the value, not "=VALUE"
  const parts = String(path||'').replace(/^product\./,'').split(/[.\[]/)
    .map(s=>s.replace(/\]$/,'').replace(/^=/,'')).filter(Boolean);
  if (!parts.length) return path;
  const sec = PATH_SEC[parts[0]];
  const rest = parts.map(p=>/^[A-Z0-9_-]{6,}$/.test(p)?p:label(p));
  return (sec ? sec+' › ' : '') + rest.join(' › ');
}
export function closeDrawer(){ $('#drawerHost').innerHTML=''; }
// Escape closes ONE layer: the modal if one is open, otherwise the drawer. Closing both
// meant dismissing a dialog also threw away the product you were working on.
document.addEventListener('keydown', e=>{
  if (e.key !== 'Escape') return;
  const modal = $('#modalHost');
  if (modal && modal.innerHTML.trim()){ modal.innerHTML = ''; return; }
  closeDrawer();
});

