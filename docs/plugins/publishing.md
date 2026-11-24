# Publishing a plugin

Community plugins live on GitHub, with nothing to host and no Noteral account:

- **Your repo** holds the code. Each version is a **GitHub Release** with `manifest.json` and `main.js` (and optionally `styles.css`) attached as assets.
- **The registry** is [`registry/community-plugins.json`](../../registry/community-plugins.json) in the public plugin hub, [neurh/noteral-plugins](https://github.com/neurh/noteral-plugins). It's a list of `{ id, name, author, description, repo, tags }`. You get listed through a pull request once. After that, every new release reaches users as an update.

The `noteral-plugin` CLI does the whole thing through the [GitHub CLI](https://cli.github.com). It's one file with no dependencies, and every plugin repo keeps a copy in `scripts/noteral-plugin.mjs`.

```
init ─► build ─► check ─► release ─► submit ─► (maintainer merges) ─► in every Noteral's Community tab
                            ▲                                              │
                            └──────── later versions: release only ◄──────┘
```

## Before you start

- Node 18 or newer.
- `gh`, signed in: `gh auth login`. Releasing and submitting are done as you.
- A **public** repo. Noteral downloads releases anonymously, so it can't install from a private repo.

## 1. Create the plugin

```sh
git clone https://github.com/neurh/noteral-plugins
node noteral-plugins/sdk/cli/noteral-plugin.mjs init word-goal --github
cd word-goal
```

`init` asks for a name, id, description and author. Defaults come from your GitHub login and git config. Pass `--yes` to accept them all. It creates:

```
manifest.json                  id, version, permissions (editor.read, ui.notify to start)
src/main.ts                    a Plugin with one command
src/noteral.ts, src/sdk.d.ts   bindings to the runtime SDK (window.Noteral); keep as-is
scripts/noteral-plugin.mjs     this CLI
.github/workflows/release.yml  tag push → GitHub Release (an alternative to `release`)
package.json                   npm run build | check | release | submit | status
```

It also makes the first commit. `--github` runs `gh repo create <you>/noteral-<name> --public --source . --push`. Without the flag, create the repo yourself and set `"repo"` in `manifest.json`.

Copying `examples/starter` works too, since it ships the same script.

## 2. Build and test locally

```sh
npm run build          # src/main.ts → main.js (esbuild, readable output; add -- --watch)
npm run check          # validates manifest.json and main.js with the app's rules
```

To try it, zip `manifest.json` and `main.js`, then use **Plugins → Install from file** in Noteral. That runs the same validation and permission review as the store. Reinstall the zip after each change. Saved data stays, because the id stays.

`check` prints what users will see on the approval screen:

```
Word Goal com.you.word-goal 0.1.0
  manifest.json    286 B
  main.js          1.1 KB
  permissions
    editor.read        low    Read the open page
    ui.notify          low    Notifications
✓ Ready to install
```

## 3. Release

```sh
npm run release              # next patch version (0.1.0 → 0.1.1; the first release uses 0.1.0)
npm run release -- minor     # or major, or an exact version: -- 1.0.0
```

`release` checks that the working tree is clean, that the repo is public and that `manifest.json`'s `repo` matches the git remote. It bumps `version`, builds, runs `check --release` and shows you the plan. After you confirm, it commits, tags `<version>`, pushes, and runs `gh release create` with the assets and generated notes. If the repo's release workflow got there first, it uploads the assets with `--clobber` instead.

| Option | |
| --- | --- |
| `--notes "…"` / `--notes-file FILE` | release notes (the store shows them on the update screen) |
| `--draft` | create a draft; users don't see it until you publish it on GitHub |
| `--allow-dirty` | release with uncommitted changes |
| `--yes` | don't ask (CI) |

Prefer CI? Bump `version` in `manifest.json`, commit, then `git tag 1.2.0 && git push origin 1.2.0`. The included workflow builds, checks that the tag matches the manifest, and publishes the release.

## 4. Submit to the store (once)

```sh
npm run submit -- --dry-run       # shows the registry entry it would add
npm run submit                    # opens the pull request
npm run submit -- --tags writing,stats
```

`submit`:

1. Reads your repo's **latest release** the way the app does: manifest asset, entry asset, sizes, matching `repo` and `id`. It stops if the release can't be installed.
2. Builds your registry entry from the released `manifest.json`, then checks for id and repo conflicts with plugins that are already listed.
3. Forks `neurh/noteral-plugins` to your account if you can't push to it. It reuses an existing fork without touching your other branches.
4. Commits the one-entry change to a `plugin/<id>` branch through the GitHub API, so no clone is needed, and opens the pull request with your permissions and a checklist. If that pull request is already open, it updates it.

Then the **registry bot** comments on the pull request:

```
✅ Word Goal com.you.word-goal (added)
| Repo        | you/noteral-word-goal              |
| Release     | 0.1.1 · 2026-11-24                 |
| Assets      | manifest.json 286 B, main.js 1.1 KB |
| Permissions | ⚪ editor.read ⚪ ui.notify          |
```

It labels the pull request `registry: ready` or `registry: needs changes`, and updates its comment each time you push or release again. A maintainer reads the source and merges it. The plugin then shows up in every Noteral's **Plugins → Community** tab.

`npm run status` shows where you are: latest release, listed or not, and the open pull request.

### Without the command line

Open an issue with the **Submit a community plugin** form in [neurh/noteral-plugins](https://github.com/neurh/noteral-plugins/issues/new/choose) and enter your repo. The bot checks the latest release. If the release is fine, it opens the registry pull request for you. If it isn't, it comments with what to fix, and editing the issue runs the check again.

## 5. Updates

Run `npm run release` again. That's all: no pull request.

- **Check for updates** in Noteral compares each installed plugin's version with its repo's latest release.
- An update that **adds permissions** marks them *new*, and the user must approve them again. An update with the same permissions installs in one click.
- Saved data (`saveData`) survives updates. Changing `id` creates a different plugin, so don't.
- Set `minAppVersion` when you start using a newer API. Older apps then show "requires Noteral x.y.z" instead of installing something that fails.
- Changing the name, description or tags in the store means running `npm run submit` again, which opens an update pull request.

## What the checks enforce

The CLI, the registry bot and the app share these rules. `sdk/cli/noteral-plugin.mjs` mirrors `internal/plugins`, and a test keeps the two in step.

| Rule | |
| --- | --- |
| `id` | reverse-domain, lowercase: `com.you.plugin-name` (≤ 100 chars); final |
| `version` | semver; the release tag should equal it (`1.2.0` or `v1.2.0`) |
| `sdkVersion` | major 1 or 2 (current: 2.0.0) |
| `permissions` | from the [list](manifest.md#permissions), no duplicates |
| assets | `manifest.json` ≤ 256 KB, entry (top-level, default `main.js`) ≤ 2 MB, `styles.css` ≤ 512 KB |
| repo | public, and the same as the manifest's `repo`; one plugin per repo |
| registry entry | only `id, name, author, description, repo, tags`; ≤ 8 tags |

The bot also flags things for the human reviewer: minified or obfuscated code, `eval`, long embedded base64, network calls without the `network` permission (or the reverse), a repo owned by someone other than the pull request's author, and a missing license. It records the entry file's SHA-256 in its comment.

## Review checklist

- [ ] `id` is final, and `version` matches the tag
- [ ] the permission list is minimal: `network` only if the plugin really talks to a server, with the README explaining why
- [ ] the released `main.js` is readable and built from the repo (the CLI doesn't minify)
- [ ] works in light and dark (use CSS tokens, not hard-coded colors)
- [ ] `onunload` cleans up anything not registered through the `Plugin` helpers
- [ ] README with a screenshot, the permissions it asks for, and what data leaves the device (if any)

## For maintainers

- `.github/workflows/registry.yml` runs `registry/validate.mjs` on pushes and pull requests. The **review** job runs on `pull_request_target`, so it can comment on pull requests from forks. It checks out the base branch and reads only the pull request's `community-plugins.json`, as data. A weekly **audit** re-checks every listed plugin's latest release and writes the result to the run summary.
- `.github/workflows/registry-submit.yml` handles the issue form. It needs *Settings → Actions → General → Allow GitHub Actions to create and approve pull requests*.
- Locally: `node registry/validate.mjs [--fix]`, `node registry/review.mjs --base old.json --head new.json`, `node registry/review.mjs --all`, `node --test registry/*.test.mjs`.
- Removing a plugin is a pull request that deletes its entry. Installed copies keep working, but stop receiving updates.

## Testing the store flow end to end

Set the registry URL under *Community → Registry source*. Then start Noteral with `NOTERAL_GITHUB_BASE` (release downloads, default `https://github.com`) and `NOTERAL_GITHUB_API` (release notes, default `https://api.github.com`) pointing at a mirror or a local mock. `NOTERAL_GITHUB_API` also redirects `noteral-plugin`'s release checks and the registry bot.
