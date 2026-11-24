#!/usr/bin/env node
// Turns a "Submit a community plugin" issue into a registry pull request, for
// developers who don't use the command line. Run by .github/workflows/
// registry-submit.yml with the issue in the environment:
//
//   ISSUE_NUMBER, ISSUE_BODY, ISSUE_AUTHOR, GITHUB_REPOSITORY, GH_TOKEN
//
// The issue body is untrusted: only the repo name (validated) and tags are read
// from it. The pull request it opens still needs a maintainer to merge it.
//
//   node registry/from-issue.mjs --dry-run   prints what it would do
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { formatRegistry, inspectRelease, REGISTRY_FILE, REPO_RE, registryEntry, validateRegistry } from "../sdk/cli/noteral-plugin.mjs";
import { MARKER, review, safe, setLabels, upsertComment } from "./review.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const dryRun = process.argv.includes("--dry-run");

/** Reads "### Label\n\nvalue" sections that GitHub issue forms produce. */
export function parseIssueForm(body) {
  const fields = {};
  const parts = String(body ?? "").split(/^###\s+/m).slice(1);
  for (const part of parts) {
    const [label, ...rest] = part.split("\n");
    const value = rest.join("\n").trim();
    fields[label.trim().toLowerCase()] = value === "_No response_" ? "" : value;
  }
  return fields;
}

/** Accepts owner/name or a github.com URL. */
export function parseRepo(value) {
  const s = String(value ?? "").trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "").replace(/\/+$/, "").split(/[?#\s]/)[0];
  return REPO_RE.test(s) ? s : null;
}

export function parseTags(value) {
  return String(value ?? "")
    .split(/[,\n]/)
    .map((t) => t.trim().toLowerCase().replace(/[^a-z0-9 -]/g, "").slice(0, 32))
    .filter(Boolean)
    .slice(0, 8);
}

function sh(cmd, args, input) {
  const res = spawnSync(cmd, args, { cwd: root, input, encoding: "utf8" });
  if (res.status !== 0) throw new Error(`${cmd} ${args[0]} failed: ${(res.stderr || res.stdout).trim()}`);
  return res.stdout.trim();
}

async function main() {
  const number = process.env.ISSUE_NUMBER;
  const repoName = process.env.GITHUB_REPOSITORY;
  const author = process.env.ISSUE_AUTHOR ?? "";
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const reply = (body) => {
    const text = `${MARKER}\n${body}`;
    if (dryRun || !number || !repoName) console.log(text);
    else upsertComment(repoName, number, text);
  };

  const fields = parseIssueForm(process.env.ISSUE_BODY);
  const repo = parseRepo(fields.repository);
  if (!repo) {
    reply(`### ❌ I couldn't read the repository\n\nEdit the issue and put your plugin's GitHub repo under **Repository**, as \`owner/name\`. I'll try again when you save.`);
    if (number && repoName && !dryRun) setLabels(repoName, number, false);
    return 1;
  }

  const check = await inspectRelease(repo, { token });
  if (!check.ok) {
    reply(
      [
        `### ❌ ${safe(repo)} can't be listed yet`,
        "",
        ...check.errors.map((e) => `- ❌ ${safe(e, 400)}`),
        ...check.warnings.map((w) => `- ⚠️ ${safe(w, 400)}`),
        "",
        "Publish a release with `manifest.json` and `main.js` as assets (`node scripts/noteral-plugin.mjs release` in your plugin repo), then edit this issue to run the check again.",
      ].join("\n"),
    );
    if (number && repoName && !dryRun) setLabels(repoName, number, false);
    return 1;
  }

  const file = `${root}/${REGISTRY_FILE}`;
  const baseRaw = readFileSync(file, "utf8");
  const base = JSON.parse(baseRaw);
  const { entries } = validateRegistry(base);
  const manifest = check.manifest;
  const existing = entries.find((e) => e.id === manifest.id);
  const clash = entries.find((e) => e.repo.toLowerCase() === repo.toLowerCase() && e.id !== manifest.id);
  if ((existing && existing.repo.toLowerCase() !== repo.toLowerCase()) || clash) {
    reply(`### ❌ Already listed\n\n${existing ? `\`${safe(manifest.id)}\` is listed for ${safe(existing.repo)}` : `${safe(repo)} is listed as \`${safe(clash.id)}\``}. A maintainer will take a look.`);
    return 1;
  }
  const tags = parseTags(fields.tags);
  const entry = registryEntry({ ...manifest, repo }, { tags: tags.length ? tags : undefined, previous: existing });
  if (existing && JSON.stringify(existing) === JSON.stringify(entry)) {
    reply(`### ✅ ${safe(entry.name)} is already listed\n\nNew releases reach users automatically, so there's nothing to change. Closing this issue is fine.`);
    return 0;
  }
  const headRaw = formatRegistry(base, existing ? entries.map((e) => (e.id === entry.id ? entry : e)) : [...entries, entry]);
  const result = await review({ baseRaw, headRaw, author, files: [REGISTRY_FILE], token });
  if (dryRun || !number || !repoName) {
    console.log(headRaw);
    console.log(result.markdown);
    return result.ok ? 0 : 1;
  }

  const branch = `plugin/${entry.id}`;
  const title = `${existing ? "Update" : "Add"} plugin: ${entry.name}`;
  writeFileSync(file, headRaw);
  sh("git", ["config", "user.name", "github-actions[bot]"]);
  sh("git", ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
  sh("git", ["switch", "-C", branch]);
  sh("git", ["commit", "-am", `${title} (${entry.id})\n\nSubmitted in #${number} by ${author}.`]);
  sh("git", ["push", "--force", "origin", branch]);
  const body = [
    `${existing ? "Updates" : "Adds"} **${safe(entry.name)}** from [${safe(repo)}](https://github.com/${repo}), submitted by ${safe(author)} in #${number}.`,
    "",
    `Closes #${number}`,
  ].join("\n");
  const open = sh("gh", ["pr", "list", "--repo", repoName, "--head", branch, "--state", "open", "--json", "number", "-q", ".[0].number"]);
  const pr = open || sh("gh", ["pr", "create", "--repo", repoName, "--head", branch, "--title", title, "--body-file", "-"], body).split("/").pop();
  // Pull requests opened with the workflow token don't trigger other workflows,
  // so post the bot's review here.
  upsertComment(repoName, pr, result.markdown);
  setLabels(repoName, pr, result.ok);
  reply(`### ${result.ok ? "✅" : "⚠️"} Opened #${pr}\n\nThe release checks ${result.ok ? "passed" : "found problems (see the pull request)"}. A maintainer will review the plugin and merge it; after that it appears in every Noteral's Community tab.`);
  setLabels(repoName, number, result.ok);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(await main());
}
