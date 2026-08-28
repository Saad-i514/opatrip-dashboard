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

  const btnModeExisting = host.querySelector('#mBtnModeExisting'),
        btnModeNew = host.querySelector('#mBtnModeNew'),
        existingWrap = host.querySelector('#mExistingAcctWrap'),
        acctChoice = host.querySelector('#mAcctChoice'),
        newFields = host.querySelector('#mNewAcctFields'),
        newName = host.querySelector('#mNewAcctName'),
        newId = host.querySelector('#mNewAcctId'),
        newCountry = host.querySelector('#mNewAcctCountry'),
        sheetUrl = host.querySelector('#mSheetUrl'),
        dropZone = host.querySelector('#mDropZone'),
        csvFile = host.querySelector('#mCsvFile'),
        fileNameDisplay = host.querySelector('#mFileName'),
        err = host.querySelector('#mErr'),
        goBtn = host.querySelector('#mGo');

  // Populate accounts
  acctChoice.innerHTML = '<option value="">-- Choose an existing account --</option>' +
    (S.accounts || []).map(a => `<option value="${esc(a.viator_account_id)}">${esc(a.name || a.viator_account_id)}</option>`).join('');

  if (S.acct) acctChoice.value = S.acct;

  let mode = 'existing';
  const setMode = (m) => {
    mode = m;
    btnModeExisting.className = `btn sm ${m === 'existing' ? 'primary' : 'ghost'}`;
    btnModeNew.className = `btn sm ${m === 'new' ? 'primary' : 'ghost'}`;
    existingWrap.classList.toggle('hidden', m !== 'existing');
    newFields.classList.toggle('hidden', m !== 'new');
    if (m === 'new') newName.focus();
  };

  btnModeExisting.onclick = () => setMode('existing');
  btnModeNew.onclick = () => setMode('new');

  newName.oninput = () => {
    if (!newId.dataset.edited) {
      newId.value = (newName.value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }
  };
  newId.oninput = () => { newId.dataset.edited = '1'; };

  let filePayload = null;
  const handleFile = (f) => {
    if (!f) return;
    fileNameDisplay.classList.remove('hidden');
    fileNameDisplay.textContent = `✓ Selected: ${f.name} (${(f.size / 1024).toFixed(1)} KB)`;
    sheetUrl.value = ''; // clear URL input when file is selected
    
    if (f.name.endsWith('.xlsx') || f.name.endsWith('.xls')) {
      const reader = new FileReader();
      reader.onload = () => {
        const bytes = new Uint8Array(reader.result);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        filePayload = {
          filename: f.name,
          data_b64: btoa(binary),
          type: 'excel'
        };
      };
      reader.readAsArrayBuffer(f);
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        filePayload = {
          filename: f.name,
          data_csv: reader.result,
          type: 'csv'
        };
      };
      reader.readAsText(f);
    }
  };

  dropZone.onclick = () => csvFile.click();
  csvFile.onchange = (e) => handleFile(e.target.files[0]);

  dropZone.ondragover = (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--accent)'; };
  dropZone.ondragleave = () => { dropZone.style.borderColor = 'var(--line-2)'; };
  dropZone.ondrop = (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--line-2)';
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  };

  sheetUrl.oninput = () => {
    if (sheetUrl.value.trim()) {
      filePayload = null;
      csvFile.value = '';
      fileNameDisplay.classList.add('hidden');
    }
  };

  const submit = async () => {
    err.className = 'banner hidden';
    let targetAcctId = '';
    let targetAcctName = '';
    let targetCountry = '';

    if (mode === 'existing') {
      targetAcctId = acctChoice.value;
      if (!targetAcctId) {
        err.className = 'banner';
        err.textContent = 'Please choose an existing account from the dropdown.';
        acctChoice.focus();
        return;
      }
    } else {
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
    if (!urlVal && !filePayload) {
      err.className = 'banner';
      err.textContent = 'Please provide a Google Spreadsheet link or upload a spreadsheet file from your laptop.';
      sheetUrl.focus();
      return;
    }

    goBtn.disabled = true;
    goBtn.textContent = 'Importing data...';

    try {
      const payload = {
        account_choice: mode,
        account_id: targetAcctId,
        account_name: targetAcctName || null,
        country: targetCountry || null,
        spreadsheet_url: urlVal || null,
        csv_content: filePayload && filePayload.type === 'csv' ? filePayload.data_csv : null,
        file_b64: filePayload && filePayload.type === 'excel' ? filePayload.data_b64 : null,
        filename: filePayload ? filePayload.filename : null,
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
