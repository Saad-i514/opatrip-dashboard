import { S } from '../state.js';
import { $, api, el, esc } from '../core.js';
import { connBadge, label, list, qualBadge, rows, setEditContext, statusBadge, sub, valueBox } from '../format.js';
import { skLines } from '../ui.js';
import { buildSections, commissionOf, totalDuration, tree } from '../sections.js';
import { editValue, uploadImage, deleteImage } from '../edit.js';
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

  const thumb = p.thumbnail_path ? `<img src="/api/thumb/${p.id}" alt="">`
    : (p.thumbnail_url ? `<img src="${esc(p.thumbnail_url)}" alt="">` : '');
  const head = el('div','dhead');
  head.innerHTML = `<div class="dhead-top">
      ${thumb}
      <div style="flex:1;min-width:0">
        <h2 style="font-size:19px">${esc(p.title||'(untitled)')}</h2>
        <div class="pmeta" style="margin-top:6px">
          <span class="mono">${esc(p.product_code)}</span>
          · ${esc(p.account_name||p.viator_account_id)}
          ${p.location?'· '+esc(p.location):''}
        </div>
        <div style="margin-top:10px;display:flex;gap:7px;flex-wrap:wrap">
          ${p.is_draft_stub?'<span class="badge b-stub">Draft — recorded only</span>':''}
          ${qualBadge(p.quality_level)}${connBadge(p.connection_state)}${statusBadge(p.status)}
        </div>
      </div>
      <button class="btn ghost" id="xClose">Close</button>
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
     ['Photos', d.images.length, 'saved locally'],
     ['Reviews', rr.totalReviewCount||0, rr.totalReviewCount?`rated ${rr.rating}`:'none yet'],
     ['Changes', d.changes.length, 'since first capture']]
     .forEach(([l,n,s])=>tiles.appendChild(el('div','tile',
       `<div class="l">${l}</div><div class="n">${esc(n)}</div><div class="s">${esc(s)}</div>`)));
    body.appendChild(tiles);
  }

  /* Photos — viewable, and now manageable: anyone can add one, and anything they added
     can be removed. Captured Viator photos are deliberately NOT removable; they are the
     evidence of what the portal showed. */
  {
    const c = el('div','card');
    c.appendChild(el('div','card-h',
      `<h3>Photos</h3><span class="sub">${d.images.length} on this product</span>`));
    const b = el('div','pad');
    const caps = {};
    ((cur&&cur.product&&cur.product.media)||[]).forEach(m=>{
      const ref = (m.media||{}).ref || m.mediaRef;
      if (ref && m.descriptiveText) caps[ref] = m.descriptiveText;
    });
    if (d.images.length){
      const g = el('div','photogrid');
      d.images.forEach(im=>{
        const cap = im.caption || caps[im.image_ref] || '';
        const manual = !!im.is_manual;
        const tile = el('div','photo');
        tile.innerHTML = `
          <img src="/api/image/${im.id}" loading="lazy" alt="${esc(cap)}">
          ${manual?'<span class="tag">added</span>':''}
          <div class="meta">${cap?esc(cap):'<span class="hint">no caption</span>'}
            ${manual&&im.added_by?`<div class="hint">by ${esc(im.added_by)}</div>`:''}</div>`;
        tile.querySelector('img').onclick = ()=>window.open(
          `/api/image/${im.id}`, '_blank', 'noopener');
        if (manual){
          const rm = el('button','rm','×');
          rm.title = 'Remove this photo';
          rm.onclick = e=>{ e.stopPropagation();
            deleteImage(p.id, im.id, ()=>openDrawer(p.id)); };
          tile.appendChild(rm);
        }
        g.appendChild(tile);
      });
      b.appendChild(g);
    } else {
      b.appendChild(el('div','hint','No photos yet.'));
    }
    const dz = el('div','dropzone');
    dz.style.marginTop = d.images.length ? '14px' : '0';
    dz.innerHTML = '<b>Add a photo</b><div>click to choose, or drop an image here · '
      + 'JPEG, PNG, WebP or GIF, up to 12 MB</div>';
    const inp = el('input'); inp.type='file'; inp.accept='image/*'; inp.className='hidden';
    dz.onclick = ()=>inp.click();
    inp.onchange = ()=>{ if(inp.files[0])
      uploadImage(p.id, inp.files[0], ()=>openDrawer(p.id)); };
    dz.ondragover = e=>{ e.preventDefault(); dz.classList.add('over'); };
    dz.ondragleave = ()=>dz.classList.remove('over');
    dz.ondrop = e=>{ e.preventDefault(); dz.classList.remove('over');
      const f = e.dataTransfer.files[0];
      if (f) uploadImage(p.id, f, ()=>openDrawer(p.id)); };
    b.appendChild(dz); b.appendChild(inp);
    c.appendChild(b); body.appendChild(c);
  }

  /* readable sections — every field row carries its own pen, wired through this
     context so sections.js stays pure rendering */
  if (cur && cur.product){
    setEditContext({
      pid: p.id,
      edits: d.edits || {},
      snapshot: cur,
      onSaved: () => openDrawer(p.id),
      edit: (spec) => editValue(p.id, spec, () => openDrawer(p.id)),
    });
    const secs = buildSections(cur);
    const c = el('div','card');
    c.appendChild(el('div','card-h','<h3>Product details</h3>'+
      '<span class="sub">everything captured in one page load</span>'));
    const b = el('div','pad');
    const strip = el('div','tabstrip'), panes = el('div');
    secs.forEach(([name,node],i)=>{
      const btn = el('button','tabbtn'+(i===0?' on':''),esc(name));
      const pane = el('div',i===0?'':'hidden');
      pane.style.marginTop='16px';
      pane.appendChild(node);
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
    t.innerHTML = `<table><thead><tr><th>What changed</th><th>Before</th><th>After</th>
      <th>When</th><th>Run by</th></tr></thead><tbody>${d.changes.map(c=>`<tr>
        <td>${esc(fieldLabel(c.field_path))}</td>
        <td>${valueBox(c.old_value, 'old', 'Value before')}</td>
        <td>${valueBox(c.new_value, null, 'Value after')}</td>
        <td class="hint" style="white-space:nowrap">${esc(when(c.detected_at))}</td>
        <td class="hint">${esc(c.operator_email)}</td></tr>`).join('')}</tbody></table>`;
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

  /* snapshots + raw */
  if (d.snapshots.length){
    const c = el('div','card');
    c.appendChild(el('div','card-h',
      `<h3>Earlier captures</h3><span class="sub">${d.snapshots.length} snapshot(s)</span>`));
    const b = el('div','pad');
    d.snapshots.forEach((s,i)=>{
      // A run that found no change writes no snapshot — it stamps the existing one.
      // Saying so here is the difference between "captured once" and "unchanged since".
      const conf = s.confirmations
        ? ` · unchanged in ${s.confirmations} later run${s.confirmations>1?'s':''}`
          + (s.last_confirmed_at ? `, last ${when(s.last_confirmed_at)}` : '')
        : '';
      const btn = el('button','btn ghost sm',
        `${when(s.captured_at)} · run #${s.sync_id}${i===0?' · latest':''}${conf}`);
      btn.style.cssText='display:block;width:100%;text-align:left;margin:4px 0';
      btn.onclick = async ()=>{
        const snap = await api('/api/snapshot/'+s.id);
        const holder = el('div','card pad'); holder.style.marginTop='10px';
        holder.appendChild(el('div','subhead',`Snapshot ${when(snap.captured_at)}`));
        holder.appendChild(tree(snap.normalized));
        btn.after(holder); btn.disabled = true;
      };
      b.appendChild(btn);
    });
    if (cur){
      const raw = el('details'); raw.style.marginTop='14px';
      const s = el('summary','hint','Show raw captured data (for developers)');
      s.style.cursor='pointer';
      raw.appendChild(s);
      const holder = el('div'); holder.style.marginTop='10px';
      raw.appendChild(holder);
      raw.ontoggle = ()=>{ if(raw.open && !holder.childElementCount) holder.appendChild(tree(cur)); };
      b.appendChild(raw);
    }
    c.appendChild(b); body.appendChild(c);
  }
  dr.appendChild(body); host.appendChild(dr);
  head.querySelector('#xClose').onclick = closeDrawer;
}
export const trunc = s => { s = (s===null||s===undefined)?'(none)':String(s);
  try{ const p=JSON.parse(s); if(p&&typeof p==='object')
    s = Array.isArray(p)?`${p.length} item(s)`:Object.keys(p).slice(0,3).join(', ');
  }catch(e){}
  return s.length>72 ? s.slice(0,72)+'…' : s; };
export const when = t => String(t||'').replace('T',' ').replace('+00:00','').slice(0,16);
/* "product.voucher.ticketType" -> "Tickets › Ticket format" */
export const PATH_SEC = {pricing:'Schedules & prices', ageBands:'Schedules & prices',
  productOptions:'Schedules & prices', currency:'Schedules & prices',
  bookingSettings:'Booking details', bookingConfirmationSettings:'Booking details',
  cancellationPolicy:'Booking details', travellerRequiredInfo:'Booking details',
  voucher:'Tickets', connectionDetails:'Connection', externalReference:'Connection',
  specialOfferInfo:'Special offers', media:'Photos', heroPhoto:'Photos',
  itinerary:'Overview', inclusions:'Overview', exclusions:'Overview',
  taxonomy:'Overview', additionalInfo:'Overview'};
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

