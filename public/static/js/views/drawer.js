import { S } from '../state.js';
import { $, api, el, esc } from '../core.js';
import { getPath, groupChanges, label, photoSummary, qualBadge, setEditContext,
         statusBadge, valueBox } from '../format.js';
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
  const d = await api('/api/product/'+pid);
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

  /* change history */
  const ch = el('div','card');
  ch.appendChild(el('div','card-h',
    `<h3>Change history</h3><span class="sub">${d.changes.length} recorded</span>`));
  const chb = el('div','pad');
  if (!d.changes.length){
    chb.appendChild(el('div','hint',
      'No changes yet — the first capture is the baseline to compare against.'));
  } else {
    const t = el('div','tblwrap');
    // grouped the same way as the Change history tab: one photo edit, one line
    t.innerHTML = `<table><thead><tr><th>What changed</th><th>Before</th><th>After</th>
      <th>When</th><th>Run by</th></tr></thead><tbody>${
      groupChanges(d.changes).map(g=>{
        const c = g.c;
        if (g.photos) return `<tr>
          <td><b>Photos</b><div class="hint">${esc(photoSummary(g))}</div></td>
          <td colspan="2" class="hint">changed on Viator — the photos themselves are
            not stored</td>
          <td class="hint" style="white-space:nowrap">${esc(when(c.detected_at))}</td>
          <td class="hint">${esc(c.operator_email)}</td></tr>`;
        return `<tr>
          <td>${esc(fieldLabel(c.field_path))}</td>
          <td>${valueBox(c.old_value, 'old', 'Value before')}</td>
          <td>${valueBox(c.new_value, null, 'Value after')}</td>
          <td class="hint" style="white-space:nowrap">${esc(when(c.detected_at))}</td>
          <td class="hint">${esc(c.operator_email)}</td></tr>`;
      }).join('')}</tbody></table>`;
    chb.appendChild(t);
  }
  ch.appendChild(chb); body.appendChild(ch);

  /* Manual edits — the counterpart to Change history: that shows what VIATOR changed,
     this shows what a person changed, and who. Removing the old top panel must not remove
     the audit trail with it. */
  if ((d.edit_history||[]).length){
    const c = el('div','card');
    c.appendChild(el('div','card-h',
      `<h3>Manual edits</h3><span class="sub">${d.edit_history.length} recorded</span>`));
    const b2 = el('div','pad');
    const t = el('div','tblwrap');
    t.innerHTML = `<table><thead><tr><th>Field</th><th>Value</th><th>Viator had</th>
      <th>By</th><th>When</th><th>Reason</th></tr></thead><tbody>${
      d.edit_history.map(h=>`<tr>
        <td class="mono">${esc(h.field)}</td>
        <td>${valueBox(h.value, null, 'Value after the edit')}${h.is_current
          ?'<span class="badge b-active">current</span>':''}</td>
        <td>${valueBox(h.captured_value, 'old', 'What Viator had')}</td>
        <td class="hint">${esc(h.editor_email)}</td>
        <td class="hint" style="white-space:nowrap">${esc(when(h.edited_at))}</td>
        <td class="hint">${esc(h.note||'')}</td></tr>`).join('')}</tbody></table>`;
    b2.appendChild(t);
    b2.appendChild(el('div','hint',
      'Edits never change the captured snapshot — the portal value is kept beside them, '
      + 'so a later sync cannot overwrite anyone’s work.'));
    c.appendChild(b2); body.appendChild(c);
  }

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

