import { S } from '../state.js';
import { $, api, el, esc, q } from '../core.js';
import { monthName, sentence } from '../format.js';
import { STATUS_COLOR, areaChart, donut, kpiCard, sparkline } from '../charts.js';
import { skeleton } from '../ui.js';
import { go } from '../app.js';

/* ======================= overview ======================= */
export function bars(title, obj, badge){
  const entries = Object.entries(obj||{});
  const c = el('div','card');
  c.appendChild(el('div','card-h',`<h3>${esc(title)}</h3>`));
  const body = el('div','pad');
  if (!entries.length){ body.appendChild(el('div','hint','No data yet.')); }
  else {
    const max = Math.max(1,...entries.map(e=>e[1]));
    entries.slice(0,12).forEach(([k,v])=>{
      const row = el('div','bar');
      row.innerHTML = `<div class="bar-top">${badge?badge(k):''}
        <span class="nm">${badge?'':esc(sentence(k))}</span><span class="vl">${v}</span></div>
        <div class="track"><div class="fill" style="width:${v/max*100}%"></div></div>`;
      body.appendChild(row);
    });
  }
  c.appendChild(body); return c;
}
export async function viewStats(){
  const v = $('#v-stats');
  skeleton(v, 'kpis', 'dashboard figures');
  // Both calls at once. They were sequential, so the page waited for one full round trip
  // to Supabase before even asking for the second — and the database is ~200-350 ms away.
  // Neither depends on the other. `pgP` is caught where it is used, so a failing Progress
  // card still cannot take the rest of the dashboard down.
  const pgP = api('/api/progress'+q('months='+(S.pgMonths||6)));
  pgP.catch(()=>{});                    // no unhandled rejection while overview is awaited
  const o = await api('/api/overview'+q());
  v.innerHTML='';

  // hero
  const acc = S.accounts.find(a=>a.viator_account_id===S.acct);
  const hero = el('div','hero');
  hero.innerHTML = `
    <div class="herotext">
      <div class="tag">✦ Complete change traceability</div>
      <div class="herotop">
        <span class="heromark"><svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M7 24 A17 17 0 0 1 24 7 A17 17 0 0 1 41 24 A17 17 0 0 1 24 41 L7 41 Z" stroke="#AD68E2" stroke-width="7" stroke-linejoin="round"/><circle cx="24" cy="24" r="5.2" fill="#AD68E2"/></svg></span>
        <h2><span class="hname">Opatrip</span> Trace</h2>
      </div>
      <div class="acts">
        <button class="solid" data-go="products">View products <i>›</i></button>
        <button class="ghost2" data-go="accounts">View accounts <i>›</i></button>
      </div>
    </div>
    <svg class="art" viewBox="0 0 520 340" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id="gl" cx="42%" cy="34%" r="72%">
          <stop offset="0" stop-color="#C9AEF5"/><stop offset="1" stop-color="#7C3AED"/>
        </radialGradient>
        <linearGradient id="bar" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stop-color="#8B5CF6"/><stop offset="1" stop-color="#EDE4FE"/>
        </linearGradient>
      </defs>
      <circle cx="250" cy="160" r="140" fill="url(#gl)"/>
      <g stroke="#fff" stroke-opacity=".38" fill="none">
        <ellipse cx="250" cy="160" rx="140" ry="52"/>
        <ellipse cx="250" cy="160" rx="140" ry="100"/>
        <ellipse cx="250" cy="160" rx="52" ry="140"/>
        <ellipse cx="250" cy="160" rx="100" ry="140"/>
        <circle cx="250" cy="160" r="140"/>
      </g>
      <g stroke="#fff" stroke-opacity=".75" fill="none" stroke-linecap="round">
        <path d="M140 120 Q250 40 350 105"/><path d="M160 215 Q265 265 355 200"/>
        <path d="M195 95 Q300 150 330 245"/>
      </g>
      <g fill="#fff">
        <circle cx="140" cy="120" r="4"/><circle cx="350" cy="105" r="4"/>
        <circle cx="160" cy="215" r="4"/><circle cx="355" cy="200" r="4"/>
        <circle cx="195" cy="95" r="3"/><circle cx="330" cy="245" r="3"/>
        <circle cx="268" cy="132" r="2.5" fill-opacity=".8"/>
        <circle cx="222" cy="188" r="2.5" fill-opacity=".8"/>
      </g>
      <g fill="url(#bar)">
        <rect x="352" y="262" width="22" height="52" rx="5"/>
        <rect x="384" y="238" width="22" height="76" rx="5"/>
        <rect x="416" y="252" width="22" height="62" rx="5"/>
        <rect x="448" y="206" width="22" height="108" rx="5"/>
      </g>
      <polyline points="363,268 395,244 427,256 459,212 496,178" fill="none" stroke="#fff"
        stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="496" cy="178" r="6" fill="#fff"/>
      <path d="M486 190 L500 174 L488 172" stroke="#fff" stroke-width="3" fill="none"
        stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  hero.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
  v.appendChild(hero);

  // One KPI row: the total, then the three lifecycle states the client tracks. Tours,
  // Added this month, Changes this week, Pending, Removed and "No longer listed" were all
  // removed on request — the row is the headline, not an inventory of every figure.
  const K = o.kpis;
  K.products.spark = sparkline((o.series.added||[]).map(x=>x.n), '#7C3AED');
  const st = o.dist.status || {};
  const box = (n, sb) => ({value: st[n] || 0, delta: null, sub: sb,
                           filter: {lifecycle: n}});
  const kp = el('div','kpis k4');
  kp.innerHTML =
    // "Total products" is a lie while an account filter is on — name what it counts.
    // sub is blank: "1117 added in 30 days" was removed on request.
    kpiCard('◧','var(--accent-soft)',
            S.acct ? 'Products in this account' : 'Total Products Ever Added',
            {...K.products, sub: '', filter: {}}) +
    kpiCard('●','var(--green-bg)','Live', box('LIVE','selling on the platform')) +
    kpiCard('▤','#FEF3C7','Draft', box('DRAFT','recorded, not yet submitted')) +
    kpiCard('✕','var(--red-bg)','Rejected', box('REJECTED','needs fixing and resubmitting'));
  v.appendChild(kp);

  // Every card that carries a filter opens Products already narrowed to it.
  const drill = el2 => {
    const f = JSON.parse(el2.dataset.filter);
    Object.assign(S.pf, {q:'', status:'', lifecycle:'', platform:'',
                         reviews:'', missing:'', changed:''}, f);
    go('products');
  };
  v.querySelectorAll('.kpi-click').forEach(c => {
    c.onclick = () => drill(c);
    c.onkeydown = e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); drill(c); } };
  });

  /* ---- Progress: this month against last ----------------------------------------
     Answers "are we moving forward?", which no single-point figure can. Every number
     here is measured, never modelled: `added` comes from first_seen_at, and the status
     counts for past months are reconstructed from recorded status changes (see
     /api/progress). The note under the table says so, because a chart that quietly
     assumes is worse than one that admits. */
  try {
    const pg = await pgP;               // already in flight since the top of this function
    const D = pg.deltas || {};
    const pc = el('div','card'); pc.style.marginTop='16px';
    const head = el('div','card-h');
    head.innerHTML = `<h3>Progress</h3><span class="sub">where the catalogue stands in `
      + `${esc(pg.current.month)}</span>
      <span style="flex:1"></span>
      <select id="pgmonths" title="How far back to show">
        ${[3,6,12,24].map(n=>`<option value="${n}" ${S.pgMonths===n?'selected':''}
          >Last ${n} months</option>`).join('')}</select>`;
    pc.appendChild(head);
    head.querySelector('#pgmonths').onchange = e=>{
      S.pgMonths = Number(e.target.value); viewStats();
    };
    const pb = el('div','pad');

    // Just the figure and what it is. The +/- chips against last month were removed on
    // request: "added" in particular fell 81% simply because the first import was one
    // big batch, which reads as a collapse rather than a normal month.
    // Tracked / Pending / Removed were dropped on request, here and in the table below.
    const MOVERS = [['added','Added this month'], ['LIVE','Live'], ['DRAFT','Draft'],
                    ['REJECTED','Rejected']];
    const cells = MOVERS.map(([k, lab]) =>
      `<div class="mv"><div class="mv-l">${esc(lab)}</div>
        <div class="mv-n">${pg.current[k] || 0}</div></div>`).join('');
    pb.innerHTML = `<div class="movers">${cells}</div>`;

    // every month in the chosen range, not only the ones with products — a gap is a
    // fact about the catalogue, and hiding it makes a two-row table look like all the
    // history there is
    const rows = (pg.series||[]);
    if (rows.length > 1){
      const t = el('div','tblwrap'); t.style.marginTop='14px';
      t.innerHTML = `<table><thead><tr><th>Month</th><th class="num">Added</th>
        <th class="num">Live</th><th class="num">Draft</th>
        <th class="num">Rejected</th>
        </tr></thead><tbody>${rows.map(s=>`<tr>
          <td>${esc(monthName(s.month))}</td>
          <td class="v num">${s.added || 0}</td>
          <td class="v num">${s.LIVE}</td><td class="v num">${s.DRAFT}</td>
          <td class="v num">${s.REJECTED}</td></tr>`).join('')}</tbody></table>`;
      pb.appendChild(t);
    }
    pb.appendChild(el('div','hint', esc(pg.history_note)));
    pc.appendChild(pb); v.appendChild(pc);

    /* The Reviews band card was removed from this page on request. The same filter is
       still on Products ("Any reviews"), and /api/progress still returns the bands. */

    /* ---- Growth per account ----------------------------------------------------- */
    if ((pg.growth||[]).length > 1 && !S.acct){
      const gc = el('div','card'); gc.style.marginTop='16px';
      gc.appendChild(el('div','card-h','<h3>Growth by account</h3>'+
        '<span class="sub">products added, this month vs last</span>'));
      const gb = el('div','pad');
      const t = el('div','tblwrap');
      t.innerHTML = `<table><thead><tr><th>Account</th><th class="num">This month</th>
        <th class="num">Last month</th><th class="num">Total</th></tr></thead><tbody>${
        pg.growth.map(g=>`<tr><td><div style="font-weight:600">${esc(g.name||g.account)}</div>
            <div class="mono hint">${esc(g.account)}</div></td>
          <td class="v num">${g.this_month || 0}</td>
          <td class="v num">${g.last_month || 0}</td>
          <td class="v num"><b>${g.total}</b></td></tr>`).join('')}</tbody></table>`;
      gb.appendChild(t); gc.appendChild(gb); v.appendChild(gc);
    }
  } catch(e){
    // Progress is an extra, not the page. If it fails the rest of the dashboard stands.
    const w = el('div','hint'); w.style.marginTop='16px';
    w.textContent = 'Progress figures unavailable: ' + e.message;
    v.appendChild(w);
  }

  // charts row 1: status donut + activity area
  const r1 = el('div','chartwrap');
  const c1 = el('div','card');
  c1.appendChild(el('div','card-h','<h3>Lifecycle status</h3>'+
    '<span class="sub">canonical, across platforms</span>'));
  const b1 = el('div','pad');
  // Pending and Removed were dropped from this donut on request, so it shows the same
  // three states as the cards above rather than contradicting them.
  const SHOW = ['LIVE','DRAFT','REJECTED'];
  b1.innerHTML = donut(Object.entries(o.dist.status||{}).filter(([k])=>SHOW.includes(k)));
  c1.appendChild(b1); r1.appendChild(c1);

  const c2 = el('div','card');
  c2.appendChild(el('div','card-h','<h3>Changes detected</h3>'+
    '<span class="sub">last 14 days with activity</span>'));
  const b2 = el('div','pad');
  b2.innerHTML = areaChart(o.series.changes||[], '#7C3AED');
  c2.appendChild(b2); r1.appendChild(c2);
  v.appendChild(r1);

  // platform coverage — the comparison that matters for multi-platform
  const cov = el('div','card'); cov.style.marginTop='16px';
  cov.appendChild(el('div','card-h','<h3>Platform coverage</h3>'+
    '<span class="sub">how each platform compares — grey means not uploaded</span>'));
  const cb = el('div','pad');
  const order = ['LIVE','PENDING','DRAFT','REJECTED','REMOVED','NOT_LISTED'];
  o.coverage.forEach(p=>{
    const tot = order.reduce((a,k)=>a+(p[k]||0),0) || 1;
    const segs = order.map(k=>p[k]
      ? `<span style="width:${p[k]/tot*100}%;background:${STATUS_COLOR[k]}"
           title="${k}: ${p[k]}"></span>` : '').join('');
    const row = el('div','covrow');
    row.innerHTML = `<div><b>${esc(p.name)}</b>${p.capturable?''
        :'<div class="hint">capture not built</div>'}</div>
      <div class="stack">${segs}</div>
      <div class="v num" style="text-align:right"><b>${p.LIVE||0}</b>
        <div class="hint">live</div></div>`;
    cb.appendChild(row);
  });
  cb.appendChild(el('div','legend', order.map(k=>
    `<div><i style="background:${STATUS_COLOR[k]}"></i>${esc(
      k==='NOT_LISTED'?'Not uploaded':sentence(k))}</div>`).join('')));
  cov.appendChild(cb); v.appendChild(cov);

  // The "Book on Connection", "Quality" and "Top locations" bar charts were removed from
  // this page on request, as was the "Where tours were made" card that briefly replaced
  // the last of them. All three breakdowns still exist on the Breakdown tab.

  // The dashboard used to end with two raw feeds — "Latest changes" and "Recent sync
  // runs". Both were tables of field paths, run ids and operator emails: true, but
  // written for whoever built the tool rather than whoever uses it. Change history has
  // its own tab, in plain English, and run history lives under Sync runs.

  // sidebar counters — guarded, because the Change history tab (and its counter) is gone
  const setCnt = (id, v) => { const n = $(id); if (n) n.textContent = v; };
  setCnt('#cntProducts', K.products.value);
}


