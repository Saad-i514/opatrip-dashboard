import { S } from '../state.js';
import { $, api, el, esc, q } from '../core.js';
import { connBadge, qualBadge, sentence, sub, valueBox } from '../format.js';
import { STATUS_COLOR, areaChart, donut, kpiCard, sparkline } from '../charts.js';
import { skeleton } from '../ui.js';
import { fieldLabel, trunc, when } from './drawer.js';
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
  const o = await api('/api/overview'+q());
  v.innerHTML='';

  // hero
  const acc = S.accounts.find(a=>a.viator_account_id===S.acct);
  const hero = el('div','hero');
  hero.innerHTML = `
    <div class="tag">◆ Complete change traceability</div>
    <h2>Product audit command centre</h2>
    <p>Every product captured, every field compared against the last snapshot, and every
       change attributed to the account and the person who ran the sync — across
       ${o.coverage.length} platforms.</p>
    <div class="acts">
      <button class="solid" data-go="products">View products</button>
      <button class="ghost2" data-go="audit">Change history</button>
    </div>
    <svg class="art" width="230" height="150" viewBox="0 0 230 150" fill="none">
      <rect x="10" y="40" width="26" height="80" rx="5" fill="#fff"/>
      <rect x="48" y="18" width="26" height="102" rx="5" fill="#fff"/>
      <rect x="86" y="60" width="26" height="60" rx="5" fill="#fff"/>
      <rect x="124" y="32" width="26" height="88" rx="5" fill="#fff"/>
      <polyline points="14,96 60,52 100,74 140,30 200,16" stroke="#fff" stroke-width="5"
        fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="200" cy="16" r="9" fill="#fff"/></svg>`;
  hero.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
  v.appendChild(hero);

  // KPI row — sparklines only where a real series exists
  const K = o.kpis;
  K.products.spark = sparkline((o.series.added||[]).map(x=>x.n), '#F97316');
  K.changes.spark  = sparkline((o.series.changes||[]).map(x=>x.n), '#2563EB');
  // Row 1 — the headline figures. "Sync success" used to sit here; it measured the
  // TOOL, not the catalogue, which is not what this page is for. It is still on the
  // Sync runs tab, where someone looking at runs will actually want it.
  const kp = el('div','kpis k4');
  kp.innerHTML =
    // "Total products" is a lie while an account filter is on — name what it counts
    kpiCard('◧','var(--accent-soft)',
            S.acct ? 'Products in this account' : 'Total Products Ever Added',
            {...K.products, filter: {}}) +
    kpiCard('◈','#EDE9FE','Tours tracked', K.tours) +
    kpiCard('↑','#DCFCE7','Added this month', K.added_month) +
    kpiCard('⟳','#DBEAFE','Changes this week', K.changes);
  v.appendChild(kp);

  // Row 2 — the whole lifecycle in one row, every card a filter into Products.
  const st = o.dist.status || {};
  const box = (n, sb) => ({value: st[n] || 0, delta: null, sub: sb,
                           filter: {lifecycle: n}});
  const kp2 = el('div','kpis k6');
  kp2.innerHTML =
    kpiCard('●','var(--green-bg)','Live', box('LIVE','selling on the platform')) +
    kpiCard('▤','#FEF3C7','Draft', box('DRAFT','recorded, not yet submitted')) +
    kpiCard('◷','var(--amber-bg)','Pending', box('PENDING','awaiting platform review')) +
    kpiCard('✕','var(--red-bg)','Rejected', box('REJECTED','needs fixing and resubmitting')) +
    kpiCard('⊘','#F1EDE7','Removed', box('REMOVED','inactive on the platform')) +
    // NOT the same thing as REMOVED: this counts products that vanished from the account
    // roster entirely. Named apart so the two can't be read as one figure.
    kpiCard('⚑','var(--red-bg)','No longer listed',
            {...K.removed, filter: {missing: '1'}});
  v.appendChild(kp2);

  // Every card that carries a filter opens Products already narrowed to it.
  const drill = el2 => {
    const f = JSON.parse(el2.dataset.filter);
    Object.assign(S.pf, {q:'', status:'', lifecycle:'', platform:'', connection:'',
                         reviews:'', missing:''}, f);
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
    const pg = await api('/api/progress'+q());
    const D = pg.deltas || {};
    const pc = el('div','card'); pc.style.marginTop='16px';
    pc.appendChild(el('div','card-h','<h3>Progress</h3>'+
      `<span class="sub">${esc(pg.current.month)} vs ${
        pg.previous ? esc(pg.previous.month) : 'no earlier month'}</span>`));
    const pb = el('div','pad');

    const MOVERS = [['total','Products tracked'], ['added','Added'], ['LIVE','Live'],
                    ['DRAFT','Draft'], ['REJECTED','Rejected'], ['REMOVED','Removed']];
    const cells = MOVERS.map(([k, lab]) => {
      const d = D[k];
      if (!d) return `<div class="mv"><div class="mv-l">${esc(lab)}</div>
        <div class="mv-n">${(pg.current[k]||0)}</div>
        <div class="mv-d hint">no earlier month yet</div></div>`;
      // "added" falling is not a regression — it counts new arrivals, and a big first
      // import makes every later month look like a drop. Colour only what it means.
      const good = k === 'REJECTED' || k === 'REMOVED' ? d.diff < 0 : d.diff > 0;
      const cls = d.diff === 0 ? 'flat' : (good ? 'up' : 'dn');
      const arrow = d.diff === 0 ? '–' : (d.diff > 0 ? '↗' : '↘');
      return `<div class="mv"><div class="mv-l">${esc(lab)}</div>
        <div class="mv-n">${d.now}</div>
        <div class="mv-d mv-${cls}">${arrow} ${d.diff > 0 ? '+' : ''}${d.diff}${
          d.pct == null ? '' : ` (${d.pct > 0 ? '+' : ''}${d.pct}%)`}
          <span class="hint">was ${d.was}</span></div></div>`;
    }).join('');
    pb.innerHTML = `<div class="movers">${cells}</div>`;

    // month-by-month table — the raw numbers behind the deltas
    const rows = (pg.series||[]).filter(s => s.total || s.added);
    if (rows.length > 1){
      const t = el('div','tblwrap'); t.style.marginTop='14px';
      t.innerHTML = `<table><thead><tr><th>Month</th><th>Tracked</th><th>Added</th>
        <th>Live</th><th>Draft</th><th>Pending</th><th>Rejected</th><th>Removed</th>
        </tr></thead><tbody>${rows.map(s=>`<tr>
          <td class="mono">${esc(s.month)}</td>
          <td class="v num"><b>${s.total}</b></td>
          <td class="v num">${s.added ? '+'+s.added : '—'}</td>
          <td class="v num">${s.LIVE}</td><td class="v num">${s.DRAFT}</td>
          <td class="v num">${s.PENDING}</td><td class="v num">${s.REJECTED}</td>
          <td class="v num">${s.REMOVED}</td></tr>`).join('')}</tbody></table>`;
      pb.appendChild(t);
    }
    pb.appendChild(el('div','hint', esc(pg.history_note)));
    pc.appendChild(pb); v.appendChild(pc);

    /* ---- Reviews: the "needs attention" list, one click from here ---------------- */
    const rc = el('div','card'); rc.style.marginTop='16px';
    rc.appendChild(el('div','card-h','<h3>Reviews</h3>'+
      '<span class="sub">click a band to see those products</span>'));
    const rb = el('div','pad');
    const bands = pg.reviews || {};
    const maxB = Math.max(1, ...Object.values(bands).map(b=>b.n));
    Object.entries(bands).forEach(([key, b]) => {
      const row = el('div','bar rev-bar');
      row.setAttribute('role','button'); row.tabIndex = 0;
      row.innerHTML = `<div class="bar-top">
          <span class="nm">${esc(b.label)}</span><span class="vl">${b.n}</span></div>
        <div class="track"><div class="fill${key==='0'?' fill-warn':''}"
             style="width:${b.n/maxB*100}%"></div></div>`;
      const go2 = () => {
        Object.assign(S.pf, {q:'',status:'',lifecycle:'',platform:'',connection:'',
                             missing:'', reviews:key});
        go('products');
      };
      row.onclick = go2;
      row.onkeydown = e => { if (e.key==='Enter'||e.key===' '){ e.preventDefault(); go2(); } };
      rb.appendChild(row);
    });
    if (bands['0'] && bands['0'].n)
      rb.appendChild(el('div','hint',
        `<b>${bands['0'].n} product(s) have no reviews yet.</b> Those are the ones review `
        + `generation moves the needle on — click the band to work through them.`));
    rc.appendChild(rb); v.appendChild(rc);

    /* ---- Growth per account ----------------------------------------------------- */
    if ((pg.growth||[]).length > 1 && !S.acct){
      const gc = el('div','card'); gc.style.marginTop='16px';
      gc.appendChild(el('div','card-h','<h3>Growth by account</h3>'+
        '<span class="sub">products added, this month vs last</span>'));
      const gb = el('div','pad');
      const t = el('div','tblwrap');
      t.innerHTML = `<table><thead><tr><th>Account</th><th>This month</th>
        <th>Last month</th><th>Total</th></tr></thead><tbody>${
        pg.growth.map(g=>`<tr><td><div style="font-weight:600">${esc(g.name||g.account)}</div>
            <div class="mono hint">${esc(g.account)}</div></td>
          <td class="v num">${g.this_month ? '+'+g.this_month : '—'}</td>
          <td class="v num">${g.last_month ? '+'+g.last_month : '—'}</td>
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
  b1.innerHTML = donut(Object.entries(o.dist.status||{}));
  c1.appendChild(b1); r1.appendChild(c1);

  const c2 = el('div','card');
  c2.appendChild(el('div','card-h','<h3>Changes detected</h3>'+
    '<span class="sub">last 14 days with activity</span>'));
  const b2 = el('div','pad');
  b2.innerHTML = areaChart(o.series.changes||[], '#F97316');
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

  // category breakdowns
  const r2 = el('div','chartwrap'); r2.style.marginTop='16px';
  r2.appendChild(bars('Book on Connection', o.dist.connection, connBadge));
  r2.appendChild(bars('Quality', o.dist.quality, qualBadge));
  r2.appendChild(bars('Top locations', o.dist.location));
  v.appendChild(r2);
  // Same note as the Breakdown page: "Not captured (draft)" is a rule being followed,
  // not data going missing, and saying so here stops the question being asked twice.
  const drafty = ['connection','quality','location']
    .reduce((n,k)=>n+((o.dist[k]||{})['Not captured (draft)']||0), 0);
  if (drafty){
    const note = el('div','hint');
    note.style.marginTop = '12px';
    note.innerHTML = '<b>“Not captured (draft)”</b> is not missing data. Drafts are '
      + 'recorded from the account roster and deliberately never deep-fetched, so the '
      + 'roster’s gaps show here; the fields fill in once a draft goes live. '
      + '<b>“Unknown”</b> means the portal itself had no value.';
    v.appendChild(note);
  }

  // The dashboard used to end with two raw feeds — "Latest changes" and "Recent sync
  // runs". Both were tables of field paths, run ids and operator emails: true, but
  // written for whoever built the tool rather than whoever uses it. Change history has
  // its own tab, in plain English, and run history lives under Sync runs.

  // sidebar counters
  $('#cntProducts').textContent = K.products.value;
  $('#cntChanges').textContent = K.changes.value;
  $('#cntPlatforms').textContent = o.coverage.length;
}

