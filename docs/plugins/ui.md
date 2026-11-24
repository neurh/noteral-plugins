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
| Database views | `databases.addView`, `updateView`, `queryView`, `updateProperty`, … | `databases.read` / `databases.write` |

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

Views follow the app's theme automatically. Every token (`--bg`, `--text`, `--accent`, `--border`, `--radius-md`, `--font-ui`, …) is defined inside the frame. A small kit is also built in: `.n-card`, `.n-row`, `.n-col`, `.n-grid`, `.n-list`, `.n-chip`, `.n-muted`, `.n-faint`, and buttons with `.primary` / `.ghost`. Height follows the content unless the surface fills its space (custom page types).

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

`nodes.registerType({ type, title, icon, html, defaultData })` adds an entry to the **New** menu in the page tree. Items of this type open full-height in your view, and `noteral.setData` persists their data (up to 1 MB). You can use this for boards, timers, sketches, dashboards, or anything that isn't a document.

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

## Testing before you ship

`plugins.test({ manifest, code, styles })` runs a plugin in a throwaway frame and reports `{ ok, error, logs, contributions }` without installing it. `plugins.logs({ id })` returns a running plugin's recent console output and errors. The assistant runs every plugin it writes through `plugins.test` before installing it, and it fixes and retries when the test fails.
