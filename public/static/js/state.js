/* Shared mutable UI state.

   One object rather than a pile of exported `let`s: an ES module import is a read-only
   binding, so a view could never reassign an imported `ACCT`. Mutating a property on a
   shared object works from anywhere and keeps the state discoverable in one place. */
export const S = {
  acct: localStorage.getItem('acct') || '',   // account filter, remembered across restarts
  tab: 'stats',
  session: null,          // open browser session token
  accounts: [],           // last /api/accounts payload
  source: '',             // backend name, blank until /api/storage confirms it
  editor: localStorage.getItem('editorEmail') || '',
  opEmail: localStorage.getItem('opEmail') || '',
  // product filters. `lifecycle` is the canonical status (LIVE/DRAFT/...), the
  // same word the dashboard cards use; `status` is the platform's own raw word.
  pf: {q: '', status: '', lifecycle: '', platform: '', connection: '', reviews: ''},
  mq: '',                 // platform-grid search
  rsince: '', runtil: '', // report period
};
