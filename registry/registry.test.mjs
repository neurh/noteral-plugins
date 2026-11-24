// Tests for the publishing CLI and the registry bot.  Run: node --test registry/*.test.mjs
// A local server stands in for the GitHub API and release downloads.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  bumpVersion,
  compareVersions,
  formatRegistry,
  ID_RE,
  inspectRelease,
  parseArgs,
  PERMISSIONS,
  registryEntry,
  validateManifest,
  validateRegistry,
  VERSION_RE,
} from "../sdk/cli/noteral-plugin.mjs";
import { parseIssueForm, parseRepo, parseTags } from "./from-issue.mjs";
import { codeNotes, diffRegistry, review, safe } from "./review.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(`${root}/${rel}`, "utf8");

const good = {
  id: "com.example.word-goal",
  name: "Word Goal",
  version: "1.2.0",
  sdkVersion: "2.0.0",
  author: "Example",
  description: "Daily word goal",
  repo: "example/noteral-word-goal",
  entry: "main.js",
  permissions: ["editor.read", "ui.status"],
};

// In the Noteral repo the rules come from the Go source; in the public hub, from
// registry/app-rules.json (written by Noteral's scripts/export-plugin-hub.mjs).
function appRules() {
  if (existsSync(`${root}/internal/plugins/plugins.go`)) {
    const go = read("internal/plugins/plugins.go");
    const block = go.slice(go.indexOf("var allowedPermissions"), go.indexOf("}", go.indexOf("var allowedPermissions")));
    return {
      permissions: [...block.matchAll(/"([a-z]+(?:\.[a-z]+)?)":\s*true/g)].map((m) => m[1]).sort(),
      idPattern: /idRe\s+=\s+regexp\.MustCompile\(`([^`]+)`\)/.exec(go)?.[1],
      versionPattern: /versionRe\s+=\s+regexp\.MustCompile\(`([^`]+)`\)/.exec(go)?.[1],
    };
  }
  return JSON.parse(read("registry/app-rules.json"));
}

describe("matches the app", () => {
  const rules = appRules();

  test("permissions are the app's allow-list", () => {
    assert.deepEqual(PERMISSIONS.map((p) => p.id).sort(), rules.permissions);
  });

  test("id and version patterns are the app's", () => {
    assert.equal(ID_RE.source, rules.idPattern);
    assert.equal(VERSION_RE.source, rules.versionPattern);
  });

  test("the starter keeps an up-to-date copy of the CLI", () => {
    assert.equal(read("examples/starter/scripts/noteral-plugin.mjs"), read("sdk/cli/noteral-plugin.mjs"));
  });

  test("the shipped registry is valid and formatted", () => {
    const raw = read("registry/community-plugins.json");
    const data = JSON.parse(raw);
    assert.deepEqual(validateRegistry(data).errors, []);
    assert.equal(formatRegistry(data, data.plugins), raw);
  });
});

describe("validateManifest", () => {
  test("accepts a good manifest", () => {
    assert.deepEqual(validateManifest(good, { forRelease: true }).errors, []);
  });

  test("explains what's wrong", () => {
    const { errors } = validateManifest({ ...good, id: "WordGoal", version: "1", permissions: ["editor.red", "ui.status", "ui.status"], entry: "../x.js" });
    assert.equal(errors.length, 5);
    assert.match(errors.join("\n"), /reverse-domain/);
    assert.match(errors.join("\n"), /did you mean "editor\.read"/);
    assert.match(errors.join("\n"), /duplicate permission "ui\.status"/);
    assert.match(errors.join("\n"), /inside the plugin folder/);
  });

  test("releases need a repo and a top-level entry", () => {
    const { errors } = validateManifest({ ...good, repo: "", entry: "dist/main.js" }, { forRelease: true });
    assert.match(errors.join("\n"), /repo is required/);
    assert.match(errors.join("\n"), /top-level file/);
    assert.deepEqual(validateManifest({ ...good, repo: "", entry: "dist/main.js" }).errors, []);
  });

  test("rejects unsupported SDK majors", () => {
    assert.match(validateManifest({ ...good, sdkVersion: "3.0.0" }).errors.join(), /not supported/);
  });
});

describe("registry helpers", () => {
  test("validateRegistry catches duplicates and unknown fields", () => {
    const { errors } = validateRegistry({ version: 1, plugins: [registryEntry(good), { ...registryEntry(good), repo: "Example/Noteral-Word-Goal", extra: 1 }] });
    assert.match(errors.join("\n"), /duplicate id/);
    assert.match(errors.join("\n"), /already listed/);
    assert.match(errors.join("\n"), /unknown field "extra"/);
  });

  test("registryEntry keeps registry-only tags", () => {
    assert.deepEqual(registryEntry(good, { previous: { tags: ["writing"] } }).tags, ["writing"]);
    assert.deepEqual(registryEntry(good, { tags: ["a"], previous: { tags: ["writing"] } }).tags, ["a"]);
    assert.equal(registryEntry(good).tags, undefined);
  });

  test("versions", () => {
    assert.equal(bumpVersion("1.2.3", "patch"), "1.2.4");
    assert.equal(bumpVersion("1.2.3", "minor"), "1.3.0");
    assert.equal(bumpVersion("1.2.3", "major"), "2.0.0");
    assert.equal(bumpVersion("1.2.3", "4.0.0"), "4.0.0");
    assert.throws(() => bumpVersion("1.2.3", "huge"));
    assert.equal(compareVersions("v1.10.0", "1.9.9"), 1);
    assert.equal(compareVersions("1.0.0", "v1.0.0"), 0);
  });

  test("parseArgs", () => {
    assert.deepEqual(parseArgs(["release", "minor", "--notes", "Hi", "--draft", "--dir=x"]), { command: "release", positional: ["minor"], flags: { notes: "Hi", draft: true, dir: "x" } });
  });

  test("diffRegistry", () => {
    const a = { id: "a.b", name: "A", repo: "o/a" };
    const b = { id: "c.d", name: "B", repo: "o/b" };
    const diff = diffRegistry([a, b], [{ ...a, name: "A2" }, { id: "e.f", name: "C", repo: "o/c" }]);
    assert.deepEqual([diff.added.map((e) => e.id), diff.changed.map((e) => e.id), diff.removed.map((e) => e.id)], [["e.f"], ["a.b"], ["c.d"]]);
  });

  test("safe() defuses untrusted text", () => {
    assert.equal(safe("<img src=x> @octocat | `x`"), "&lt;img src=x&gt; @​octocat \\| 'x'");
  });

  test("codeNotes", () => {
    assert.deepEqual(codeNotes("Noteral.register(class {})", []), []);
    assert.match(codeNotes("eval('x'); register(X)", []).join(), /eval/);
    assert.match(codeNotes("register(X); app.network.fetch(u)", []).join(), /without the `network` permission/);
  });

  test("issue form parsing", () => {
    const fields = parseIssueForm("### Repository\n\nhttps://github.com/example/noteral-word-goal/\n\n### Tags\n\n_No response_\n");
    assert.equal(parseRepo(fields.repository), "example/noteral-word-goal");
    assert.equal(fields.tags, "");
    assert.equal(parseRepo("not a repo"), null);
    assert.deepEqual(parseTags("Writing, Stats!\nx"), ["writing", "stats", "x"]);
  });
});

describe("against a GitHub stand-in", () => {
  let server;
  let base;
  const releases = new Map();
  const repos = new Map();

  before(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url, "http://x");
      const send = (status, body, type = "application/json") => {
        res.writeHead(status, { "content-type": type });
        res.end(typeof body === "string" ? body : JSON.stringify(body));
      };
      let m = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)$/);
      if (m) return repos.has(m[1]) ? send(200, repos.get(m[1])) : send(404, { message: "Not Found" });
      m = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)\/releases\/latest$/);
      if (m) {
        const rel = releases.get(m[1]);
        if (!rel) return send(404, { message: "Not Found" });
        return send(200, {
          tag_name: rel.tag,
          html_url: `${base}/${m[1]}/releases/tag/${rel.tag}`,
          published_at: "2026-11-20T00:00:00Z",
          assets: Object.entries(rel.files).map(([name, body]) => ({ name, size: Buffer.byteLength(body), browser_download_url: `${base}/dl/${m[1]}/${name}` })),
        });
      }
      m = url.pathname.match(/^\/dl\/([^/]+\/[^/]+)\/(.+)$/);
      if (m) return send(200, releases.get(m[1])?.files[m[2]] ?? "", "application/octet-stream");
      send(404, { message: "Not Found" });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
    process.env.NOTERAL_GITHUB_API = base;
    const publicRepo = (full, owner = full.split("/")[0]) => ({ full_name: full, private: false, owner: { login: owner, type: "User" }, license: { spdx_id: "MIT" }, stargazers_count: 3 });
    repos.set("example/noteral-word-goal", publicRepo("example/noteral-word-goal"));
    releases.set("example/noteral-word-goal", { tag: "1.2.0", files: { "manifest.json": JSON.stringify(good), "main.js": "Noteral.register(class extends Noteral.Plugin {});\n" } });
    repos.set("example/no-assets", publicRepo("example/no-assets"));
    releases.set("example/no-assets", { tag: "v0.1.0", files: { "plugin.zip": "PK" } });
    repos.set("example/secret", { ...publicRepo("example/secret"), private: true });
    repos.set("example/mismatch", publicRepo("example/mismatch"));
    releases.set("example/mismatch", { tag: "2.0.0", files: { "manifest.json": JSON.stringify({ ...good, id: "com.example.other", version: "1.0.0" }), "main.js": "register(X)" } });
  });

  after(() => {
    delete process.env.NOTERAL_GITHUB_API;
    server.close();
  });

  test("a good release installs", async () => {
    const r = await inspectRelease("example/noteral-word-goal");
    assert.deepEqual(r.errors, []);
    assert.equal(r.ok, true);
    assert.equal(r.manifest.id, good.id);
  });

  test("explains broken releases", async () => {
    assert.match((await inspectRelease("example/no-assets")).errors.join(), /no manifest\.json asset/);
    assert.match((await inspectRelease("example/secret")).errors.join(), /is private/);
    assert.match((await inspectRelease("example/missing")).errors.join(), /doesn't exist or is private/);
    const mismatch = await inspectRelease("example/mismatch");
    assert.match(mismatch.errors.join(), /says repo "example\/noteral-word-goal"/);
    assert.match(mismatch.warnings.join(), /doesn't match manifest version/);
  });

  test("the bot passes a good submission and reports permissions", async () => {
    const baseRaw = formatRegistry({ version: 1 }, []);
    const headRaw = formatRegistry({ version: 1 }, [registryEntry(good, { tags: ["writing"] })]);
    const result = await review({ baseRaw, headRaw, author: "example", files: ["registry/community-plugins.json"] });
    assert.equal(result.ok, true, result.markdown);
    assert.match(result.markdown, /Registry check passed/);
    assert.match(result.markdown, /`editor\.read`/);
    assert.match(result.markdown, /Entry SHA-256/);
  });

  test("the bot flags id mismatches, other files and foreign repos", async () => {
    const headRaw = formatRegistry({ version: 1 }, [{ id: "com.example.mine", name: "Mine", repo: "example/noteral-word-goal" }]);
    const result = await review({ baseRaw: formatRegistry({ version: 1 }, []), headRaw, author: "someone-else", files: ["registry/community-plugins.json", "frontend/src/App.tsx"] });
    assert.equal(result.ok, false);
    assert.match(result.markdown, /the registry id is `com\.example\.mine`/);
    assert.match(result.markdown, /also changes `frontend\/src\/App\.tsx`/);
    assert.match(result.markdown, /not the pull request's author/);
  });
});

test("the starter's release workflow is the one init writes", async () => {
  const { RELEASE_YML } = await import("../sdk/cli/noteral-plugin.mjs");
  assert.equal(read("examples/starter/.github/workflows/release.yml"), RELEASE_YML);
});
