#!/usr/bin/env node
// The registry bot. Compares two versions of community-plugins.json, checks the
// latest GitHub Release of every added or changed plugin with the same rules the
// app uses, and writes a Markdown report. With --comment it posts the report on
// the pull request and labels it (needs gh and GH_TOKEN).
//
//   node registry/review.mjs --base base.json --head head.json [--author login]
//        [--files changed.txt] [--out report.md] [--comment <pr>]
//   node registry/review.mjs --all [--head registry/community-plugins.json] [--out FILE]
//
// Only data from the pull request is read (never its code), so this is safe to
// run from pull_request_target.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  formatRegistry,
  inspectRelease,
  kb,
  permissionInfo,
  REGISTRY_FILE,
  sortPermissions,
  validateRegistry,
} from "../sdk/cli/noteral-plugin.mjs";

export const MARKER = "<!-- noteral-registry-bot -->";
export const LABELS = {
  submission: { name: "plugin submission", color: "2f6f5e", description: "Adds or updates a community plugin" },
  ready: { name: "registry: ready", color: "1a7f37", description: "The registry bot found no problems" },
  changes: { name: "registry: needs changes", color: "d1242f", description: "The registry bot found problems" },
};

/** Makes untrusted text safe inside a Markdown table cell or line: no HTML, no @-mentions, no table breaks. */
export function safe(value, max = 200, { code = false } = {}) {
  let s = String(value ?? "").replace(/[\r\n]+/g, " ").trim();
  if ([...s].length > max) s = `${[...s].slice(0, max).join("")}…`;
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "\\|")
    .replace(/@/g, "@​")
    .replace(/`/g, code ? "`" : "'");
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Which entries were added, changed (fields) or removed between two registry versions. */
export function diffRegistry(baseEntries, headEntries) {
  const before = new Map(baseEntries.map((e) => [e?.id, e]));
  const after = new Map(headEntries.map((e) => [e?.id, e]));
  const added = headEntries.filter((e) => !before.has(e?.id));
  const changed = headEntries.filter((e) => before.has(e?.id) && !same(before.get(e.id), e));
  const removed = baseEntries.filter((e) => !after.has(e?.id));
  return { added, changed, removed };
}

async function fetchCode(asset) {
  try {
    const res = await fetch(asset.url, { headers: { "user-agent": "noteral-registry-bot" }, redirect: "follow" });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return { sha256: createHash("sha256").update(buf).digest("hex"), text: buf.toString("utf8") };
  } catch {
    return null;
  }
}

/** Notes for reviewers about the shipped code; never fatal. */
export function codeNotes(code, permissions) {
  const notes = [];
  const lines = code.split("\n");
  const longest = Math.max(...lines.map((l) => l.length));
  if (code.length > 4000 && (lines.length < 5 || code.length / lines.length > 400 || longest > 5000)) notes.push("the code looks minified; reviewers ask for readable builds (`noteral-plugin build` doesn't minify)");
  if (/\beval\s*\(|new\s+Function\s*\(/.test(code)) notes.push("uses `eval` / `new Function`");
  if (/atob\s*\(\s*["'][A-Za-z0-9+/=]{200,}/.test(code)) notes.push("decodes a long base64 string at runtime");
  if (!/\bregister\s*\(|definePlugin\s*\(/.test(code)) notes.push("never calls `register(...)` or `definePlugin(...)`");
  const usesNetwork = /\bnetwork\.(fetch|request)|["']network\.(fetch|request)["']|\bapp\.network\b/.test(code);
  if (usesNetwork && !permissions.includes("network")) notes.push("calls the network API without the `network` permission (the call will be refused)");
  if (permissions.includes("network") && !usesNetwork) notes.push("asks for `network` but no network call was found");
  return notes;
}

/**
 * Reviews every added or changed entry.
 * @returns {Promise<{ ok: boolean, markdown: string, results: object[] }>}
 */
export async function review({ baseRaw, headRaw, author, files = [], all = false, token }) {
  const problems = [];
  const notices = [];
  let head;
  try {
    head = JSON.parse(headRaw);
  } catch (error) {
    head = null;
    problems.push(`\`${REGISTRY_FILE}\` is not valid JSON: ${safe(error.message)}`);
  }
  const headCheck = head ? validateRegistry(head) : { errors: [], entries: [] };
  problems.push(...headCheck.errors.map((e) => safe(e, 300)));
  if (head && !headCheck.errors.length && formatRegistry(head, headCheck.entries) !== headRaw) {
    notices.push("The file isn't in the standard format (2-space JSON, trailing newline). `noteral-plugin submit` writes it that way; a maintainer can also reformat it when merging.");
  }
  const baseEntries = baseRaw ? validateRegistry(JSON.parse(baseRaw)).entries : [];
  const { added, changed, removed } = all ? { added: headCheck.entries, changed: [], removed: [] } : diffRegistry(baseEntries, headCheck.entries);
  const other = files.filter((f) => f && f !== REGISTRY_FILE);
  if (other.length) notices.push(`This pull request also changes ${other.map((f) => `\`${safe(f, 120)}\``).join(", ")}. The bot only reviews the registry; a maintainer reviews the rest.`);
  for (const entry of removed) notices.push(`Removes **${safe(entry.name)}** (\`${safe(entry.id, 100)}\`). Only the plugin's owner or a maintainer should do that.`);
  if (!all && added.length + changed.length > 1) notices.push("This changes more than one plugin. One plugin per pull request keeps reviews quick.");

  const results = [];
  for (const entry of [...added, ...changed]) {
    const r = { entry, kind: added.includes(entry) ? "added" : "changed", errors: [], warnings: [], check: null };
    results.push(r);
    if (!entry?.repo || headCheck.errors.some((e) => entry?.id && e.includes(`(${entry.id})`))) {
      r.errors.push("the registry entry is invalid (see above), so the release wasn't checked");
      continue;
    }
    const check = await inspectRelease(entry.repo, { token });
    r.check = check;
    r.errors.push(...check.errors);
    r.warnings.push(...check.warnings);
    if (check.manifest) {
      if (check.manifest.id !== entry.id) r.errors.push(`the registry id is \`${entry.id}\` but the release's manifest.json says \`${check.manifest.id}\``);
      if (check.manifest.name && check.manifest.name !== entry.name) r.warnings.push(`the registry name "${entry.name}" differs from the manifest's "${check.manifest.name}"`);
      const entryAsset = check.assets.find((a) => a.name === (check.manifest.entry || "main.js"));
      if (entryAsset && entryAsset.size <= 2 << 20) {
        const code = await fetchCode(entryAsset);
        if (code) {
          r.sha256 = code.sha256;
          r.warnings.push(...codeNotes(code.text, check.manifest.permissions ?? []));
        }
      }
    }
    const owner = check.repoInfo?.owner;
    if (author && owner && check.repoInfo.ownerType === "User" && owner.toLowerCase() !== author.toLowerCase()) {
      r.warnings.push(`the repo belongs to ${owner}, not the pull request's author (${author}); a maintainer should confirm they're allowed to list it`);
    }
    if (r.kind === "changed") {
      const before = baseEntries.find((e) => e.id === entry.id);
      if (before && before.repo.toLowerCase() !== entry.repo.toLowerCase()) r.warnings.push(`moves the plugin from ${before.repo} to ${entry.repo}; existing users will update from the new repo`);
    }
    if (!check.repoInfo?.license) r.warnings.push("the repo has no license file");
  }

  const ok = problems.length === 0 && results.every((r) => r.errors.length === 0);
  return { ok, results, problems, notices, markdown: render({ ok, results, problems, notices, all }) };
}

function render({ ok, results, problems, notices, all }) {
  const out = [MARKER];
  out.push(ok ? "### ✅ Registry check passed" : "### ❌ Registry check found problems");
  out.push("");
  if (!results.length && !problems.length) out.push(all ? "The registry is empty." : "No plugins were added or changed.");
  for (const p of problems) out.push(`- ❌ ${p}`);
  for (const n of notices) out.push(`- ℹ️ ${n}`);
  for (const r of results) {
    const { entry, check } = r;
    out.push("");
    out.push(`#### ${r.errors.length ? "❌" : "✅"} ${safe(entry?.name)} \`${safe(entry?.id, 100)}\`${all ? "" : ` (${r.kind})`}`);
    out.push("");
    out.push("| | |");
    out.push("| --- | --- |");
    out.push(`| Repo | [${safe(entry?.repo, 140)}](https://github.com/${encodeURI(String(entry?.repo ?? ""))}) |`);
    if (check?.release) out.push(`| Release | [${safe(check.release.tag, 60)}](${encodeURI(check.release.url ?? "")}) · ${safe(check.release.publishedAt?.slice(0, 10) ?? "", 20)} |`);
    if (check?.manifest) out.push(`| Version | ${safe(check.manifest.version, 40)} · SDK ${safe(check.manifest.sdkVersion || "2.0.0", 20)}${check.manifest.minAppVersion ? ` · app ≥ ${safe(check.manifest.minAppVersion, 20)}` : ""} |`);
    if (check?.assets?.length) {
      const wanted = new Set(["manifest.json", "styles.css", check.manifest?.entry || "main.js"]);
      const shown = check.assets.filter((a) => wanted.has(a.name));
      const others = check.assets.length - shown.length;
      out.push(`| Assets | ${shown.map((a) => `\`${safe(a.name, 60)}\` ${kb(a.size)}`).join(", ") || "none of manifest.json, main.js, styles.css"}${others ? ` (+${others} other${others === 1 ? "" : "s"})` : ""} |`);
    }
    if (r.sha256) out.push(`| Entry SHA-256 | \`${r.sha256}\` |`);
    if (check?.repoInfo) out.push(`| Owner | ${safe(check.repoInfo.owner, 60)} (${safe(check.repoInfo.ownerType, 20)}) · ${safe(check.repoInfo.license ?? "no license", 40)} · ★ ${Number(check.repoInfo.stars) || 0} |`);
    const perms = sortPermissions(Array.isArray(check?.manifest?.permissions) ? check.manifest.permissions : []);
    if (check?.manifest) {
      out.push(
        `| Permissions | ${
          perms.length
            ? perms
                .map((id) => {
                  const info = permissionInfo(id);
                  return `${info.risk === "high" ? "🔴" : info.risk === "medium" ? "🟡" : "⚪"} \`${safe(id, 40)}\``;
                })
                .join(" ")
            : "none"
        } |`,
      );
    }
    for (const e of r.errors) out.push(`- ❌ ${safe(e, 400, { code: true })}`);
    for (const w of r.warnings) out.push(`- ⚠️ ${safe(w, 400, { code: true })}`);
  }
  out.push("");
  out.push(
    ok
      ? "<sub>A maintainer still reads the plugin's source before merging. After the merge, every new GitHub Release reaches users as an update without another pull request.</sub>"
      : "<sub>Fix the release (`noteral-plugin release`) or the entry (`noteral-plugin submit`), and this comment updates itself.</sub>",
  );
  return out.join("\n");
}

// ── posting (gh) ───────────────────────────────────────────────────────────

function gh(args, input) {
  const res = spawnSync("gh", args, { input, encoding: "utf8" });
  return { ok: res.status === 0, out: (res.stdout ?? "").trim(), err: (res.stderr ?? "").trim() };
}

/** Creates or updates the bot's comment on an issue or pull request. */
export function upsertComment(repo, number, body) {
  const found = gh(["api", `repos/${repo}/issues/${number}/comments`, "--paginate", "-q", `.[] | select(.body | contains("${MARKER}")) | .id`]);
  const id = found.ok ? found.out.split("\n").filter(Boolean).pop() : "";
  const payload = JSON.stringify({ body });
  const res = id
    ? gh(["api", "-X", "PATCH", `repos/${repo}/issues/comments/${id}`, "--input", "-"], payload)
    : gh(["api", "-X", "POST", `repos/${repo}/issues/${number}/comments`, "--input", "-"], payload);
  if (!res.ok) console.error(`couldn't comment on #${number}: ${res.err}`);
  return res.ok;
}

/** Ensures the labels exist, then sets ready / needs-changes on the issue or PR. */
export function setLabels(repo, number, ok) {
  for (const label of Object.values(LABELS)) gh(["label", "create", label.name, "--repo", repo, "--color", label.color, "--description", label.description, "--force"]);
  const add = [LABELS.submission.name, ok ? LABELS.ready.name : LABELS.changes.name];
  const remove = ok ? LABELS.changes.name : LABELS.ready.name;
  gh(["api", "-X", "POST", `repos/${repo}/issues/${number}/labels`, "--input", "-"], JSON.stringify({ labels: add }));
  gh(["api", "-X", "DELETE", `repos/${repo}/issues/${number}/labels/${encodeURIComponent(remove)}`]);
}

// ── CLI ────────────────────────────────────────────────────────────────────

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const all = process.argv.includes("--all");
  const headFile = arg("head") ?? fileURLToPath(new URL("./community-plugins.json", import.meta.url));
  const baseFile = arg("base");
  const filesFile = arg("files");
  const result = await review({
    baseRaw: baseFile ? readFileSync(baseFile, "utf8") : "",
    headRaw: readFileSync(headFile, "utf8"),
    author: arg("author"),
    files: filesFile ? readFileSync(filesFile, "utf8").split("\n").map((s) => s.trim()).filter(Boolean) : [],
    all,
    token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
  });
  const out = arg("out");
  if (out) writeFileSync(out, `${result.markdown}\n`, { flag: out === process.env.GITHUB_STEP_SUMMARY ? "a" : "w" });
  else console.log(result.markdown);
  const pr = arg("comment");
  const repo = arg("repo") ?? process.env.GITHUB_REPOSITORY;
  if (pr && repo) {
    upsertComment(repo, pr, result.markdown);
    setLabels(repo, pr, result.ok);
  }
  process.exit(result.ok ? 0 : 1);
}
