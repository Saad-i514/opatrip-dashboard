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
  const kp = el('div','kpis k6');
  kp.innerHTML =
    // "Total products" is a lie while an account filter is on — name what it counts
    kpiCard('◧','var(--accent-soft)',
            S.acct ? 'Products in this account' : 'Total products', K.products) +
    kpiCard('◈','#EDE9FE','Tours tracked', K.tours) +
    kpiCard('⟳','#DBEAFE','Changes this week', K.changes) +
    kpiCard('✓','var(--green-bg)','Sync success', K.sync_rate) +
    kpiCard('▤','#FEF3C7','Drafts', K.drafts) +
    // NOT the same thing as the REMOVED status below: this counts products that vanished
    // from the account roster entirely. Named apart so the two can't be read as one figure.
    kpiCard('⚑','var(--red-bg)','No longer listed', K.removed);
  v.appendChild(kp);

  // lifecycle row — the canonical status split, same source as the donut below
  const st = o.dist.status || {};
  const box = (n, sb) => ({value: st[n] || 0, delta: null, sub: sb});
  const kp2 = el('div','kpis k4');
  kp2.innerHTML =
    kpiCard('●','var(--green-bg)','Live', box('LIVE','selling on the platform')) +
    kpiCard('◷','var(--amber-bg)','Pending', box('PENDING','awaiting platform review')) +
    kpiCard('✕','var(--red-bg)','Rejected', box('REJECTED','needs fixing and resubmitting')) +
    kpiCard('⊘','#F1EDE7','Removed', box('REMOVED','inactive on the platform'));
  v.appendChild(kp2);

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
  r2.appendChild(bars('Connection state', o.dist.connection, connBadge));
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

  // recent activity feed
  const r3 = el('div','chartwrap'); r3.style.marginTop='16px';
  const f1 = el('div','card');
  f1.appendChild(el('div','card-h','<h3>Latest changes</h3>'+
    `<span class="sub">${o.recent_changes.length} most recent</span>`));
  const fb = el('div','pad');
  if (!o.recent_changes.length) fb.appendChild(el('div','hint',
    'No changes yet — the first capture of each product is the baseline.'));
  else {
    const feed = el('div','feed');
    o.recent_changes.forEach(c=>{
      const it = el('div','feeditem');
      it.innerHTML = `<div class="dot3">⟳</div>
        <div style="min-width:0">
          <div style="font-weight:600">${esc(trunc(c.title))}</div>
          <div class="hint">${esc(fieldLabel(c.field_path))}</div>
          <div style="margin-top:3px">${valueBox(c.old_value, 'old', 'Value before')}
            <div class="arrow">→</div>${valueBox(c.new_value, null, 'Value after')}</div>
        </div>
        <div class="hint" style="text-align:right;white-space:nowrap">
          ${esc(when(c.detected_at))}<br>${esc(c.operator_email||'')}</div>`;
      feed.appendChild(it);
    });
    fb.appendChild(feed);
  }
  f1.appendChild(fb); r3.appendChild(f1);

  const f2 = el('div','card');
  f2.appendChild(el('div','card-h','<h3>Recent sync runs</h3>'));
  const sb = el('div','pad');
  if (!o.recent_syncs.length) sb.appendChild(el('div','hint','No runs yet.'));
  else {
    const NICE = {done:'Completed', running:'Running', paused_signed_out:'Signed out',
      paused_challenge:'Challenge', interrupted:'Interrupted', error:'Stopped',
      stopped:'Stopped'};
    const feed = el('div','feed');
    o.recent_syncs.forEach(s=>{
      const cls = s.status==='done'?'b-active':s.status==='running'?'b-pending'
        :s.status==='error'?'b-rejected':'b-stub';
      const it = el('div','feeditem');
      it.innerHTML = `<div class="dot3">⎘</div>
        <div><div style="font-weight:600">Run #${s.id}
            <span class="badge ${cls}" style="margin-left:6px">${esc(NICE[s.status]||s.status)}</span></div>
          <div class="hint">${s.products_seen} products · ${s.changes_found} changes ·
            ${esc(s.operator_email||'')}</div></div>
        <div class="hint" style="white-space:nowrap">${esc(when(s.started_at))}</div>`;
      feed.appendChild(it);
    });
    sb.appendChild(feed);
  }
  f2.appendChild(sb); r3.appendChild(f2);
  v.appendChild(r3);

  // sidebar counters
  $('#cntProducts').textContent = K.products.value;
  $('#cntChanges').textContent = K.changes.value;
  $('#cntPlatforms').textContent = o.coverage.length;
}

