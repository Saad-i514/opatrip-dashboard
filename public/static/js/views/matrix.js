import { S } from '../state.js';
import { $, api, el, esc, q } from '../core.js';
import { label, rows, sub } from '../format.js';
import { skeleton } from '../ui.js';
import { openDrawer } from './drawer.js';

/* ======================= platforms (tour x platform grid) =======================
   One row per tour, one column per platform. A platform with no listing shows
   "Not uploaded", which is how a tour missing from a platform becomes visible. */

export async function viewMatrix(){
  const v = $('#v-matrix');
  if (!v.dataset.painted) skeleton(v, 'rows', 'the platform grid');
  const ps = new URLSearchParams();
  if (S.acct) ps.set('account', S.acct);
  if (S.mq) ps.set('q', S.mq);
  const d = await api('/api/matrix?' + ps);
  v.dataset.painted='1';
  v.innerHTML = '';
  const f = el('div','filters');
  f.innerHTML = `<input type="text" id="mq" placeholder="Search tours or product codes"
      value="${esc(S.mq)}" style="min-width:280px;flex:1;max-width:420px">
    <span class="pill">${d.tours.length} tours</span>
    <span class="pill">${d.platforms.length} platforms</span>`;
  v.appendChild(f);
  // This page counts TOURS; the dashboard counts LISTINGS. They differ whenever one tour
  // is listed twice on the same platform, and that gap read as a bug ("630 live here,
  // 626 there") when it is really a duplicate worth knowing about. Name it, and name the
  // tours responsible.
  // platform_matrix already keeps extra listings on a cell as `others` — a tour with two
  // products on one platform. That is exactly the gap between the two counts.
  const codesOf = t => Object.values(t.platforms || {}).flatMap(
    c => c && c.code ? [c.code, ...((c.others || []).map(o => o.code))] : []);
  const dupes = d.tours.map(t => [t, codesOf(t)]).filter(([, cs]) => cs.length > 1);
  if (dupes.length){
    const note = el('div','banner');
    note.innerHTML = `<b>${dupes.length} tour${dupes.length > 1 ? 's are' : ' is'} listed `
      + `more than once.</b> That is why the tour count here is lower than the listing `
      + `count on the dashboard — a duplicate is one tour but several products. `
      + dupes.slice(0, 4).map(([t, cs]) =>
          `<b>${esc(t.title)}</b> (${esc(cs.join(', '))})`).join('; ')
      + (dupes.length > 4 ? `, and ${dupes.length - 4} more.` : '.');
    v.appendChild(note);
  }
  f.querySelector('#mq').oninput = e=>{ S.mq=e.target.value; debounce(viewMatrix); };

  // per-platform totals
  const tiles = el('div','tiles');
  d.platforms.forEach(p=>{
    const c = d.counts[String(p.id)]||{};
    const live = c.LIVE||0, notlisted = c.NOT_LISTED||0;
    tiles.appendChild(el('div','tile',
      `<div class="l">${esc(p.name)}</div><div class="n">${live}</div>`+
      `<div class="s">live · ${notlisted} not uploaded`+
      `${p.capturable?'':' · capture not built yet'}</div>`));
  });
  v.appendChild(tiles);

  if (!d.tours.length){
    v.appendChild(el('div','card empty','<div class="big">No tours yet</div>'+
      'Capture an account and its tours will appear here, one row each.'));
    return;
  }
  const card = el('div','card');
  card.appendChild(el('div','card-h','<h3>Tour status by platform</h3>'+
    '<span class="sub">“Not uploaded” means no listing exists on that platform</span>'));
  const wrap = el('div','tblwrap');
  const badge = code => {
    const s = d.statuses[code] || {label: code, badge: 'b-draft'};
    return `<span class="badge ${esc(s.badge)}">${esc(s.label)}</span>`;
  };
  wrap.innerHTML = `<table><thead><tr><th>Tour</th>${
    d.platforms.map(p=>`<th>${esc(p.name)}</th>`).join('')}</tr></thead><tbody>${
    d.tours.map(t=>`<tr>
      <td><div style="font-weight:600">${esc(t.title||'(untitled)')}</div></td>
      ${d.platforms.map(p=>{
        const cell = t.platforms[p.id] || {status:'NOT_LISTED'};
        const code = cell.code ? `<div class="mono hint">${esc(cell.code)}</div>` : '';
        const link = cell.product_id
          ? `<a href="#" data-open="${cell.product_id}">view</a>` : '';
        // more than one listing for this tour on this platform
        const extra = (cell.others||[]).map(o=>
          `<div style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--line)">
             ${badge(o.status)}<div class="mono hint">${esc(o.code||'')}</div>
             ${o.product_id?`<a href="#" data-open="${o.product_id}">view</a>`:''}</div>`).join('');
        return `<td>${badge(cell.status)}${code}${link}${extra}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table>`;
  card.appendChild(wrap); v.appendChild(card);
  wrap.querySelectorAll('[data-open]').forEach(a=>a.onclick=e=>{
    e.preventDefault(); openDrawer(+a.dataset.open); });
}

