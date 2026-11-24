# Noteral plugins

The community plugin hub for [Noteral](https://github.com/neurh), a local-first notes app.

- **[`registry/community-plugins.json`](registry/community-plugins.json)**: the plugin list that every Noteral's **Plugins → Community** tab reads.
- **[Developer docs](docs/plugins/README.md)**: writing plugins, the manifest, extending the interface, publishing.
- **[API reference](docs/sdk/api-reference.md)**: every method, event, permission and type. For coding agents, [`llms.txt`](docs/sdk/llms.txt) and [`llms-full.txt`](docs/sdk/llms-full.txt).
- **[`sdk/`](sdk)**: the TypeScript SDK types and the `noteral-plugin` CLI.
- **[`examples/`](examples)**: a starter and two complete plugins.

## Publish a plugin

You need Node 18+ and the [GitHub CLI](https://cli.github.com) (`gh auth login`).

```sh
git clone https://github.com/neurh/noteral-plugins
node noteral-plugins/sdk/cli/noteral-plugin.mjs init my-plugin --github   # new public repo with a working plugin
cd my-plugin
npm run build && npm run check     # build, then validate with the store's rules
npm run release                    # GitHub Release with manifest.json + main.js
npm run submit                     # once: opens the pull request that lists it here
```

After it's listed, each `npm run release` reaches users as an update. You don't need another pull request. You can also submit without the command line, through the [submission form](https://github.com/neurh/noteral-plugins/issues/new?template=plugin-submission.yml).

The full guide is [docs/plugins/publishing.md](docs/plugins/publishing.md).

## How listing works

1. A pull request adds `{ id, name, author, description, repo, tags }` to `registry/community-plugins.json`.
2. The registry bot downloads the repo's latest release and checks it the way the app does. It comments with the assets, a checksum, the owner, the license and the permissions, and labels the pull request **registry: ready** or **registry: needs changes**.
3. A maintainer reads the plugin's source and merges.

Plugins run in a sandbox and can only use the permissions the user approved at install. Listing isn't an endorsement, so read a plugin's permissions before you approve it.

## About this repo

Noteral's main repository generates everything here except the registry file, using `scripts/export-plugin-hub.mjs`. Send pull requests for docs, the SDK or the CLI here too, and they get carried back. The tests run with `node --test registry/*.test.mjs`.

MIT licensed.
