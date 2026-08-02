import { api, esc } from './core.js';
import { label, rows, sentence, sub } from './format.js';

/* ======================= charts (hand-rolled SVG) =======================
   No chart library: this app runs locally and must work with no network, and the shapes
   needed here are simple. Every chart is driven by real rows from /api/overview.        */
export const PALETTE = ['#F97316','#2563EB','#15803D','#B45309','#7C3AED','#DB2777','#0891B2','#65A30D'];

export function sparkline(vals, color){
  const w = 220, h = 36, n = vals.length;
  if (!n) return '';
  if (n === 1) vals = [vals[0], vals[0]];
  const max = Math.max(...vals, 1), min = Math.min(...vals, 0);
  const span = (max - min) || 1;
  const pts = vals.map((v,i)=>[i/(vals.length-1)*w, h - ((v-min)/span)*(h-6) - 3]);
  const line = pts.map(p=>`${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `0,${h} ${line} ${w},${h}`;
  const id = 'g'+Math.random().toString(36).slice(2,8);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity=".28"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <polygon points="${area}" fill="url(#${id})"/>
    <polyline points="${line}" fill="none" stroke="${color}" stroke-width="2"
      stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

export function donut(entries, size){
  size = size || 190;
  const total = entries.reduce((a,e)=>a+e[1],0);
  if (!total) return '<div class="hint">No data yet.</div>';
  const R = size/2, r = R*0.62, cx = R, cy = R;
  let a0 = -Math.PI/2, paths = '';
  entries.forEach(([k,v],i)=>{
    const a1 = a0 + (v/total)*Math.PI*2;
    const big = (a1-a0) > Math.PI ? 1 : 0;
    // a single full-circle slice can't be drawn as an arc — use two half arcs
    if (v === total){
      paths += `<circle cx="${cx}" cy="${cy}" r="${(R+r)/2}" fill="none"
        stroke="${PALETTE[i%PALETTE.length]}" stroke-width="${R-r}"/>`;
    } else {
      const p = (ang,rad)=>[cx+Math.cos(ang)*rad, cy+Math.sin(ang)*rad];
      const [x0,y0]=p(a0,R), [x1,y1]=p(a1,R), [x2,y2]=p(a1,r), [x3,y3]=p(a0,r);
      paths += `<path d="M${x0},${y0} A${R},${R} 0 ${big} 1 ${x1},${y1}
        L${x2},${y2} A${r},${r} 0 ${big} 0 ${x3},${y3} Z"
        fill="${PALETTE[i%PALETTE.length]}"><title>${esc(k)}: ${v}</title></path>`;
    }
    a0 = a1;
  });
  return `<div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap">
    <svg viewBox="0 0 ${size} ${size}" style="width:${size}px;height:${size}px;flex:none">
      ${paths}<text x="${cx}" y="${cy-2}" text-anchor="middle" font-size="26"
        font-weight="700" fill="#1C1917">${total}</text>
      <text x="${cx}" y="${cy+16}" text-anchor="middle" font-size="11"
        fill="#8A817A">total</text></svg>
    <div class="legend" style="flex-direction:column;gap:8px">${entries.map(([k,v],i)=>
      `<div><i style="background:${PALETTE[i%PALETTE.length]}"></i>
        <span style="flex:1">${esc(sentence(k))}</span>
        <b style="margin-left:8px">${v}</b>
        <span class="hint">${Math.round(v/total*100)}%</span></div>`).join('')}</div></div>`;
}

export function areaChart(series, color){
  const w = 640, h = 170, pad = 26;
  if (!series.length) return '<div class="hint">Nothing recorded yet.</div>';
  // A single day would otherwise draw a diagonal down to zero, implying a decline that
  // isn't in the data. Mirror the point so it reads as a flat line across the period.
  if (series.length === 1) series = [series[0], series[0]];
  const vals = series.map(s=>s.n);
  const max = Math.max(...vals, 1);
  const step = series.length > 1 ? (w-pad*2)/(series.length-1) : 0;
  const pts = series.map((s,i)=>[pad+i*step, h-pad-(s.n/max)*(h-pad*2)]);
  const line = pts.map(p=>`${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const id = 'a'+Math.random().toString(36).slice(2,8);
  const grid = [0,.5,1].map(f=>{
    const y = h-pad-f*(h-pad*2);
    return `<line x1="${pad}" x2="${w-pad}" y1="${y}" y2="${y}" stroke="#EBE5DC"/>
      <text x="4" y="${y+4}" font-size="10" fill="#8A817A">${Math.round(max*f)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto">
    <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity=".3"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    ${grid}
    <polygon points="${pad},${h-pad} ${line} ${w-pad},${h-pad}" fill="url(#${id})"/>
    <polyline points="${line}" fill="none" stroke="${color}" stroke-width="2.5"
      stroke-linejoin="round"/>
    ${pts.map((p,i)=>`<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="#fff"
      stroke="${color}" stroke-width="2"><title>${esc(series[i].d)}: ${series[i].n}</title>
      </circle>`).join('')}
    ${series.map((s,i)=>i%Math.ceil(series.length/6||1)===0
      ? `<text x="${pts[i][0]}" y="${h-6}" font-size="10" fill="#8A817A"
          text-anchor="middle">${esc(s.d.slice(5))}</text>` : '').join('')}
  </svg>`;
}

export const STATUS_COLOR = {LIVE:'#15803D', PENDING:'#B45309', DRAFT:'#8A817A',
  REJECTED:'#B91C1C', REMOVED:'#7C2D12', NOT_LISTED:'#DED6C9'};

export function kpiCard(icon, tint, label, k){
  const d = k.delta;
  const chip = d === null || d === undefined ? ''
    : `<span class="chip ${d>0?'chip-up':d<0?'chip-dn':'chip-flat'}">${
        d>0?'↗':d<0?'↘':'–'} ${Math.abs(d)}%</span>`;
  return `<div class="kpi">
    <div class="row1"><div class="ic" style="background:${tint}">${icon}</div>${chip}</div>
    <div class="n">${k.value}${k.suffix||''}</div>
    <div class="l">${esc(label)}</div>
    <div class="s">${esc(k.sub||'')}</div>
    ${k.spark||''}</div>`;
}

