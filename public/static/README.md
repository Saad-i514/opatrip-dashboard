# Dashboard front-end

`dashboard.html` is now a ~110-line shell. Everything else lives here, split by concern so
a change touches one small file instead of a 2,600-line monolith.

```
static/
  css/
    base.css        design tokens (colours, radius, shadow) + reset + typography
    layout.css      app shell: sidebar, topbar, hero
    components.css  cards, badges, buttons, tables, forms, edit grid, photo manager
    loading.css     progress bar, loading chip, skeletons, toasts, sync progress
  js/
    state.js        shared mutable UI state  ← read this first
    core.js         $, el, esc, api/post, the loading indicator
    format.js       value + label formatting, badges
    charts.js       hand-rolled SVG: sparkline, donut, area chart
    ui.js           skeletons, account/session loading, the account filter bar
    sections.js     per-product detail renderers (Overview, Pricing, Booking, …)
    edit.js         editor identity, edit forms, photo upload/delete
    toast.js        toasts + confirm dialogs (replaces alert/confirm)
    progress.js     live sync progress bar with ETA
    views/          one file per screen; each exports one `viewX()`
    app.js          routing, polling, boot — the only <script> the page loads
```

## Shared state

ES module imports are **read-only bindings** — a view cannot reassign an imported `let`.
So all mutable state is properties on one exported object:

```js
import { S } from '../state.js';
S.acct = '197004';        // works everywhere
```

## Adding a view

1. Create `views/mything.js` exporting `export async function viewMyThing(){ … }`.
2. In `app.js`: import it, add it to `VIEWS` and `TITLES`.
3. Add a `<button class="navbtn" data-t="mything">` to the sidebar in `dashboard.html`
   and a `<section id="v-mything" class="hidden">` next to the others.

Nothing else changes. Routing, the filter bar and the loading indicator are automatic.

## Adding an editable field

Add one row to `EDITABLE_FIELDS` in `db.py`. The form, the drawer grid and validation all
read `/api/editable`, so **no front-end change is needed**.

```python
("supplier_ref", "Supplier reference", "text", "Workflow", None),
#  key           label                 type    group      options (for `select`)
```

Types: `text` · `textarea` · `select` · `date`.

## Loading states

`api()` in `core.js` registers every request, so any new endpoint gets the progress bar
and the "Loading … from Supabase" chip for free. Add a friendly noun to `WHAT` to name it.
Endpoints in `QUIET` (heartbeats) are deliberately excluded — otherwise the 2-second status
poll would show a permanent, meaningless spinner.

## Toasts

```js
import { toast, confirmDialog } from './toast.js';
toast('Saved', {kind: 'ok', detail: 'recorded against you@x.com'});
if (await confirmDialog({title: 'Delete?', danger: true})) …
```

`kind`: `ok` · `err` · `warn` · `info`. Use these rather than `alert()`/`confirm()`.

## Alignment

Field rows use `.editgrid` — a three-column grid (`label | value | action`). Buttons must
live in the third column, never inline after the text: inline buttons start wherever the
text ends, producing a ragged staircase. `uiedit.py` asserts the buttons share one
x-position, so a regression fails a test rather than merely looking wrong.
