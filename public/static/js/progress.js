import { $, esc } from './core.js';
import { when } from './views/drawer.js';

/* ---------- live sync progress ----------
   A capture run takes tens of minutes across 25 accounts. "running" alone tells you
   nothing, so this shows how far along it is, how fast, and when it should finish —
   all derived from real counters, never guessed. */
export const secs = s => {
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s/60);
  return m < 60 ? `${m}m ${s%60}s` : `${Math.floor(m/60)}h ${m%60}m`;
};
export function renderSyncProgress(st){
  const host = $('#syncprogress'); if (!host) return;
  const active = st.busy || String(st.status||'').startsWith('paused');
  if (!active && st.status !== 'done'){ host.innerHTML=''; return; }
  if (st.status === 'done' && !st.total){ host.innerHTML=''; return; }

  const done = st.seen||0, total = st.total||0;
  const pct = total ? Math.min(100, Math.round(done/total*100)) : 0;
  const elapsed = st.started ? (Date.now()/1000 - st.started) : 0;
  const rate = (done && elapsed) ? done/elapsed : 0;          // products per second
  const eta = (rate && total > done) ? (total-done)/rate : null;
  const paused = String(st.status||'').startsWith('paused');
  const title = st.status === 'done' ? 'Capture complete'
    : paused ? 'Paused — needs you'
    : `Capturing account ${esc(st.account||'')}`;
  host.innerHTML = `<div class="syncbox">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <b style="color:#7C2D12;font-size:15px">${title}</b>
      ${st.sync_id?`<span class="badge b-stub">run #${st.sync_id}</span>`:''}
      <div class="grow" style="flex:1"></div>
      <b style="color:var(--accent-ink);font-size:19px;font-variant-numeric:tabular-nums">${pct}%</b>
    </div>
    <div class="pbar"><i style="width:${pct}%"></i></div>
    <div class="pstats">
      <span><b>${done}</b> of <b>${total||'?'}</b> products</span>
      ${st.changes?`<span><b>${st.changes}</b> change(s) found</span>`:''}
      ${elapsed?`<span>elapsed <b>${secs(elapsed)}</b></span>`:''}
      ${eta!=null?`<span>about <b>${secs(eta)}</b> left</span>`:''}
      ${rate?`<span><b>${(rate*60).toFixed(1)}</b>/min</span>`:''}
      ${st.current?`<span>now: <b class="mono">${esc(st.current)}</b></span>`:''}
    </div></div>`;
}

