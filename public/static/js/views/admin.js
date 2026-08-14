/* The Admin panel: who can sign in, what they are called, and what they are allowed to
   see. Only an administrator can open it — the tab is hidden for everyone else and the
   server refuses the requests behind it either way.

   Written in the same plain language as the rest of the dashboard: "Everything" and
   "Only their own accounts" rather than "scope: all|own". */
import { $, api, del, el, esc, patch, post, session } from '../core.js';
import { skeleton } from '../ui.js';
import { toast, confirmDialog } from '../toast.js';

const ROLE_TEXT = {
  admin:  ['Administrator', 'Can manage people and see everything'],
  member: ['Team member',   'Can use the dashboard, but not manage people'],
};
const SCOPE_TEXT = {
  all: ['Everything', 'Sees every account, and every change'],
  own: ['Only their own accounts', 'Sees only the accounts they have captured themselves'],
};

export async function viewAdmin(){
  const v = $('#v-admin');
  skeleton(v, 'rows', 'the people who can sign in');
  let d;
  try { d = await api('/api/admin/users'); }
  catch(e){
    v.innerHTML = `<div class="card empty"><div class="big">Administrators only</div>${
      esc(e.message)}</div>`;
    return;
  }
  v.innerHTML = '';

  const admins = d.users.filter(u => u.role === 'admin').length;
  const tiles = el('div','tiles');
  [['People', d.users.length, 'can sign in to this dashboard'],
   ['Administrators', admins, 'can manage people'],
   ['See everything', d.users.filter(u => u.scope === 'all').length, 'all accounts'],
   ['Own accounts only', d.users.filter(u => u.scope === 'own').length,
    'just what they captured']]
   .forEach(([l,n,s]) => tiles.appendChild(el('div','tile',
     `<div class="l">${esc(l)}</div><div class="n">${n}</div>
      <div class="s">${esc(s)}</div>`)));
  v.appendChild(tiles);

  const card = el('div','card');
  const head = el('div','card-h');
  head.innerHTML = `<h3>People</h3>
    <span class="sub">everyone who can sign in</span><span style="flex:1"></span>`;
  const addBtn = el('button','btn primary sm','+ Add person');
  addBtn.onclick = () => personForm(null);
  head.appendChild(addBtn);
  card.appendChild(head);

  const wrap = el('div','tblwrap');
  wrap.innerHTML = `<table><thead><tr><th>Name</th><th>Email</th><th>Role</th>
    <th>Can see</th><th>Last signed in</th><th></th></tr></thead><tbody>${
    d.users.map(u => {
      const [rl] = ROLE_TEXT[u.role] || [u.role];
      const [sc] = SCOPE_TEXT[u.scope] || [u.scope];
      const isMe = u.id === (d.me || {}).id;
      return `<tr>
        <td><div style="display:flex;gap:10px;align-items:center">
          <span class="av-sm">${esc((u.name||'?')[0].toUpperCase())}</span>
          <b>${esc(u.name)}</b>${isMe?'<span class="badge b-stub">you</span>':''}</div></td>
        <td class="hint">${esc(u.email)}</td>
        <td><span class="badge ${u.role==='admin'?'b-active':'b-draft'}">${esc(rl)}</span></td>
        <td><span class="badge ${u.scope==='all'?'b-conn':'b-draft'}">${esc(sc)}</span></td>
        <td class="hint" style="white-space:nowrap">${
          u.last_sign_in_at ? esc(String(u.last_sign_in_at).replace('T',' ').slice(0,16))
                            : 'never'}</td>
        <td style="white-space:nowrap">
          <button class="btn sm ghost" data-edit="${esc(u.id)}">Edit</button>
          ${isMe?'':`<button class="btn sm ghost danger" data-del="${esc(u.id)}">Remove</button>`}
        </td></tr>`;}).join('')}</tbody></table>`;
  card.appendChild(wrap); v.appendChild(card);

  wrap.querySelectorAll('[data-edit]').forEach(b => b.onclick = () =>
    personForm(d.users.find(u => u.id === b.dataset.edit)));
  wrap.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const u = d.users.find(x => x.id === b.dataset.del);
    if (!await confirmDialog({
      title: `Remove ${u.name}?`,
      body: `${esc(u.email)} will no longer be able to sign in. Everything they have `
          + `already captured or edited stays exactly as it is — this only takes away `
          + `their access.`,
      okLabel: 'Remove them', danger: true})) return;
    try { await del(`/api/admin/users/${u.id}`); toast(`${u.name} removed`, {kind:'ok'});
          viewAdmin(); }
    catch(e){ toast('Could not remove them', {kind:'err', detail:e.message}); }
  });

  v.appendChild(el('div','hint',
    '<b>What “Can see” means.</b> “Everything” shows every account and every change in '
    + 'the whole dashboard. “Only their own accounts” shows just the accounts that person '
    + 'has captured themselves — their products, their changes, their totals. It updates '
    + 'by itself as they capture more, so there is no list to maintain.'));
}

/* One form for both adding and editing — the fields are the same, and two nearly
   identical forms is how they drift apart. */
function personForm(user){
  const editing = !!user;
  const host = $('#modalHost'); host.innerHTML = '';
  const wrap = el('div');
  const radio = (name, table, current) => Object.entries(table).map(([val,[lab,why]]) => `
    <label class="pick ${current===val?'on':''}">
      <input type="radio" name="${name}" value="${val}" ${current===val?'checked':''}>
      <span><b>${esc(lab)}</b><span class="hint">${esc(why)}</span></span></label>`).join('');
  wrap.innerHTML = `<div class="scrim"></div>
    <div class="modal card wide">
      <h2 style="font-size:19px;margin-bottom:4px">${
        editing ? 'Edit ' + esc(user.name) : 'Add a person'}</h2>
      <p class="hint" style="margin:0 0 18px">${editing
        ? 'Change their name, what they can see, or give them a new password.'
        : 'They will be able to sign in straight away with the password you set here.'}</p>
      <label class="fl">Full name
        <input type="text" id="pName" placeholder="Maniha Hussain"
               value="${esc(editing ? user.name : '')}">
        <span class="hint">Shown against every change they make.</span></label>
      <label class="fl">Email
        <input type="email" id="pEmail" placeholder="name@opatrip.com"
               value="${esc(editing ? user.email : '')}" ${editing ? 'disabled' : ''}>
        <span class="hint">${editing
          ? 'The email cannot be changed — past changes are recorded against it.'
          : 'This is what they sign in with.'}</span></label>
      <label class="fl">${editing ? 'New password' : 'Password'}
        <input type="text" id="pPass" placeholder="${
          editing ? 'leave blank to keep the current one' : 'at least 8 characters'}">
        <span class="hint">Write it down and give it to them — it cannot be read back
          later.</span></label>
      <div class="fl"><span class="picklabel">Role</span>
        <div class="picks">${radio('role', ROLE_TEXT, editing ? user.role : 'member')}</div></div>
      <div class="fl"><span class="picklabel">What they can see</span>
        <div class="picks">${radio('scope', SCOPE_TEXT, editing ? user.scope : 'own')}</div></div>
      <div id="pErr" class="banner hidden" style="margin:6px 0 14px"></div>
      <div style="display:flex;gap:9px;justify-content:flex-end">
        <button class="btn ghost" id="pCancel">Cancel</button>
        <button class="btn primary" id="pGo">${editing ? 'Save changes' : 'Add person'}</button>
      </div></div>`;
  host.appendChild(wrap);
  const close = () => { host.innerHTML = ''; };
  wrap.querySelector('.scrim').onclick = close;
  $('#pCancel').onclick = close;
  // keep the chosen card highlighted
  wrap.querySelectorAll('.pick input').forEach(i => i.onchange = () => {
    wrap.querySelectorAll(`.pick input[name="${i.name}"]`)
        .forEach(x => x.closest('.pick').classList.toggle('on', x.checked));
    // an administrator sees everything by definition; saying otherwise would be a lie
    if (i.name === 'role') syncScope();
  });
  const syncScope = () => {
    const isAdmin = wrap.querySelector('input[name=role]:checked').value === 'admin';
    wrap.querySelectorAll('input[name=scope]').forEach(x => {
      x.disabled = isAdmin;
      if (isAdmin) x.checked = x.value === 'all';
      x.closest('.pick').classList.toggle('on', x.checked);
      x.closest('.pick').classList.toggle('muted', isAdmin && x.value !== 'all');
    });
  };
  syncScope();

  $('#pGo').onclick = async () => {
    const err = $('#pErr'), go = $('#pGo');
    const body = {
      name: $('#pName').value.trim(),
      role: wrap.querySelector('input[name=role]:checked').value,
      scope: wrap.querySelector('input[name=scope]:checked').value,
    };
    const pass = $('#pPass').value;
    if (pass) body.password = pass;
    if (!editing){
      body.email = $('#pEmail').value.trim();
      if (!body.email){ err.className='banner';
        err.textContent = 'Please enter the email they will sign in with.'; return; }
      if (!pass || pass.length < 8){ err.className='banner';
        err.textContent = 'Please set a password of at least 8 characters.'; return; }
    }
    go.disabled = true; go.textContent = 'Saving…';
    try{
      if (editing) await patch(`/api/admin/users/${user.id}`, body);
      else await post('/api/admin/users', body);
      close();
      toast(editing ? 'Saved' : `${body.name || body.email} can now sign in`, {kind:'ok'});
      viewAdmin();
    }catch(e){
      err.className = 'banner'; err.textContent = e.message;
      go.disabled = false; go.textContent = editing ? 'Save changes' : 'Add person';
    }
  };
}
