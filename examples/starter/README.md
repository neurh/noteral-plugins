# Noteral starter plugin

A minimal plugin to copy: one dynamic command, one status item, and one sidebar panel with a button. It uses SDK 2.0 (`class … extends Plugin`).

```
manifest.json                  id, version, permissions, contributions
src/main.ts                    the plugin
src/noteral.ts                 maps the runtime SDK (window.Noteral); keep as-is
scripts/noteral-plugin.mjs     build, check, release and submit (uses the GitHub CLI)
.github/workflows/release.yml  tag push → GitHub Release (alternative to `npm run release`)
```

Starting fresh? `node scripts/noteral-plugin.mjs init my-plugin --github` makes a new plugin repo with all of this.

## Build and try it

```sh
npm run build        # src/main.ts → main.js
npm run check        # validate with the store's rules
zip starter.zip manifest.json main.js
```

In Noteral, open **Plugins** (puzzle icon) → **Install from file**, then pick `starter.zip`. Review the permissions and approve. To try a change, rebuild and install the zip again. The plugin keeps its id, so its saved data stays.

## Types

`src/noteral.ts` imports only types from `@noteral/sdk`, so the build works without the SDK installed. For editor types, run `node scripts/noteral-plugin.mjs types` (downloads the SDK types into `types/noteral-sdk/`), or clone [neurh/noteral-plugins](https://github.com/neurh/noteral-plugins) next to your repo and add:

```json
{ "compilerOptions": { "strict": true, "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
  "lib": ["ES2022", "DOM"], "noEmit": true,
  "paths": { "@noteral/sdk": ["../noteral-plugins/sdk/src/index.ts"] } } }
```

## Publish

Needs the GitHub CLI, signed in (`gh auth login`), and a public repo.

1. Set `id` (reverse-domain, final), `name`, `author` and `repo` (`owner/name`) in `manifest.json`.
2. `npm run release` bumps the version, builds, checks, tags, pushes and publishes the GitHub Release.
3. `npm run submit` (once) opens the pull request that lists the plugin in the community store. Later releases reach users as updates on their own.

`npm run status` shows the latest release and whether the plugin is listed. Full guide: `docs/plugins/publishing.md`. API reference: `docs/sdk/api-reference.md`.
