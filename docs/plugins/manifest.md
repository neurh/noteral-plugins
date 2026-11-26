# manifest.json

Every plugin ships a `manifest.json` next to its entry file. Noteral validates it on install and on every update. A manifest that fails validation is rejected with a message naming the field.

```json
{
  "id": "com.example.reading-time",
  "name": "Reading Time",
  "version": "2.0.0",
  "sdkVersion": "2.0.0",
  "minAppVersion": "0.2.0",
  "description": "Shows how long the open page takes to read.",
  "author": "Ada Example",
  "authorUrl": "https://example.com",
  "repo": "ada/noteral-reading-time",
  "entry": "main.js",
  "permissions": ["editor.read", "ui.status", "settings.read", "settings.write"],
  "contributes": {
    "commands": [{ "id": "set-speed", "title": "Reading time: set reading speed", "keywords": "wpm words" }],
    "statusItems": [{ "id": "reading-time", "label": "Reading time" }],
    "panels": [{ "id": "reading-stats", "title": "Reading stats" }]
  }
}
```

## Fields

| Field | Required | Rules |
| --- | --- | --- |
| `id` | yes | Reverse-domain, lowercase: `^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*)+$`, at most 100 characters. **Never change it**: it is the key for updates and saved data. |
| `name` | yes | Shown in the store, at most 80 characters. |
| `version` | yes | Semver `MAJOR.MINOR.PATCH` (pre-release suffixes allowed). Updates compare this against the installed version. |
| `sdkVersion` | yes | The SDK you built against. This app accepts majors **1** and **2**. Use `"2.0.0"`. |
| `minAppVersion` | no | The oldest Noteral version that can run the plugin. Older apps refuse to install it and explain why. |
| `description` | no | One or two sentences, at most 500 characters. |
| `author`, `authorUrl` | no | Shown in the store and on the review screen. |
| `repo` | for the community store | GitHub `owner/name` the releases come from. Must match the registry entry. |
| `entry` | yes | The bundled script, normally `main.js`. One file; no imports at runtime. |
| `permissions` | yes | Array from the vocabulary below. Use `[]` when you need none. Unknown names are rejected. |
| `contributes` | no | Static UI surfaces, listed on the review screen (see below). |

Older plugins may ship `plugin.json` instead of `manifest.json`. It is still read, but new plugins should use `manifest.json`.

## `contributes`

| Key | Entry fields | Notes |
| --- | --- | --- |
| `commands` | `id` (`^[a-z][a-z0-9-]{1,48}$`), `title`, `description?`, `keywords?` (a space-separated string) | Appear in the command palette and slash menu before the plugin loads. Handle them with `this.addCommand({ id, ... , run })` (same id). |
| `statusItems` | `id`, `label`, `description?` | Space in the status bar, filled with `this.setStatus(id, text)`. |
| `panels` | `id`, `title`, `description?` | A right-sidebar panel, filled with `this.setPanel(id, { markdown, actions })`. |
| `menus` | `id`, `menu` (`page` · `tree` · `block` · `tab` · `status`), `title`, `command`, `icon?`, `kinds?`, `nodeTypes?`, `blockTypes?`, `danger?` | An item in an app menu. Choosing it runs the plugin's `command` and passes it a `MenuContext` (see [ui.md](ui.md#menu-items)). Needs `menus`. |
| `settings` | `key`, `type` (`toggle` · `text` · `textarea` · `number` · `slider` · `select` · `color`), `label`, `description?`, `section?`, `placeholder?`, `default?`, `options?` (select), `min?` / `max?` / `step?` | Fields on the plugin's **Options** screen. Read them with `this.getOptions()`. |

Commands added only through `addCommand` don't need a manifest entry. Declaring them is still nice, because users see them before they install.

```json
"contributes": {
  "commands": [{ "id": "copy-link", "title": "Copy link to page" }],
  "menus": [{ "id": "copy-link", "menu": "tree", "title": "Copy link", "icon": "lucide:link", "command": "copy-link", "kinds": ["page"] }],
  "settings": [
    { "key": "format", "type": "select", "label": "Link format", "default": "markdown",
      "options": [{ "value": "markdown", "label": "Markdown" }, { "value": "url", "label": "Plain URL" }] },
    { "key": "notify", "type": "toggle", "label": "Show a toast after copying", "default": true }
  ]
}
```

## Permissions

| Permission | Allows | Risk |
| --- | --- | --- |
| `editor.read` | Read the open page's text, blocks, selection; `document:changed` | low |
| `editor.write` | Insert, replace, update and remove blocks in the open page | medium |
| `pages.read` | List and read any page, favorites, recent, backlinks, trash | medium |
| `pages.write` | Create, rename, move, duplicate, trash and restore pages; write content | high |
| `databases.read` | List databases, read schemas, query rows | medium |
| `databases.write` | Create databases, add properties, add/update rows | high |
| `workspaces.read` | List workspaces and read the current one | low |
| `workspaces.write` | Create, rename and switch workspaces (switching always asks the user) | high |
| `navigation` | Open pages and Home, go back and forward, list and close tabs | low |
| `layout` | Split panes, toggle panels, open overlays | low |
| `search.read` | Full-text search across the workspace | medium |
| `assets.read` / `assets.write` | Pick images and files through the system dialog | low |
| `settings.read` / `settings.write` | The plugin's own saved data (`loadData` / `saveData`) | low |
| `preferences` | Read and change app preferences (font size, width, …) | medium |
| `appearance` | Change theme tokens, style components, add CSS | medium |
| `commands.execute` | List and run app and plugin commands | high |
| `menus` | Add items to the page, tree, block, tab and status-bar menus | low |
| `clipboard` | Read and write clipboard text | medium |
| `network` | HTTP requests through the app (no localhost or private ranges) | high |
| `ui.status`, `ui.notify`, `ui.panel`, `ui.modal` | Status items, toasts, panels, confirm/prompt/pick dialogs | low |
| `ui.styles` | Inject CSS into the app | medium |

The generated [API reference](../sdk/api-reference.md) lists which methods each permission unlocks. Its source of truth is `PERMISSIONS` in `frontend/src/sdk-host/spec.ts`, and the Go validator (`internal/plugins/plugins.go`) mirrors the same list.

## Release files

A release (or a zip for *Install from file*) contains:

| File | Required | Limit |
| --- | --- | --- |
| `manifest.json` | yes | 256 KB |
| the `entry` file (`main.js`) | yes | 2 MB |
| `styles.css` | no | 512 KB; loaded with the plugin, removed on unload |

A zip for *Install from file* may hold at most 400 files and 20 MB, and each file at most 5 MB.
