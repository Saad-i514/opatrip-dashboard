/* Read-only deployment: Add Account & Spreadsheet import modal. */
import { $, esc, post, invalidate } from './core.js';
import { S } from './state.js';
import { loadAccounts } from './ui.js';
import { toast } from './toast.js';
import { go } from './app.js';

/* Filled from /api/status so the name and address have ONE source — config.py on the
   server. These defaults only show if the status call has not landed yet. */
export const OWNER = {name: 'Maniha', role: 'Head of Automation Department',
                      email: 'maniha@opatrip.com'};
export function setOwner(o){ if (o && o.email) Object.assign(OWNER, o); }

export function openAddAccountModal(){
  const host = $('#modalHost');
  if (!host) return;
  host.innerHTML = '';
  const tpl = $('#tplAdd');
  if (!tpl) return;
  host.appendChild(tpl.content.cloneNode(true));
  const close = () => { host.innerHTML = ''; };
  host.querySelector('.scrim').onclick = close;
  host.querySelector('#mCancel').onclick = close;

  const acctChoice = host.querySelector('#mAcctChoice'),
        newFields = host.querySelector('#mNewAcctFields'),
        newName = host.querySelector('#mNewAcctName'),
        newId = host.querySelector('#mNewAcctId'),
        newCountry = host.querySelector('#mNewAcctCountry'),
        sheetUrl = host.querySelector('#mSheetUrl'),
        csvFile = host.querySelector('#mCsvFile'),
        err = host.querySelector('#mErr'),
        goBtn = host.querySelector('#mGo');

  // Populate accounts
  acctChoice.innerHTML = '<option value="">-- Select an existing account --</option>' +
    (S.accounts || []).map(a => `<option value="${esc(a.viator_account_id)}">${esc(a.name || a.viator_account_id)}</option>`).join('') +
    '<option value="__NEW__">+ Create a new account...</option>';

  if (S.acct) acctChoice.value = S.acct;

  acctChoice.onchange = () => {
    newFields.classList.toggle('hidden', acctChoice.value !== '__NEW__');
    if (acctChoice.value === '__NEW__') newName.focus();
  };
  if (acctChoice.value === '__NEW__') newFields.classList.remove('hidden');

  newName.oninput = () => {
    if (!newId.dataset.edited) {
      newId.value = (newName.value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }
  };
  newId.oninput = () => { newId.dataset.edited = '1'; };

  let fileContent = null;
  csvFile.onchange = (e) => {
    const f = e.target.files[0];
    if (f) {
      const reader = new FileReader();
      reader.onload = () => { fileContent = reader.result; };
      reader.readAsText(f);
    } else {
      fileContent = null;
    }
  };

  const submit = async () => {
    err.className = 'banner hidden';
    const choice = acctChoice.value;
    if (!choice) {
      err.className = 'banner';
      err.textContent = 'Please choose an existing account or select "+ Create a new account".';
      acctChoice.focus();
      return;
    }
    let targetAcctId = choice;
    let targetAcctName = '';
    let targetCountry = '';

    if (choice === '__NEW__') {
      targetAcctName = (newName.value || '').trim();
      targetAcctId = (newId.value || '').trim() || targetAcctName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      targetCountry = (newCountry.value || '').trim();
      if (!targetAcctName || !targetAcctId) {
        err.className = 'banner';
        err.textContent = 'Please enter a name and ID for the new account.';
        (targetAcctName ? newId : newName).focus();
        return;
      }
    }

    const urlVal = (sheetUrl.value || '').trim();
    if (!urlVal && !fileContent) {
      err.className = 'banner';
      err.textContent = 'Please provide a Google Spreadsheet link or choose a CSV file to upload.';
      sheetUrl.focus();
      return;
    }

    goBtn.disabled = true;
    goBtn.textContent = 'Importing data...';

    try {
      const payload = {
        account_choice: choice === '__NEW__' ? 'new' : 'existing',
        account_id: targetAcctId,
        account_name: targetAcctName || null,
        country: targetCountry || null,
        spreadsheet_url: urlVal || null,
        csv_content: fileContent || null,
      };
      const res = await post('/api/spreadsheet/import', payload);
      close();
      toast(res.message || 'Spreadsheet imported successfully!', 'ok');
      invalidate();
      S.acct = res.account_id || targetAcctId;
      localStorage.setItem('acct', S.acct);
      await loadAccounts();
      go('products');
    } catch(ex) {
      err.className = 'banner';
      err.textContent = ex.message || 'Failed to import spreadsheet.';
      goBtn.disabled = false;
      goBtn.textContent = 'Import Spreadsheet';
    }
  };

  goBtn.onclick = submit;
}

/** Point Add Account to the spreadsheet import modal. */
export function installReadOnly(){
  const btn = $('#btnAdd');
  if (btn) {
    btn.disabled = false;
    btn.onclick = openAddAccountModal;
    btn.title = 'Add an account and import listings from a Google Spreadsheet';
  }
}
