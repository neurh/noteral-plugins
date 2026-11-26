# Extending the interface

SDK 2 lets a plugin add real interface rather than only Markdown panels: right-sidebar tabs, status-bar widgets, editor blocks, page-tree item types and Home widgets. Each of these is an **HTML view**, a sandboxed iframe you fill with your own HTML, CSS and script. The assistant uses the same methods, so anything it can build, a plugin can build too.

| Surface | Methods | Permission |
| --- | --- | --- |
| Right-sidebar tab | `sidebar.setTab`, `removeTab`, `openTab`, `setLayout`, `moveTab`, `list` | `ui.panel` (layout calls: `layout`) |
| Status-bar widget | `statusBar.setWidget`, `removeWidget`, `list` | `ui.status` |
| Editor block | `blocks.registerType`, `unregisterType`, `listTypes`, `insert`, `setData` | `blocks` (`insert`/`setData`: `editor.write`) |
| Page-tree item type | `nodes.registerType`, `unregisterType`, `listTypes`, `create`, `getData`, `setData` | `nodes` (`create`/`setData`: `pages.write`) |
| Home | `home.listViews`, `createView`, `updateView`, `setBackground`, `addWidget`, `updateWidget`, … | `home` |
| Appearance | `appearance.setTokens`, `styleComponent`, `addCss`, `removeCss`, `reset`, `listLayers`, `setLayer` | `appearance` |
| Databases | `databases.embed`, `addView`, `updateView`, `queryView`, `addProperty`, `updateProperty`, `checkFormula`, … | `databases.read` / `databases.write` |

Everything a plugin contributes belongs to it. Disabling or uninstalling the plugin removes all of it, and none of it can touch another plugin's contributions.

## A sidebar tab

```ts
import { Plugin, register } from "@noteral/sdk";

class Tasks extends Plugin {
  async onload() {
    await this.app.sidebar.setTab({
      id: "tasks",
      title: "Tasks",
      icon: "list-checks",           // any lucide icon name
      html: `
        <div class="n-col">
          <h3>Open tasks</h3>
          <ul class="n-list" id="list"></ul>
          <button class="primary" id="refresh">Refresh</button>
        </div>
        <script>
          async function load() {
            const hits = await noteral.app.search.query({ query: "TODO", limit: 20 });
            list.innerHTML = hits.map((h) => '<li><a data-id="' + h.pageId + '">' + h.title + '</a></li>').join("");
          }
          list.onclick = (e) => e.target.dataset.id && noteral.open(e.target.dataset.id);
          refresh.onclick = load;
          noteral.on("pages:changed", load);
          load();
        </script>`,
      open: true,
    });
  }
}
register(Tasks);
```

`markdown` + `actions` still work for simple panels. Pass `split: true` to open the tab in a new stacked group under the current one. Users can drag tabs between groups. `sidebar.setLayout({ groups: [{ tabs: [...], size: 0.6 }, …] })` arranges them from code. Built-in tab keys are `outline`, `backlinks`, `info` and `assistant`. Contributed tabs are keyed `plugin:<pluginId>:<id>`.

## The view runtime

Every HTML view gets `window.noteral`:

| Member | What it does |
| --- | --- |
| `noteral.props` | What the host passed in. Blocks, nodes and Home widgets get `{ data, … }`. |
| `noteral.app.<ns>.<method>(params)` | The App API, limited to the owner's approved permissions. |
| `noteral.setData(data)` | Saves the view's data. For blocks, nodes and Home widgets it is stored in the document. |
| `noteral.onProps(fn)` / `onTheme(fn)` | Called when the data changes or when light/dark switches. |
| `noteral.on(event, fn)` | App events (`document:changed`, `pages:changed`, …). |
| `noteral.post(name, payload)` | Sends a message to your plugin, which receives it as the `view:message` event. |
| `onMessage(fn)` | Receives `views.post(...)` messages from your plugin. |
| `noteral.open(target)` | Opens a page id, `noteral://page/<id>` or an `https://` URL. |

Views follow the app's theme automatically. Every token (`--bg`, `--text`, `--accent`, `--border`, `--radius-md`, `--font-ui`, …) is defined inside the frame. A small kit is also built in: `.n-card`, `.n-row`, `.n-col`, `.n-grid`, `.n-list`, `.n-chip`, `.n-muted`, `.n-faint`, and buttons with `.primary` / `.ghost`. Height follows the content (it grows and shrinks) unless the surface fills its space (full custom pages, Home widgets).

**Your CSS always wins.** The kit lives in a cascade layer (`@layer noteral`) and uses zero-specificity `:where()` selectors, so any rule you write overrides it, with no `!important` needed. The frame itself is **transparent**: `html` and `body` have no background, and the iframe follows the app's color scheme, so the browser doesn't paint a white or black canvas behind a view. If you want a card, give it a background yourself (`background: var(--bg-elevated)`).

**Surfaces.** `noteral.surface` (also `<html data-surface="…">`) tells a view where it is drawn: `page`, `block`, `sidebar`, `status`, `home` or `panel`. `noteral.fill` is `true` when the view should fill its box. Use them to adapt one view to several places:

```css
html[data-surface="status"] body { font-size: 12px; }   /* the kit is already compact there */
html[data-surface="page"] main { max-width: 960px; margin: 0 auto; }
```

A view's iframe is `sandbox="allow-scripts"` and has a CSP with no network access. It can't reach the app's DOM, storage or the internet. Anything outside the frame goes through `noteral.app`.

## Custom blocks

```ts
await this.app.blocks.registerType({
  type: "counter",
  title: "Counter",
  description: "A number you can bump",
  icon: "plus-circle",
  defaultData: { count: 0 },
  height: 64,
  html: `<button class="primary" id="b"></button>
    <script>
      const paint = () => b.textContent = "Clicked " + (noteral.props.data.count || 0) + "×";
      b.onclick = () => noteral.setData({ count: (noteral.props.data.count || 0) + 1 });
      noteral.onProps(paint); paint();
    </script>`,
});
```

The block shows up in the slash menu under its title. Its data is saved in the page (as a `custom` BlockNote block with `kind` and JSON `data`), so it is exported and synced with the document. `blocks.insert({ type, data })` adds one from code.

## Custom page types

`nodes.registerType({ type, title, icon, html, defaultData, layout })` adds an entry to the **New** menu in the page tree. `noteral.setData` persists an item's data (up to 1 MB). You can use this for boards, timers, sketches, dashboards, or anything that isn't a document.

| `layout` | What the item opens as |
| --- | --- |
| `"full"` (default) | Your view takes the **whole pane**: no title, cover or icon, and one scroll area (yours). `noteral.fill` is `true`. Size your root to `height: 100vh` and scroll inside it. |
| `"page"` | A normal page head (title, icon, cover) with your view under it at its natural height, scrolling with the page. Use this when the item reads like a document. |

```ts
await this.app.nodes.registerType({
  type: "kanban",
  title: "Board",
  icon: "lucide:kanban",
  layout: "full",
  defaultData: { columns: [{ title: "To do", cards: [] }] },
  html: `<style>
      body { margin: 0; height: 100vh; display: flex; gap: 12px; padding: 16px; overflow-x: auto; }
      .col { flex: 0 0 260px; background: var(--bg-sunken); border-radius: var(--radius-md); padding: 10px; }
    </style>
    <div id="board"></div>
    <script>/* render noteral.props.data, save with noteral.setData */</script>`,
});
```

The item's title still shows in the page tree, tabs and search. In a `full` view you can show it yourself from `noteral.props.title`.

## Menu items

Plugins can add items to five app menus: `page` (the ⋯ menu in a page header), `tree` (right-click in the page tree), `block` (the block handle menu), `tab` (a tab's context menu) and `status` (right-click on the status bar). Each item runs one of the plugin's commands, which receives a `MenuContext` describing what the menu was opened on.

```ts
this.addMenuItem({
  id: "word-count",
  menu: "block",
  title: "Count words in block",
  icon: "lucide:hash",
  blockTypes: ["paragraph", "heading"],
  run: async ({ pageId, blockId }) => {
    const text = await this.app.editor.getMarkdown({ pageId, blockIds: [blockId!] });
    await this.app.ui.notify({ message: `${text.split(/\s+/).filter(Boolean).length} words` });
  },
});
```

| `MenuContext` field | Set for |
| --- | --- |
| `menu` | Always: which menu it was. |
| `pageId`, `kind` (`page` · `folder` · `database` · `custom`) | Page, tree and tab menus; the page of a block. |
| `nodeType` | When `kind` is `custom`. |
| `blockId`, `blockType` | Block menu. A custom block's type is its registered `type`. |
| `tabKey` | Tab menu. |

Filter where an item appears with `kinds`, `nodeTypes` and `blockTypes`. Set `danger: true` for destructive actions (shown in red). Items can also be declared in the manifest (`contributes.menus`) so they show before the plugin loads. `menus.addItem` / `menus.removeItem` / `menus.list` do the same through the App API, which is what the assistant uses. Needs the `menus` permission.

## Options

Give users settings without building a screen. Declare fields in `contributes.settings` (or at runtime with `this.defineSettings([...])`) and they appear under **Plugins → Installed → Options** (the sliders button on the plugin's row), grouped by `section`, with a *Reset to defaults* button.

```ts
const options = await this.getOptions<{ format: string; notify: boolean }>();
this.onOptionsChange((next, changed) => {
  if (changed.includes("format")) this.refresh(next.format as string);
});
```

Field types are `toggle`, `text`, `textarea`, `number`, `slider` (`min`/`max`/`step`), `select` (`options: [{ value, label }]`) and `color`. Values are saved with the plugin's data, coerced to the field's type, and missing values fall back to `default`. Each change raises the `settings:changed` event. `getOptions` needs `settings.read`.

## Status-bar widgets

```ts
await this.app.statusBar.setWidget({ id: "clock", text: "12:00", icon: "clock", side: "right", order: 5 });
// or a live HTML widget, 16–480 px wide:
await this.app.statusBar.setWidget({ id: "pomodoro", html: "<span id=t>25:00</span><script>…</script>", width: 72 });
```

Set `command` on a text widget to run one of your commands when it's clicked.

## Home

Home views are grids of widgets on a background. With `home`, a plugin can create a view (`createView`), change its layout (`updateView`, including view-level `css`), set the background (presets, a solid color or a gradient), and add widgets. Widget types include notes, clocks, quick links, pages and an `html` widget, which is a view like the ones above and can persist its data. `home.widgetTypes()` lists them all.

## Appearance layers

Style changes are stored as **layers**, which the user can inspect, turn off or remove under *Plugins → Created*. A plugin's tokens, component styles and CSS go into its own layer, `plugin:<id>`, which is removed when the plugin is uninstalled.

```ts
await this.app.appearance.setTokens({ light: { accent: "#2f6f5e" }, dark: { accent: "#7cc4ae" } });
await this.app.appearance.styleComponent({ component: "sidebar", rules: { background: "var(--bg-sunken)" } });
```

`appearance.listTokens()` and `appearance.listComponents()` return the names you can target.

## Databases

Everything about a database is addressed by **name**: properties, options and view settings take the names the user sees (ids work too), and reads return names.

**Embedding.** `databases.embed({ pageId, databaseId?, title?, properties?, view?, position?, blockId? })` puts a database block in a page. With `databaseId` it links an existing database (any database in the workspace); without it, it creates a new database inside the page. `position` is `start`, `end` (default), `before` or `after` a `blockId` (or `anchor` text). It works whether or not the page is open. In the Markdown that `pages.get`, `pages.read` and `editor.getMarkdown` return, an embedded database is a line `<!-- database:<id> Title -->` and a custom block is `<!-- block:<blockId> kind -->`. Keep those lines when you write the Markdown back and the blocks survive; move them to move the blocks, delete them to remove them. A new `<!-- database:<id> -->` line also embeds that database.

**Views.** `addView` / `updateView` take `type` (`table`, `board`, `list`, `gallery`, `calendar`, `chart`, `custom`) and only the settings you pass:

- `filters` + `filterMode` (simple rules) and `advanced` (`{ mode: "and" | "or", items }`, where items are rules `{ property, op, value }` or nested groups, up to 4 levels). Both apply together. Date rules accept ISO dates, relative dates (`@today`, `@weekAgo`, …) and `within` ranges (`pastWeek`, `thisMonth`, …).
- `groupBy` on boards (select, multi-select, status, checkbox) and on tables, lists and galleries (any property), with `hiddenGroups`, `collapsedGroups`, `hideEmptyGroups`, `colorColumns`.
- `show` / `hide` / `order` / `widths` / `calcs`, `rowNumbers`, `wrap`, `showIcons`, `cardPreview`, `cardSize` (`small`, `medium`, `large`), `showFilterBar`, `limit` (rows before *Load more*), and `openIn` — where a row opens: `modal` (default), `side`, `tab` or `current`.
- `chart` for chart views: `{ kind, x, dateBucket, aggregate, y, series, stacked, normalize, cumulative, sort, limit, omitEmpty, smooth, labels, legend, grid, palette, height, goal, yMin, yMax, format, title }`. `kind` is bar, column, line, area, pie, donut, scatter, funnel, radar, heatmap or number; `aggregate` is count, countValues, countUnique, sum, average, median, min or max (the last five need a numeric `y`). `x` can also be `createdTime` or `lastEdited`. Passed fields merge into the current chart.
- `custom` for custom views: `{ html, height? }`, a fully custom HTML/CSS/JS view in a sandboxed frame. Its script reads `window.noteral.database`:

```js
const db = window.noteral.database;
// db.schema, db.view, db.rows — rows have id, title, icon, values (by property name) and cells (display text)
db.onChange((data) => render(data.rows));    // called with fresh { schema, view, rows } when the database changes
db.openRow(rowId);                            // open a row
await db.setValue(rowId, "Status", "Done");   // change one value (by property name)
await db.addRow({ Name: "New", Status: "Todo" });
```

`getView` returns every setting with property names, and `queryView` reads rows the way a view shows them (plus optional extra `filters`, `advanced`, `sorts`, `search`).

**Formulas.** A property of type `formula` computes its value from the row: `addProperty({ databaseId, name: "Left", type: "formula", formula: 'dateBetween(prop("Due"), now(), "days")', format?, dateFormat? })`. Refer to properties with `prop("Name")`. Formulas are checked when saved; an error names the problem and the offending part. `checkFormula({ databaseId, formula })` tries one without saving and returns its result type and sample values, and `formulaFunctions()` lists every function, one per line. Row reads include formula results (with `errors` per row when one fails); setting a formula value is an error. Renaming a property updates the formulas that use it, and `updateProperty({ type: "formula", formula })` turns an existing property into a formula.

## Testing before you ship

`plugins.test({ manifest, code, styles })` runs a plugin in a throwaway frame and reports `{ ok, error, logs, contributions }` without installing it. `plugins.logs({ id })` returns a running plugin's recent console output and errors. The assistant runs every plugin it writes through `plugins.test` before installing it, and it fixes and retries when the test fails.
