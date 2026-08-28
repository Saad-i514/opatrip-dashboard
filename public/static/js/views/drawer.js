import { S } from '../state.js';
import { spinMark, $, cachedApi, el, esc, session } from '../core.js';
import { getPath, historyFor, label, PATH_LABELS, personName, qualBadge, setEditContext,
         statusBadge, valueBox, whenLong } from '../format.js';
import { skLines } from '../ui.js';
import { buildSections, commissionOf, totalDuration, tree } from '../sections.js';
import { editSection, editValue } from '../edit.js';
import { secs } from '../progress.js';
import { toast } from '../toast.js';

/* ======================= drawer ======================= */
export async function openDrawer(pid){
  PATH_LABELS.clear();   // this product's page is about to (re)write its own labels
  const host = $('#drawerHost');
  host.innerHTML = '<div class="scrim"></div><div class="drawer"><div class="dbody">'+
    `<div class="loading-note">${spinMark}Loading this product`+
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
        <div style="display:flex;align-items:center;gap:8px">
          <h2 class="vtitle" style="margin:0">${esc(p.title||'(untitled)')}</h2>
          <button class="penbtn" id="btnEditTitle" title="Edit Title" aria-label="Edit Title" style="display:inline-flex;opacity:0.8;font-size:16px;cursor:pointer">&#9998;</button>
        </div>
        <div class="vsubline" style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:6px">
          ${p.is_draft_stub?'<span class="badge b-stub">Draft — recorded only</span>':''}
          <span style="display:inline-flex;align-items:center;gap:4px">
            ${statusBadge(p.status)}
            <button class="penbtn" id="btnEditStatus" title="Edit Status" aria-label="Edit Status" style="display:inline-flex;opacity:0.8;font-size:13px;cursor:pointer">&#9998;</button>
          </span>
          <span class="hint">Product code: <span class="mono">${esc(p.product_code)}</span></span>
          <span class="hint">${esc(p.account_name||p.viator_account_id)}${
            p.location?' · '+esc(p.location):''}</span>
        </div>
      </div>
    </div>`;
  dr.appendChild(head);

  const editTitleBtn = head.querySelector('#btnEditTitle');
  if (editTitleBtn) {
    editTitleBtn.onclick = () => editValue(p.id, {
      path: 'product.title', label: 'Product Title', value: (cur && cur.product ? cur.product.title : p.title)
    }, () => openDrawer(p.id));
  }
  const editStatusBtn = head.querySelector('#btnEditStatus');
  if (editStatusBtn) {
    editStatusBtn.onclick = () => editValue(p.id, {
      path: 'product.status', label: 'Status', value: (cur && cur.product ? cur.product.status : p.status)
    }, () => openDrawer(p.id));
  }

  const body = el('div','dbody');
  let jumpToField = null;

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
    const durVal = pp.duration || totalDuration(it) || '—';
    const commVal = (()=>{ const c = commissionOf(pp);
        return c!=null ? c+'%' : '—'; })();
    const qualVal = (pp.quality||{}).level || p.quality_level || cur.quality_level || '—';
    const revCnt = (rr.totalReviewCount!=null ? rr.totalReviewCount : p.review_count) || 0;
    const revScore = rr.rating || p.review_rating;

    const tiles = el('div','tiles');
    [['Commission', commVal, (pp.pricing||{}).productProgramMargin && (pp.pricing||{}).productProgramMargin.isOptedIn ? 'incl. boost' : 'click to edit', 'product.pricing.productProgramMargin.baseMargin', 'Commission'],
     ['Duration', durVal, 'click to edit', 'product.itinerary.durationInMinutes', 'Duration'],
     ['Quality', qualVal, 'click to edit', 'product.quality.level', 'Quality Level'],
     ['Reviews', revCnt, revCnt ? `rated ${revScore}` : 'click to edit', 'review_rating.rating', 'Reviews'],
     ['Currency', pp.currency||'—', 'click to edit', 'product.currency', 'Currency'],
     ['Changes', d.changes.length, 'since first capture', '', '']]
     .forEach(([l,n,s,path,lbl])=>{
       if (path) PATH_LABELS.set(path, l);
       const tile = el('div','tile',
         `<div class="l">${l}</div><div class="n">${esc(n)}</div><div class="s">${esc(s)}</div>`);
       if (path){
         tile.dataset.jumpPath = path;
         tile.style.cursor = 'pointer';
         tile.title = `Click to edit ${lbl || l}`;
         tile.onclick = () => editValue(p.id, {
           path, label: lbl || l, value: (path === 'product.itinerary.durationInMinutes' ? (pp.duration || pp.itinerary?.durationInMinutes) : getPath(cur, path))
         }, () => openDrawer(p.id));
       }
       tiles.appendChild(tile);
     });
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
    // CSS.escape guards a path that happens to contain a quote or bracket-like character
    // reaching the attribute selector as anything other than a literal string to match.
    jumpToField = (path) => {
      // The whole body, not just the tab panes — the headline tiles (Commission, …) sit
      // above the tabs entirely, and a jump target there has no pane to switch to.
      // ~= matches one whole word in a space-separated list, so this also finds a row
      // that carries several paths at once (two fields merged into one sentence).
      const target = body.querySelector(`[data-jump-path~="${CSS.escape(path)}"]`);
      if (!target) return false;
      const i = [...panes.children].findIndex(pane => pane.contains(target));
      if (i >= 0) strip.children[i].click();
      requestAnimationFrame(() => {
        target.scrollIntoView({behavior: 'smooth', block: 'center'});
        target.classList.remove('jump-flash'); void target.offsetWidth;  // restart the animation on a repeat click
        target.classList.add('jump-flash');
      });
      return true;
    };
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
  body.appendChild(editHistoryCard(d, jumpToField));

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
/* One entity's box: an option, a photo bucket, or a single standalone field. Used both
   at the top of the feed and nested inside an expanded section — the SAME box either
   way, so a thing looks and behaves identically whether or not it happened to share its
   section with something else this time. */
function renderEntityRow(g, jumpToField){
  const it = g.list[0];                       // the latest change to this thing
  const name = personName(it.who, session.people);
  const row = el('div','eh');
  row.setAttribute('role','button'); row.tabIndex = 0;
  row.innerHTML = `
    <div class="eh-av" title="${esc(it.who)}">${esc((name[0]||'?').toUpperCase())}</div>
    <div style="min-width:0">
      <div class="eh-what">${esc(g.label)}${g.multi
        ? ` <span class="eh-sub">› ${esc(fieldLabel(it.suffix || it.path))}</span>` : ''}</div>
      <div class="eh-rep">
        <div class="eh-side"><span class="eh-lbl">Before</span>
          ${valueBox(it.old,'old','Value before')}</div>
        <div class="eh-arrow" aria-hidden="true">→</div>
        <div class="eh-side after"><span class="eh-lbl">After</span>
          ${afterBox(it)}</div>
      </div>
      <div class="eh-foot"><b>${esc(name)}</b>
        <span class="eh-when">${esc(whenLong(it.at))}</span>
        ${it.byUs ? '<span class="badge b-stub">edited here</span>'
                  : '<span class="badge b-draft">changed on Viator</span>'}
        ${g.list.length > 1
          ? `<span class="eh-more">${g.list.length} change${g.list.length===1?'':'s'}${
              g.multi ? ` across ${g.paths.size} fields` : ''} · click to see them</span>`
          : ''}
        ${g.jumpable && jumpToField ? '<button class="jumpbtn" type="button">Go to field</button>' : ''}
      </div>
    </div>`;
  const open = () => fieldHistory(g, 0);
  row.onclick = open;
  row.onkeydown = e => { if (e.key==='Enter'||e.key===' '){ e.preventDefault(); open(); } };
  const jumpBtn = row.querySelector('.jumpbtn');
  if (jumpBtn){
    jumpBtn.onclick = e => {
      e.stopPropagation();     // don't also open the field-history modal underneath it
      if (!jumpToField(g.jumpPath))
        toast('Not on the product page', {kind: 'info',
          detail: 'Either Viator removed it since this change, or it is not shown as '
            + 'its own field — open the box above to see its history instead.'});
    };
  }
  return row;
}
function editHistoryCard(d, jumpToField){
  const items = historyFor(d);
  const c = el('div','card');
  const b = el('div','pad');

  // Group by ENTITY, not by exact field: an option, an itinerary stop, a photo is one
  // card on Viator's own screens and on this dashboard's product page, never field by
  // field, so a change to three of an option's fields at once is one box here too, not
  // three. Photos are a special case of the same idea — every photo folds into one
  // "Photos" bucket, since the gallery itself was removed from the product page (see the
  // note above `openDrawer`), so there is no per-photo section to jump to anyway.
  const groups = new Map();
  items.forEach(it => {
    const photo = /^product\.(media|heroPhoto)/.test(it.path || '');
    const ent = entityKey(it.path);
    it.suffix = ent.suffix;                 // which field within the box, for the modal
    const key = photo ? 'Photos' : ent.key;
    const label = photo ? 'Photos' : fieldLabel(ent.key);
    if (!groups.has(key))
      groups.set(key, {label, list: [], jumpPath: photo ? null : ent.key, paths: new Set()});
    const g = groups.get(key);
    g.list.push(it);
    g.paths.add(it.path);
  });
  for (const g of groups.values()){
    g.multi = g.paths.size > 1;      // more than one distinct field folded into this box
    g.jumpable = !!g.jumpPath;
    // Chronological order first and always — that IS the traceability: if the SAME field
    // changed twice, "step back" has to land on ITS earlier value, not some other field's.
    // Only when two changes landed at the exact same instant (an option's title, status
    // and grade code all written by one sync at once) does it fall back to a tie-break,
    // and even then only to choose what the COLLAPSED row leads with — a name says more
    // than a status flag when both happened together.
    if (g.multi) g.list.sort((a,b)=>
      String(b.at||'').localeCompare(String(a.at||''))
      || (/\.(title|name)$/.test(a.path)?0:1) - (/\.(title|name)$/.test(b.path)?0:1));
  }
  // newest first, by each thing's most recent change
  const entityGroups = [...groups.values()].sort((a, b2) =>
    String(b2.list[0].at || '').localeCompare(String(a.list[0].at || '')));

  c.appendChild(el('div','card-h', '<h3>Edit history</h3>'
    + `<span class="sub">${entityGroups.length} thing${entityGroups.length===1?'':'s'} changed · `
    + `${items.length} change${items.length===1?'':'s'} in total</span>`));

  if (!entityGroups.length){
    b.appendChild(el('div','empty','<div class="big">Nothing has changed yet</div>'
      + 'The first capture is the starting point. From the next check onwards, anything '
      + 'Viator changes — and anything anyone corrects here — is listed on this page.'));
    c.appendChild(b); return c;
  }
  b.appendChild(el('div','hint','One box per thing that changed — an option, a photo, a '
    + 'single field on its own. Click a box to step back through its earlier changes.'));

  // Bucket entities by the same section the product page itself groups them under
  // (Schedules & prices, Special offers, …), so a day with five options edited reads as
  // one "Schedules & prices" box, not five separate ones — expand it to see which. A
  // path with no section (the product's own title, say) has nothing to bucket it WITH,
  // so it stays its own box exactly as before; so does the Photos bucket, which is
  // already the same idea at product-wide scope.
  const feed = el('div','ehist');
  const bySection = new Map();
  const standalone = [];
  entityGroups.forEach(g => {
    const sec = g.jumpPath ? pathSection(g.jumpPath) : null;
    if (sec){ if (!bySection.has(sec)) bySection.set(sec, []); bySection.get(sec).push(g); }
    else standalone.push(g);
  });
  const sections = [...bySection.entries()].map(([name, list]) => ({
    name, list,
    at: list.reduce((m,g)=>String(g.list[0].at||'') > m ? String(g.list[0].at||'') : m, ''),
  }));
  // Sections interleave with standalone boxes by their own most recent change, same as
  // every box always has — grouping by section does not mean "always last."
  const top = [...sections.map(s=>({kind:'section', s})), ...standalone.map(g=>({kind:'entity', g}))]
    .sort((a,b) => {
      const at = x => x.kind==='section' ? x.s.at : String(x.g.list[0].at||'');
      return at(b).localeCompare(at(a));
    });

  top.forEach(item => {
    if (item.kind === 'entity'){ feed.appendChild(renderEntityRow(item.g, jumpToField)); return; }
    const { s } = item;
    const things = s.list.length;
    const changes = s.list.reduce((n,g)=>n+g.list.length, 0);
    const row = el('div','eh eh-section');
    row.setAttribute('role','button'); row.tabIndex = 0; row.setAttribute('aria-expanded','false');
    row.innerHTML = `
      <div class="eh-av eh-av-sec">${esc(s.name[0]||'?')}</div>
      <div style="min-width:0">
        <div class="eh-what">${esc(s.name)}</div>
        <div class="hint" style="margin:2px 0 6px">
          ${s.list.map(g=>esc(g.label.split(' › ').pop())).join(', ')}</div>
        <div class="eh-foot">
          <span class="eh-more">${changes} change${changes===1?'':'s'} across ${things} thing${things===1?'':'s'}</span>
          <button class="jumpbtn" type="button">Expand</button>
        </div>
      </div>`;
    const inner = el('div','eh-nested hidden');
    s.list.forEach(g => inner.appendChild(renderEntityRow(g, jumpToField)));
    const toggle = () => {
      const open = inner.classList.toggle('hidden');
      row.setAttribute('aria-expanded', String(!open));
      row.querySelector('.jumpbtn').textContent = open ? 'Expand' : 'Collapse';
    };
    row.onclick = toggle;
    row.onkeydown = e => { if (e.key==='Enter'||e.key===' '){ e.preventDefault(); toggle(); } };
    feed.appendChild(row);
    feed.appendChild(inner);
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
          <button class="fh-arrow" id="fhBack" title="The change before this one"
            ${i >= g.list.length - 1 ? 'disabled' : ''}>&lsaquo;</button>
          <button class="fh-arrow" id="fhFwd" title="The change after this one"
            ${i === 0 ? 'disabled' : ''}>&rsaquo;</button>
        </span>
      </div>
      <div class="fh-who">
        <div class="eh-av">${esc((name[0]||'?').toUpperCase())}</div>
        <div><b>${esc(name)}</b>
          <div class="eh-when">${esc(whenLong(it.at))}</div></div>
        ${it.byUs ? '<span class="badge b-stub">edited here</span>'
                  : '<span class="badge b-draft">changed on Viator</span>'}
      </div>
      <div class="fh-field">${esc(g.label)}${g.multi ? ' › ' + esc(fieldLabel(it.suffix || it.path)) : ''}</div>
      <div class="eh-rep">
        <div class="eh-side"><span class="eh-lbl">Before</span>
          ${valueBox(it.old,'old','Value before')}</div>
        <div class="eh-arrow" aria-hidden="true">→</div>
        <div class="eh-side after"><span class="eh-lbl">After</span>
          ${afterBox(it)}</div>
      </div>
      ${it.note ? `<div class="hint" style="margin-top:12px">Reason: ${esc(it.note)}</div>` : ''}
      ${it.byUs ? '' : `<div class="hint" style="margin-top:12px">Spotted by
         ${esc(name)}’s sync — Viator does not say which of its own users made the
         change.</div>`}
      <div class="fh-foot">
        <span class="hint">${i === 0 ? 'Latest change' : `${i + 1} of ${g.list.length}`}${
          i === g.list.length - 1 && g.list.length > 1 ? ' · the first one recorded'
          : (i === 0 && g.list.length > 1 ? ` · ${g.list.length - 1} earlier` : '')}</span>
        <button class="btn ghost" id="fhClose">Close</button>
      </div>
    </div>`;
  host.innerHTML = '';
  host.appendChild(wrap);
  const close = () => { host.innerHTML = ''; };
  wrap.querySelector('.scrim').onclick = close;
  $('#fhClose').onclick = close;
  // The list runs newest first, so index 0 is the latest change and a HIGHER index is
  // further back in time. Left therefore steps to the PREVIOUS change and right returns
  // towards the latest — the way a person reads a timeline, and the way the arrows point.
  const back = $('#fhBack'), fwd = $('#fhFwd');
  if (!back.disabled) back.onclick = () => fieldHistory(g, i + 1);
  if (!fwd.disabled)  fwd.onclick  = () => fieldHistory(g, i - 1);
  wrap.tabIndex = -1; wrap.focus();
  wrap.onkeydown = e => {
    if (e.key === 'ArrowLeft'  && i < g.list.length - 1) fieldHistory(g, i + 1);
    if (e.key === 'ArrowRight' && i > 0) fieldHistory(g, i - 1);
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
  product_options:'Schedules & prices', currency:'Schedules & prices',
  bookingSettings:'Booking details', bookingConfirmationSettings:'Booking details',
  cancellationPolicy:'Booking details', travellerRequiredInfo:'Booking details',
  voucher:'Tickets', connectionDetails:'Product connection',
  externalReference:'Product connection',
  specialOfferInfo:'Special offers', media:'Photos', heroPhoto:'Photos',
  itinerary:'Product content', inclusions:'Product content',
  exclusions:'Product content', taxonomy:'Product content',
  additionalInfo:'Product content'};
// A path segment that is a raw system id carries no meaning to someone reading this on
// the dashboard — it means nothing on Viator's own screens either. It is dropped from the
// breadcrumb entirely rather than shown dash-by-dash as loose words. Two different id
// shapes, both real: a generated UUID (OPT-<uuid>, LOC-POINT-<uuid>, IMG-<uuid>), and
// Viator's OWN compound reference — a short type prefix followed by a long schedule
// descriptor that is not a UUID at all (PPP-AIS-2099-12-31_MTWHFSU_TG3_2026-06-29_1000_D
// for a pricing package, SEA-AIS-INF_2026-06-29_TG1_D for a season) — just as unreadable.
// REF_SEGMENT requires BOTH a real prefix and a long tail so it cannot catch a short,
// genuinely readable code like "TG3" or a two-letter locale.
const ID_SEGMENT = /^([A-Za-z][A-Za-z-]*-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF_SEGMENT = /^[A-Z]{2,6}-[A-Za-z0-9_-]{6,}$/;
const isIdSegment = p => ID_SEGMENT.test(p) || REF_SEGMENT.test(p);
function pathSection(path){
  const first = String(path||'').replace(/^product\./,'').split(/[.\[]/)[0];
  return PATH_SEC[first];
}
function idDescriptor(p){
  const dates = String(p||'').match(/(\d{4}-\d{2}-\d{2})/g) || [];
  if (dates.length >= 2){
    const endD = dates[0], startD = dates[1];
    return endD === '2099-12-31' ? 'Default season' : `${startD} – ${endD}`;
  }
  return null;
}
export function fieldLabel(path){
  // The product page already wrote a plain-English label for this EXACT path while
  // rendering (rows()/section() register it as they go — see PATH_LABELS above). Use
  // that verbatim rather than rebuilding one from the path's own field names: it is what
  // someone reading this dashboard already recognises, because it is the same text they
  // would see on the page itself, not a guess at what the path might mean.
  const known = PATH_LABELS.get(path);
  if (known != null){
    const sec = pathSection(path);
    return sec ? sec+' › '+known : known;
  }
  // No page renders this path individually (a field folded into a group, or one this
  // dashboard does not show at all) — fall back to reading the path itself.
  // "[=VALUE]" is an identity key from a set-like list — show the value, not "=VALUE"
  const rawParts = String(path||'').replace(/^product\./,'').split(/[.\[]/)
    .map(s=>s.replace(/\]$/,'').replace(/^=/,'')).filter(Boolean);
  const idDesc = rawParts.map(idDescriptor).find(Boolean);
  const parts = rawParts.filter(p=>!isIdSegment(p));
  if (!parts.length) return path;
  const sec = pathSection(path);
  const rest = parts.map(p=>/^[A-Z0-9_-]{6,}$/.test(p)?p:label(p));
  if (idDesc && (rawParts.includes('seasons') || rawParts.includes('pricingPackages'))) {
    rest.push(`(${idDesc})`);
  }
  // The identity key of a set-like list often just restates the field name right before
  // it (e.g. an "ageBand" field whose own list key is "AGE_BAND") — drop the repeat.
  const dedup = rest.filter((p,i)=>
    i===0 || p.toUpperCase().replace(/[^A-Z0-9]/g,'') !==
             rest[i-1].toUpperCase().replace(/[^A-Z0-9]/g,''));
  return (sec ? sec+' › ' : '') + dedup.join(' › ');
}
/* Splits a path at its OUTERMOST id-shaped segment: everything up to and including that
   id is the ENTITY (an option, an itinerary stop — one thing Viator shows as a single
   card, never field by field), everything after is which field of it changed. A path
   with no id segment (product.title, product.briefDescription — fields Viator shows on
   their own) is its own entity, unchanged from before this existed. */
export function entityKey(path){
  const raw = String(path||'');
  const chunks = raw.split('.');
  for (let i = 0; i < chunks.length; i++){
    const bracket = chunks[i].match(/\[([^\]]*)\]/);
    const idPart = bracket ? bracket[1].replace(/^=/,'') : chunks[i];
    if (isIdSegment(idPart))
      return {key: chunks.slice(0, i+1).join('.'), suffix: chunks.slice(i+1).join('.')};
  }
  return {key: raw, suffix: ''};
}
/* Before=real, After=blank means Viator removed the field, not that it was never set —
   valueBox() cannot tell the two apart on its own since both show the same blank value. */
function wasDeleted(it){
  const had = it.old !== null && it.old !== undefined && it.old !== '';
  const gone = it.now === null || it.now === undefined || it.now === '';
  return had && gone;
}
/* A scalar list (Viator's own suggested-improvements list, say) is diffed by keying each
   entry on ITS OWN VALUE — db.py's flatten() does this deliberately, so reordering the
   list is never mistaken for a change. One consequence: when an entry is added, its
   "value" is, by construction, identical to the identity already shown in the
   breadcrumb — "REVIEW_COUNT" appearing as both the field name AND the field's own new
   value. Detected here (a path ending in an identity bracket with nothing after it) so
   the box can say "Added" instead of repeating the exact same word twice. */
function scalarListIdentity(path){
  const m = String(path||'').match(/\[=([^\]]*?)(?:#\d+)?\]$/);
  return m ? m[1] : null;
}
function wasAdded(it){
  const id = scalarListIdentity(it.path);
  return id !== null && String(it.now) === id
    && (it.old === null || it.old === undefined || it.old === '');
}
/* The "After" box for a scalar-list addition: the raw value would just repeat the
   breadcrumb's own last word, so this reads as an event ("Added") instead of a value. */
function afterBox(it){
  if (wasAdded(it)) return '<span class="yes">Added</span>';
  return valueBox(it.now, null, 'Value after', wasDeleted(it) ? 'Deleted' : undefined);
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

