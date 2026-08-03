import { S } from '../state.js';
import { $, api, el, esc } from '../core.js';
import { rows, sub } from '../format.js';
import { skeleton } from '../ui.js';
import { toast } from '../toast.js';

/* ======================= reports =======================
   This page answers one question: WHO DID WHAT WORK, AND WHAT IS IT WORTH.

   The old version put every kind of work in one "units" column and totalled it. That
   total was meaningless: one unit of "audit sync run" is one product checked by a
   machine, one unit of "quality issue fixed" is a person editing a field. Adding them
   gave a number like 773 next to a payable figure of 3.00, and no way to see why.

   So paid work and automatic activity are now counted separately, and the rate card
   that turns work into money is shown on the page instead of living in config.py where
   nobody using the dashboard can see it.                                              */

export async function viewReports(){
  const v = $('#v-reports');
  if (!v.dataset.painted) skeleton(v, 'rows', 'reports');
  const ps = new URLSearchParams();
  if (S.rsince) ps.set('since', S.rsince);
  if (S.runtil) ps.set('until', S.runtil);
  const d = await api('/api/reports?' + ps);
  v.dataset.painted = '1';
  v.innerHTML = '';

  /* ---- what this page is, before any numbers ---- */
  const intro = el('div','card'); intro.style.marginBottom = '16px';
  const ib = el('div','pad');
  ib.innerHTML = `<div style="font-weight:600;margin-bottom:6px">What this page shows</div>
    <div class="hint" style="line-height:1.7">
      A record of work done on the products, and what that work is worth.<br>
      Two things are counted, and they are <b>not</b> the same:
      <ul class="plain" style="margin:8px 0 0">
        <li><b>Paid work</b> — someone corrected or improved a product. Each type has a
            rate (see the table below), so this turns into an amount.</li>
        <li><b>Automatic checks</b> — the tool visiting products to look for changes.
            Useful to see, but nobody is paid per product checked, so it is kept out of
            the money column.</li>
      </ul></div>`;
  intro.appendChild(ib); v.appendChild(intro);

  /* ---- period ---- */
  const f = el('div','filters');
  f.innerHTML = `<span class="hint">Showing work from</span>
    <input type="text" id="rs" placeholder="YYYY-MM-DD" value="${esc(S.rsince)}" style="width:130px">
    <span class="hint">to</span>
    <input type="text" id="ru" placeholder="YYYY-MM-DD" value="${esc(S.runtil)}" style="width:130px">
    <button class="btn sm" id="rgo">Apply</button>
    <button class="btn ghost sm" id="rclr">All time</button>
    ${S.rsince||S.runtil ? '' : '<span class="pill">all time</span>'}`;
  v.appendChild(f);
  const reload = () => viewReports().catch(e => toast(e.message, {kind:'err'}));
  f.querySelector('#rgo').onclick = ()=>{ S.rsince=f.querySelector('#rs').value.trim();
    S.runtil=f.querySelector('#ru').value.trim(); reload(); };
  f.querySelector('#rclr').onclick = ()=>{ S.rsince=S.runtil=''; reload(); };

  /* ---- who did what ---------------------------------------------------------------
     Built from the per-type rows rather than the pre-summed totals, so paid work and
     automatic activity can be told apart. */
  const PAID = r => Number(r.unit_value) > 0;
  const people = {};
  (d.by_employee_type||[]).forEach(r=>{
    const p = people[r.employee] || (people[r.employee] =
      {name: r.employee, paidJobs: 0, amount: 0, checks: 0, kinds: []});
    if (PAID(r)){
      p.paidJobs += r.tasks; p.amount += Number(r.payable)||0;
      p.kinds.push(`${r.tasks}× ${r.task.toLowerCase()}`);
    } else {
      p.checks += Number(r.units)||0;
    }
  });
  (d.by_employee||[]).forEach(r=>{ if (people[r.employee]) people[r.employee].email = r.email; });
  const list = Object.values(people).sort((a,b)=>b.amount-a.amount);

  const c2 = el('div','card');
  c2.appendChild(el('div','card-h','<h3>Who did what</h3>'+
    '<span class="sub">in the period above</span>'));
  const b2 = el('div','pad');
  if (!list.length){
    b2.appendChild(el('div','empty','<div class="big">No work recorded in this period</div>'+
      'Work is recorded automatically when someone edits a product or runs a check. '+
      'Try widening the dates, or press “All time”.'));
  } else {
    const t = el('div','tblwrap');
    t.innerHTML = `<table><thead><tr>
        <th>Person</th><th>Paid jobs done</th><th>What they did</th>
        <th>Products checked<br><span class="hint" style="font-weight:400">automatic</span></th>
        <th>Amount earned</th></tr></thead><tbody>${
      list.map(p=>`<tr>
        <td><div style="font-weight:600">${esc(p.name)}</div>
            <div class="hint">${esc(p.email||'')}</div></td>
        <td class="v num">${p.paidJobs || '<span class="hint">—</span>'}</td>
        <td class="hint">${p.kinds.length ? esc(p.kinds.join(', ')) : '—'}</td>
        <td class="v num">${p.checks ? p.checks.toLocaleString() : '<span class="hint">—</span>'}</td>
        <td class="v num"><b>${p.amount ? p.amount.toFixed(2) : '0.00'}</b></td>
      </tr>`).join('')}</tbody></table>`;
    b2.appendChild(t);
  }
  c2.appendChild(b2); v.appendChild(c2);

  /* ---- the rate card: why the money column says what it says ---- */
  const rates = {};
  (d.by_employee_type||[]).forEach(r=>{ rates[r.code] = r; });
  const rateRows = Object.values(rates).filter(PAID);
  if (rateRows.length){
    const c3 = el('div','card'); c3.style.marginTop='16px';
    c3.appendChild(el('div','card-h','<h3>What each job is worth</h3>'+
      '<span class="sub">this is how the amount above is worked out</span>'));
    const b3 = el('div','pad');
    const t = el('div','tblwrap');
    t.innerHTML = `<table><thead><tr><th>Type of work</th><th>Rate for one</th>
      </tr></thead><tbody>${rateRows.map(r=>`<tr>
        <td>${esc(r.task)}</td>
        <td class="v num">${esc(Number(r.unit_value).toFixed(2))}</td></tr>`).join('')}
      </tbody></table>`;
    b3.appendChild(t);
    b3.appendChild(el('div','hint',
      'Amount earned = number of jobs × the rate. Rates are set by whoever runs the '
      + 'tool, in <span class="mono">config.py → TASK_TYPES</span>.'));
    c3.appendChild(b3); v.appendChild(c3);
  }

  /* ---- tours added over time ---- */
  const c1 = el('div','card'); c1.style.marginTop='16px';
  c1.appendChild(el('div','card-h','<h3>New tours added</h3>'+
    '<span class="sub">counted the month each one first appeared</span>'));
  const b1 = el('div','pad');
  if (!d.tours_created.length){
    b1.appendChild(el('div','hint','No tours recorded yet.'));
  } else {
    const max = Math.max(...d.tours_created.map(r=>r.tours));
    [...d.tours_created].reverse().forEach(r=>{
      const row = el('div','bar');
      row.innerHTML = `<div class="bar-top"><span class="nm">${esc(r.month)}</span>
        <span class="vl">${r.tours}</span></div>
        <div class="track"><div class="fill" style="width:${r.tours/max*100}%"></div></div>`;
      b1.appendChild(row);
    });
    b1.appendChild(el('div','hint',
      'A “tour” is the thing being sold. The same tour listed on two platforms is still '
      + 'one tour — that is why this number is lower than the product count.'));
  }
  c1.appendChild(b1); v.appendChild(c1);
}
