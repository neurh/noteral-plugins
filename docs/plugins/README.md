# Writing Noteral plugins

Noteral plugins are small JavaScript bundles that run in a sandboxed iframe and talk to the app through a versioned API (**SDK 2.3.0**). A plugin can read and edit pages (blocks, text, formatting, the cursor and selection), query and reshape databases (views, filters, sorts, properties), add commands with keyboard shortcuts, sidebar tabs, status-bar widgets, editor blocks, page-tree item types and Home widgets, restyle the app, call the network (including a local server with `network.local`), keep private data in its own storage, add `@`-style suggestion menus to the editor, expose an API to other plugins, and react to page lifecycle events. It can do only what its manifest declares and the user approved.

- **[Manifest](manifest.md)**: every `manifest.json` field
- **[Extending the interface](ui.md)**: sidebar tabs, status-bar widgets, custom blocks, custom page types, Home, appearance layers, testing
- **[Publishing](publishing.md)**: `npm run release` and `npm run submit`, using the GitHub CLI, GitHub Releases and the community registry
- **[Databases](../databases.md)**: views, filters, formulas, charts, custom views and embedding from code
- **[API reference](../sdk/api-reference.md)**: every method, event, permission and type, generated from the source
- **[llms.txt](../sdk/llms.txt)** / **[llms-full.txt](../sdk/llms-full.txt)**: the same material for coding agents

## How it fits together

```
manifest.json ──► Noteral checks id, version, sdkVersion, minAppVersion, permissions
main.js       ──► loaded into a sandboxed <iframe sandbox="allow-scripts"> (no DOM access to the app,
                  no Node, no same-origin storage). It talks to the app over postMessage:

   this.app.pages.create({ title })  ─►  host: permission check → schema validation → handler
                                     ◄─  result (or NoteralError with a code)
```

- Every call is checked against the permissions the user approved and validated against a JSON schema. A plugin cannot reach a method it didn't ask for.
- A plugin that throws, hangs at startup (6 s) or in a command (30 s), or crashes its iframe is marked **failed** in *Plugins → Installed* and can be restarted. It cannot take the app down.
- Disabling or uninstalling a plugin runs `onunload()`. It then removes every command, status item, panel, style and event listener the plugin registered.

## Quick start

```bash
git clone https://github.com/neurh/noteral-plugins        # docs, SDK types, CLI, examples, registry
node noteral-plugins/sdk/cli/noteral-plugin.mjs init my-plugin --github   # new public repo with a working plugin
cd my-plugin
npm run build                              # src/main.ts → main.js
npm run check                              # the store's validation, locally
zip my-plugin.zip manifest.json main.js    # add styles.css if you have one
```

In Noteral, open **Plugins** (puzzle icon in the left rail) → **Install from file**, then pick the zip. Review the permissions and approve. Rebuild and reinstall the zip to try a change. Installing the same id again replaces the plugin and keeps its saved data.

The starter's `src/noteral.ts` maps the SDK that the host injects at runtime (`window.Noteral`), so a standalone repo builds without installing anything. In this repo, `examples/*` import `@noteral/sdk` directly, and `sdk/tsconfig.json` maps it to `sdk/src/index.ts`. For types in your own repo, point `paths` at a Noteral checkout (see `examples/starter/README.md`).

## A complete plugin

```ts
import { Plugin, register } from "./noteral"; // or "@noteral/sdk" inside this repo

interface Data { wpm: number }

class ReadingTime extends Plugin {
  private wpm = 230;

  async onload() {
    this.wpm = (await this.loadData<Data>()).wpm ?? 230;

    this.addCommand({
      id: "set-speed",
      title: "Reading time: set reading speed",
      run: async () => {
        const answer = await this.app.ui.prompt({ title: "Words per minute", value: String(this.wpm) });
        const wpm = Number(answer);
        if (!answer || !Number.isFinite(wpm) || wpm < 50) return;
        this.wpm = wpm;
        await this.saveData<Data>({ wpm });
        await this.refresh();
      },
    });

    this.registerEvent("document:changed", () => void this.refresh());
    this.registerEvent("page:opened", () => void this.refresh());
    await this.refresh();
  }

  private async refresh() {
    const doc = await this.app.editor.snapshot();
    const minutes = doc ? Math.max(1, Math.round(doc.wordCount / this.wpm)) : 0;
    await this.setStatus("reading-time", doc ? `${minutes} min read` : "", { title: `${this.wpm} wpm` });
  }
}

register(ReadingTime);
```

The full version lives in `examples/reading-time/`. `examples/meeting-notes/` shows writing into pages. Neither ships with the app; they're examples to copy.

## The `Plugin` class

Extend `Plugin`, do your setup in `onload()`, and end the file with `register(YourPlugin)`. Everything registered through these helpers is disposed of automatically on unload.

| Member | What it does | Needs |
| --- | --- | --- |
| `onload()` | Called once when the plugin starts. May be `async`; startup must finish within 6 s. | – |
| `onunload()` | Called when the plugin is disabled, updated or uninstalled. Clean up anything you made yourself. | – |
| `app` | The typed App API: `this.app.<namespace>.<method>(params)`. | per method |
| `manifest` | Your parsed `manifest.json`. | – |
| `addCommand({ id, title, description?, keywords?, shortcut?, run })` | Adds a command to the command palette (Ctrl/⌘ K) and the slash menu. `id` is local to your plugin. `run` gets a `MenuContext` when a menu item triggered it. `shortcut` binds a key, e.g. `"Mod+Shift+K"` (see [Shortcuts](#shortcuts)). | – |
| `addMenuItem({ id, menu, title, icon?, kinds?, nodeTypes?, blockTypes?, danger?, run })` | Adds an item to the page, tree, block, tab or status-bar menu. `run(context)` gets what the menu was opened on. See [Menu items](ui.md#menu-items). | `menus` |
| `getOptions()` / `defineSettings(fields)` / `onOptionsChange(fn)` | Read the user's values from your **Options** screen, add fields at runtime, react to edits. See [Options](ui.md#options). | `settings.read` |
| `registerEvent(name, handler)` | Subscribes to an app event (see below). Returns a disposer. | event's permission |
| `registerInterval(fn, ms)` | `setInterval` that is cleared on unload. | – |
| `register(disposer)` | Runs a function on unload. | – |
| `setStatus(itemId, text, { title? })` | Sets a status-bar item. An empty string hides it. | `ui.status` |
| `setPanel(panelId, { title?, markdown, actions? })` | Renders Markdown in a right-sidebar panel, with optional buttons. | `ui.panel` |
| `onPanelAction(panelId, handler)` | Called with the action id when a panel button is pressed. | `ui.panel` |
| `onViewMessage(handler)` | Called with `(name, payload, view)` when one of your [HTML views](ui.md) calls `noteral.post`. | – |
| `addStyles(css)` | Injects CSS into the app. It is removed on unload. | `ui.styles` |
| `notify(message, kind?)` | Shows a toast (`info`, `success`, `error`). | `ui.notify` |
| `loadData()` / `saveData(patch)` | Small settings object (≤ 64 KB) shared by all workspaces. | `settings.read` / `settings.write` |
| `storage.get/set/delete/list/clear/usage` | Private key/value storage for larger data: any JSON up to 8 MB per key, 64 MB per plugin, per workspace or global. See [Storage](#storage). | – |
| `readFile(path, encoding?)` | Reads a file you shipped in the bundle (`"text"` or `"base64"`). | – |
| `registerSuggester({ id, trigger }, getItems, onSelect?)` | An inline menu when the user types `trigger` (`@`, `#`, `[`…) in a page. See [Suggesters](#suggesters). | `editor.read` |
| `exposeApi({ name: handler })` / `callPlugin(id, method, args)` | Let other plugins call you, or call them. See [Plugins working together](#plugins-working-together). | – |

Status items and panels you want to show must also be declared under `contributes` in the manifest, so the user sees them in the review screen. Commands can be static (`contributes.commands`) or dynamic (`addCommand`). If both use the same id, `addCommand` supplies the handler.

### Older plugins

SDK 1.x plugins (`definePlugin((ctx) => { ... })`) still load. `ctx` keeps the old helpers (`ctx.commands.on`, `ctx.status.set`, `ctx.panels.set`, …), and `ctx.app` exposes the full 2.0 API. New plugins should use the class.

## Calling the app

```ts
const page = await this.app.editor.getActive();            // ActivePage | null
const md   = await this.app.editor.getMarkdown({});         // whole open page as Markdown
await this.app.editor.insertMarkdown({ markdown: "## Notes\n\n- ", position: "cursor" });
const hits = await this.app.search.query({ query: "roadmap", limit: 5 });
const { id } = await this.app.pages.create({ title: "Retro", markdown: "# Retro", open: true });
await this.app.databases.addRow({ databaseId, values: { Status: "Doing" } });
```

Every method takes **one object** of named parameters and returns a promise. The namespaces are `app`, `editor`, `pages`, `databases`, `workspaces`, `navigation`, `tabs`, `layout`, `search`, `assets`, `settings`, `storage`, `runtime`, `plugins`, `preferences`, `appearance`, `commands`, `ui`, `clipboard` and `network`. See the [API reference](../sdk/api-reference.md) for each method's parameters, return type, permission and an example.

Errors are `NoteralError` with a `code`:

| code | meaning |
| --- | --- |
| `permission` | The manifest doesn't declare the method's permission, or the user didn't approve it. |
| `invalid_params` | The parameters failed schema validation. The message names the field. |
| `not_allowed` | The method isn't available to plugins, or the user declined a confirmation. |
| `unknown_method` | No such method in this app version. Check `app.info()`'s `sdkVersion`. |
| `cancelled`, `timeout`, `failed` | The user dismissed a dialog, the call took too long, or the handler failed. |

```ts
import { NoteralError } from "@noteral/sdk";
try { await this.app.pages.moveToTrash({ pageId: id }); }
catch (e) { if (e instanceof NoteralError && e.code === "not_allowed") return; throw e; }
```

Some calls (moving pages to the trash, opening another workspace, resetting the appearance) always ask the user to confirm, even with the permission granted.

## Events

| Event | Payload | Needs |
| --- | --- | --- |
| `document:changed` | `EditorSnapshot` (debounced) | `editor.read` |
| `page:opened` | `ActivePage \| null` | – |
| `theme:changed` | `{ theme: "light" \| "dark" }` | – |
| `workspace:opened` | `WorkspaceInfo` | – |
| `pages:changed` | `{ count, created, renamed, moved, deleted }` (page ids, one summary per batch) | `pages.read` |
| `page:created` / `page:deleted` | `PageEventInfo` (`{ pageId, title, parentId, kind }`) | `pages.read` |
| `page:renamed` | `PageEventInfo & { previousTitle }` | `pages.read` |
| `page:moved` | `PageEventInfo & { previousParentId }` | `pages.read` |
| `page:saved` | `{ pageId, title }`: any page's content was saved, including by other plugins (debounced) | `pages.read` |
| `panel:action` | `{ panelId, actionId }` | `ui.panel` |
| `settings:changed` | `{ options, changed }` (the user edited your Options) | `settings.read` |
| `selection:changed` | `EditorSelection & { pageId }` (debounced, the open page only) | `editor.read` |
| `layout:changed` | `LayoutInfo` (panes, tabs, sidebars; debounced) | `layout` |
| `view:message` | Whatever your panel view posted | `ui.panel` |

## Shortcuts

A command can carry a keyboard shortcut, in the manifest (`"shortcut": "Mod+Shift+K"`) or in `addCommand`. `Mod` is Ctrl on Windows and Linux and ⌘ on macOS; the other modifiers are `Shift` and `Alt` (Option). Keys are letters, digits, `F1`–`F24`, arrows (`Up`, `Down`, `Left`, `Right`), `Enter`, `Space`, `Tab`, `Backspace`, `Delete`, `Home`, `End`, `PageUp`, `PageDown` and punctuation such as `/` or `.`. Matching uses the physical key, so it works on any keyboard layout.

A shortcut needs `Mod` (or `Alt` with another modifier, or an `F` key), so it never takes plain typing. Shortcuts the app or the editor already uses (Ctrl/⌘ K, Z, B, I, the heading keys …) and ones another command has bound are refused: the command is not added and the error shows in the plugin's log (`commands.register` rejects with `invalid_params`), and a manifest shortcut is skipped with a warning while the command still works from the palette. For a command declared in `manifest.json`, set `shortcut` there; `addCommand` only supplies its handler. The shortcut is shown next to the command in the palette.

## Editing text

Besides whole blocks (`editor.insertMarkdown`, `editor.updateBlock`, `editor.replaceBlocks`, `editor.removeBlocks`), SDK 2.1 can work at the cursor:

```js
const { cursorBlockId } = await this.app.editor.getSelection();
const block = await this.app.editor.getBlock({ blockId: cursorBlockId }); // + parentId, prevId, nextId
await this.app.editor.moveBlocks({ blockIds: [block.id], direction: "up" }); // ids stay the same
await this.app.editor.insertText({ text: "— done" });
await this.app.editor.formatText({ blockIds: [block.id], styles: { bold: true, textColor: "red" }, mode: "add" });
await this.app.editor.select({ blockId: block.id, placement: "end" });
this.registerEvent("selection:changed", (sel) => console.log(sel.text));
```

## Storage

`loadData`/`saveData` is for a handful of settings. For indexes, caches, history or anything big, use `this.storage`. It needs no permission, nobody else can read it, and it is deleted with the plugin.

```ts
type Index = Record<string, string[]>;
const index = (await this.storage.get<Index>("index")) ?? {};   // null when missing
await this.storage.set("index", index);                          // any JSON, ≤ 8 MB
await this.storage.set("prefs/lastQuery", "roadmap", "global");  // shared by every workspace
const keys = await this.storage.list("prefs/");                  // [{ key, size, modified }]
await this.storage.delete("index");
```

Scope `"workspace"` (the default) keeps one copy per workspace, like a vault's plugin folder; `"global"` is shared. Keys use letters, digits and `. _ : / @ + -`. `this.storage.usage()` reports bytes and keys against the 64 MB / 5000 key quota.

Files in your bundle (templates, dictionaries, wasm, fonts) are readable with `this.readFile("data/words.json")`, or `readFile("model.wasm", "base64")`.

## Suggesters

A suggester adds a menu at the cursor when the user types its trigger character, the way `@` mentions or `[[` links work:

```ts
this.registerSuggester({ id: "people", trigger: "@", minChars: 1 }, async ({ query }) =>
  people
    .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
    .map((p) => ({ title: p.name, subtitle: p.team, insert: `@${p.name}`, link: `https://people.example/${p.id}` })));
```

The trigger and the typed query are replaced with `insert` (or the title), as a link when `link` is an `https://`, `mailto:` or `noteral://page/<id>` URL. To do something else (insert blocks, open a dialog), pass a third argument, `onSelect(item, context)`; the host then inserts nothing. `getItems` must answer within 3 s. `/` (the slash menu) and `:` (the emoji picker) are taken; add slash-menu items with `addCommand`. Up to 8 suggesters per plugin.

## Plugins working together

A plugin can publish an API for others, the way Dataview or Tasks are used from other Obsidian plugins:

```ts
// com.example.tasks
this.exposeApi({
  query: async (args: { done?: boolean }, callerId) => tasks.filter((t) => args.done === undefined || t.done === args.done),
});

// any other plugin
const open = await this.callPlugin<Task[]>("com.example.tasks", "query", { done: false });
const running = await this.app.plugins.running(); // [{ id, name, version, methods }]
```

Handlers run inside the exposing plugin, with its permissions, so only expose what any plugin may use; the caller's id is the second argument. Arguments and results are JSON. Calls fail when the target is not running or doesn't expose the method.

## Status bar widgets and popups

A widget can be text, an icon, a badge or a whole HTML view, and can open its own popup when clicked:

```ts
await this.app.statusBar.setWidget({
  id: "pomodoro",
  icon: "timer",
  text: "25:00",
  side: "right",
  width: "auto",          // px, "auto" (fit content), "fill" (all free space) or "40%"
  minWidth: 60,
  tone: "accent",         // default | accent | success | warning | danger | muted
  progress: 0.4,          // thin bar along the bottom, 0-1
  badge: "3",
  popup: {                // opens next to the widget on click (click again closes it)
    html: `<h3>Focus</h3><button onclick="noteral.post('stop')">Stop</button>`,
    width: 260,
    placement: "top-end", // or bottom-*, left-*, right-*, *-center, center
  },
});
// Cheap live updates (no reload of HTML views; they get props.data):
setInterval(() => this.app.statusBar.updateWidget({ id: "pomodoro", text: clock(), progress: done() }), 1000);
```

Views can open popovers anywhere: `noteral.popover({ html, name, toggle: true, placement: "bottom-start", bare: true }, "self")` anchors one to the calling view; other anchors are an element or rect in the view, `"pointer"`, `"selection"`, `"status:<widgetId>"` or `"block:<blockId>"`. A `name` makes the popover a singleton (`toggle` closes it on a second call), `persistent` keeps it open on outside clicks, `ui.updatePopover` changes it in place and `ui.closePopups({ name })` closes it. Popovers opened from inside a popover stay open together, like submenus.

## Floating overlays

An overlay is an HTML view pinned above the whole app (a HUD, timer, mini player, sticky note or a full-window effect). It doesn't change the layout. It needs the `ui.overlay` permission:

```ts
const hud = this.addOverlay({
  id: "now-playing",
  html: `<div class="n-card" id="t"></div><script>noteral.on("props", (p) => t.textContent = p.data.title)</script>`,
  position: "bottom-right", // corners, edges, center, or "full" (covers the window)
  x: 16, y: 16,
  width: 260,
  draggable: true,          // a grip to move it (remembered; double-click resets)
  chrome: true,             // card border and shadow
  data: { title: "…" },
});
await hud.update({ data: { title: "Next song" } });
```

`interactive: false` lets clicks pass through (decoration, confetti, focus dimming). `stack: "top"` puts it above menus and dialogs too; use it sparingly. Overlays are removed when the plugin unloads, and the user can close one for the session from its grip.

## Custom database property types

Plugins can add property types to the database type picker, with their own cell look, editor and per-property options:

```ts
this.registerPropertyType({
  type: "rating",
  title: "Rating",
  icon: "star",
  valueType: "number", // how it sorts, filters, groups and calculates: text | number | checkbox | date
  config: [{ key: "max", type: "slider", label: "Stars", min: 3, max: 10, default: 5 }],
  render: `{{#repeat config.max}}<span data-value="{{@number}}" data-toggle
    class="{{#if @number <= value}}on{{/if}}">★</span>{{/repeat}}`,
  css: `span { color: var(--text-faint); padding: 0 1px } .on { color: var(--accent) }`,
});
```

- **Templates**: `{{value}}`, `{{text}}`, `{{config.key}}`, `{{row.title}}`, `{{property.name}}`; filters such as `{{value | percent}}`, `fixed:1`, `number`, `date`, `upper`, `truncate:20`, `default:"—"`, `times:100`, `clamp01`, `join:", "`; blocks `{{#if value >= 3}}…{{else}}…{{/if}}`, `{{#unless empty}}`, `{{#each value}}{{this}}{{/each}}` and `{{#repeat n}}{{@number}}{{/repeat}}`. Everything printed is escaped. The HTML is sanitized (no script, event handlers, forms or remote images) and shown in a shadow root styled by `css`, where theme variables work.
- **Clicks**: in a cell, an element with `data-value="<json>"` sets the value (stars, toggles, steppers, color swatches); add `data-toggle` to clear it when it's already the value. `data-edit` opens the editor.
- **Editor**: `editor` is an HTML view shown in a popover by the cell. It gets `noteral.props` = `{ value, raw, config, property, row }`; `noteral.setData(v)` saves, `noteral.close(v)` saves and closes. Without one, the value type's own editor is used (text box, number, date picker; checkbox types toggle).
- **Render in code**: pass a function as `render` to build the HTML in your plugin (`(ctx) => html`). It runs once per distinct value and config, and the result goes through the same sanitizer.
- **Values**: a cell stores JSON. Store `{ value: 4, note: "…" }` to keep extra data next to the value that sorts and filters. Set values from code with `databases.addRow` / `updateRow` using the property's name. `databases.addProperty({ type: "custom", customType: "rating", config: { max: 10 } })` adds one.
- If the plugin is turned off, its cells show their plain value and nothing is lost.

## Limits

| What | Limit |
| --- | --- |
| One message to or from the app (call params, results, view posts) | 4 MB of JSON |
| Calls in flight per plugin | 32; each times out after 60 s |
| `onload` | 6 s; command handlers 30 s |
| Commands / menu items / settings fields | 50 runtime commands, 24 menu items, 40 fields |
| Status widgets / overlays / property types | 12 / 12 / 20 per plugin; templates 40,000 characters, 200 repeats, config 20 KB, a cell value 50 KB |
| Block / node data | 200 KB / 1 MB per block or page |
| HTML of one view | 400,000 characters |
| `loadData` settings | 64 KB, 64 keys per save |
| `storage` | 8 MB per value, 64 MB and 5000 keys per plugin |
| `readFile` | 8 MB per file; bundle ≤ 20 MB, 400 files, entry ≤ 2 MB, `styles.css` ≤ 512 KB |
| `network.request` | 30 s, 5 redirects, request body 4 MB, response 3 MB (then truncated) |

## Permissions

Ask for the smallest set that works. The install screen lists each permission with its risk level, and an update that adds permissions asks again. The full vocabulary is in the [API reference](../sdk/api-reference.md#permissions); the common ones:

- **Low**: `editor.read`, `navigation`, `layout`, `menus`, `ui.status`, `ui.notify`, `ui.panel`, `ui.modal`, `settings.read`, `settings.write`, `assets.read`, `assets.write`, `workspaces.read`
- **Medium**: `editor.write`, `pages.read`, `databases.read`, `search.read`, `ui.styles`, `ui.overlay`, `appearance`, `preferences`, `clipboard`
- **High**: `pages.write`, `databases.write`, `workspaces.write`, `commands.execute`, `network` (any HTTP request through the app, which can send data off the device), `network.local` (`network` plus localhost and the local network, e.g. Ollama on `http://127.0.0.1:11434`)

## Styling

`addStyles(css)` (permission `ui.styles`) injects CSS. You can also ship a `styles.css` next to `main.js`, which is loaded the same way. Use the app's tokens so your UI follows light and dark mode: `var(--bg)`, `var(--bg-raised)`, `var(--text)`, `var(--text-soft)`, `var(--border)`, `var(--accent)`, `var(--radius-md)`, `var(--font-ui)`, `var(--font-reading)`. Call `this.app.appearance.listTokens({})` to see them all.

## Debugging

- *Plugins → Installed* shows a failed plugin's error and a **Restart** button.
- `console.log` in your plugin goes to the app's developer console. In server mode (`go build -tags server`), open the app in a browser and use its devtools; each plugin is a separate iframe in the frame list.
- A call that fails with `permission` names the missing permission in its message.

## Security boundary

- Code runs in `<iframe sandbox="allow-scripts">` with an opaque origin: no access to the app's DOM, cookies, storage or Wails bindings.
- The host checks every request against the approved permissions and validates it against the method's schema before running it.
- The iframe's CSP is `default-src 'none'`, so a plugin can't `fetch` anything itself. Network access goes through `network.request`, which needs the `network` permission and refuses localhost and private addresses unless the plugin holds `network.local`.
- `storage` and `readFile` only ever see the calling plugin's own data and bundle. Exposed APIs run in the exposing plugin's frame with its own permissions; a caller gains nothing it couldn't do through that plugin's public methods.
- Installed code is stored under the data directory (`plugins/<id>/`) and is never fetched again at runtime. Updates only happen when the user presses **Update**.
