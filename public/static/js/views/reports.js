import { S } from '../state.js';
import { $, api, el, esc } from '../core.js';
import { rows, sub } from '../format.js';
import { skeleton } from '../ui.js';
import { toast } from '../toast.js';

/* ======================= reports ======================= */

export async function viewReports(){
  const v = $('#v-reports');
  if (!v.dataset.painted) skeleton(v, 'rows', 'reports');
  const ps = new URLSearchParams();
  if (S.rsince) ps.set('since', S.rsince);
  if (S.runtil) ps.set('until', S.runtil);
  const d = await api('/api/reports?' + ps);
  v.dataset.painted='1';
  v.innerHTML = '';
  const f = el('div','filters');
  f.innerHTML = `<span class="hint">From</span>
    <input type="text" id="rs" placeholder="YYYY-MM-DD" value="${esc(S.rsince)}" style="width:130px">
    <span class="hint">to</span>
    <input type="text" id="ru" placeholder="YYYY-MM-DD" value="${esc(S.runtil)}" style="width:130px">
    <button class="btn sm" id="rgo">Apply</button>
    <button class="btn ghost sm" id="rclr">All time</button>`;
  v.appendChild(f);
  // Apply is fired straight from the button, so nothing else catches it: a rejected
  // request (e.g. a mistyped date) would otherwise leave the page frozen on the old
  // numbers with no explanation.
  const reload = () => viewReports().catch(e => toast(e.message, {kind:'err'}));
  f.querySelector('#rgo').onclick = ()=>{ S.rsince=f.querySelector('#rs').value.trim();
    S.runtil=f.querySelector('#ru').value.trim(); reload(); };
  f.querySelector('#rclr').onclick = ()=>{ S.rsince=S.runtil=''; reload(); };

  const g = el('div','grid2');
  // tours created per month
  const c1 = el('div','card');
  c1.appendChild(el('div','card-h','<h3>Tours created</h3><span class="sub">by month</span>'));
  const b1 = el('div','pad');
  if (!d.tours_created.length) b1.appendChild(el('div','hint','No tours recorded yet.'));
  else {
    const max = Math.max(...d.tours_created.map(r=>r.tours));
    d.tours_created.forEach(r=>{
      const row = el('div','bar');
      row.innerHTML = `<div class="bar-top"><span class="nm">${esc(r.month)}</span>
        <span class="vl">${r.tours}</span></div>
        <div class="track"><div class="fill" style="width:${r.tours/max*100}%"></div></div>`;
      b1.appendChild(row);
    });
  }
  c1.appendChild(b1); g.appendChild(c1);

  // per-employee totals
  const c2 = el('div','card');
  c2.appendChild(el('div','card-h','<h3>Work by person</h3>'+
    '<span class="sub">tasks, units and payable value</span>'));
  const b2 = el('div','pad');
  if (!d.by_employee.length) b2.appendChild(el('div','hint','No completed tasks in this period.'));
  else {
    const t = el('div','tblwrap');
    t.innerHTML = `<table><thead><tr><th>Person</th><th>Role</th><th>Tasks</th>
      <th>Units</th><th>Payable</th></tr></thead><tbody>${
      d.by_employee.map(r=>`<tr><td><div style="font-weight:600">${esc(r.employee)}</div>
        <div class="hint">${esc(r.email||'')}</div></td>
        <td class="hint">${esc(r.role||'')}</td>
        <td class="v num">${r.tasks}</td><td class="v num">${r.units}</td>
        <td class="v num"><b>${r.payable!=null?esc(r.payable):'—'}</b></td></tr>`).join('')}
      </tbody></table>`;
    b2.appendChild(t);
  }
  c2.appendChild(b2); g.appendChild(c2);
  v.appendChild(g);

  // per-employee per-task-type breakdown
  const c3 = el('div','card'); c3.style.marginTop='16px';
  c3.appendChild(el('div','card-h','<h3>Task breakdown</h3>'+
    '<span class="sub">what each person did, by type</span>'));
  const b3 = el('div','pad');
  if (!d.by_employee_type.length) b3.appendChild(el('div','hint','Nothing to break down yet.'));
  else {
    const t = el('div','tblwrap');
    t.innerHTML = `<table><thead><tr><th>Person</th><th>Task</th><th>Count</th>
      <th>Units</th><th>Rate</th><th>Payable</th></tr></thead><tbody>${
      d.by_employee_type.map(r=>`<tr><td>${esc(r.employee)}</td>
        <td>${esc(r.task)}<div class="mono hint">${esc(r.code)}</div></td>
        <td class="v num">${r.tasks}</td><td class="v num">${r.units}</td>
        <td class="v num">${esc(r.unit_value)}</td>
        <td class="v num"><b>${esc(r.payable)}</b></td></tr>`).join('')}
      </tbody></table>`;
    b3.appendChild(t);
    b3.appendChild(el('div','hint','Payable = units × rate. Rates live in '+
      '<span class="mono">config.py → TASK_TYPES</span>; add task types there.'));
  }
  c3.appendChild(b3); v.appendChild(c3);
}

