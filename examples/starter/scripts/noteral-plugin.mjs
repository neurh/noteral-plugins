#!/usr/bin/env node
// noteral-plugin: create, build, check, release and submit Noteral community
// plugins. Publishing goes through the GitHub CLI (gh), so there is no Noteral
// server and no extra account: your repo hosts the releases, and the registry
// is a pull request to neurh/noteral-plugins (the public plugin hub).
//
//   node noteral-plugin.mjs help
//
// One file, no dependencies, Node 18+. Plugin repos keep a copy in
// scripts/noteral-plugin.mjs. The hub's registry bot imports the same
// rules (registry/review.mjs), so `check` locally means the same as the bot's
// check on your pull request.
//
// Source: sdk/cli/noteral-plugin.mjs in https://github.com/neurh/noteral-plugins.
// The block between the @generated markers is written by scripts/build-sdk.mjs.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

// @generated permissions start
export const SDK_VERSION = "2.2.0";
export const PERMISSIONS = [
  { id: "editor.read", title: "Read the open page", risk: "low" },
  { id: "editor.write", title: "Edit the open page", risk: "medium" },
  { id: "pages.read", title: "Read pages", risk: "medium" },
  { id: "pages.write", title: "Change pages", risk: "high" },
  { id: "databases.read", title: "Read databases", risk: "medium" },
  { id: "databases.write", title: "Change databases", risk: "high" },
  { id: "navigation", title: "Navigate", risk: "low" },
  { id: "search.read", title: "Search", risk: "medium" },
  { id: "ui.status", title: "Status bar", risk: "low" },
  { id: "ui.notify", title: "Notifications", risk: "low" },
  { id: "ui.panel", title: "Sidebar tabs", risk: "low" },
  { id: "ui.modal", title: "Dialogs", risk: "low" },
  { id: "ui.styles", title: "Plugin styles", risk: "medium" },
  { id: "settings.read", title: "Read its settings", risk: "low" },
  { id: "settings.write", title: "Save its settings", risk: "low" },
  { id: "assets.read", title: "Read files", risk: "low" },
  { id: "assets.write", title: "Import files", risk: "low" },
  { id: "workspaces.read", title: "See workspaces", risk: "low" },
  { id: "workspaces.write", title: "Manage workspaces", risk: "high" },
  { id: "layout", title: "Layout", risk: "low" },
  { id: "appearance", title: "Appearance", risk: "medium" },
  { id: "preferences", title: "Preferences", risk: "medium" },
  { id: "commands.execute", title: "Run commands", risk: "high" },
  { id: "clipboard", title: "Clipboard", risk: "medium" },
  { id: "network", title: "Internet access", risk: "high" },
  { id: "network.local", title: "Local network access", risk: "high" },
  { id: "blocks", title: "Custom blocks", risk: "low" },
  { id: "nodes", title: "Custom page types", risk: "low" },
  { id: "home", title: "Home", risk: "medium" },
  { id: "menus", title: "Menu items", risk: "low" },
];
// @generated permissions end

export const CLI_VERSION = "1.0.0";
export const DEFAULT_REGISTRY = "neurh/noteral-plugins";
export const REGISTRY_FILE = "registry/community-plugins.json";
export const ESBUILD = "esbuild@0.28.2";

// Same rules as internal/plugins (validateManifest, ParseRegistry, downloadRelease).
export const LIMITS = {
  idLength: 100,
  name: 80,
  description: 500,
  tags: 8,
  tagLength: 32,
  commands: 40,
  statusItems: 12,
  panels: 8,
  manifestBytes: 256 << 10,
  entryBytes: 2 << 20,
  stylesBytes: 512 << 10,
  sdkMajors: [1, 2],
};
export const ID_RE = /^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*)+$/;
export const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
export const VERSION_RE = /^\d+\.\d+\.\d+([0-9A-Za-z.+-]+)?$/;
const ITEM_ID_RE = /^[a-z][a-z0-9-]{1,48}$/;
const REGISTRY_FIELDS = ["id", "name", "author", "description", "repo", "tags"];

// ── rules ──────────────────────────────────────────────────────────────────

const text = (value) => (typeof value === "string" ? value.trim() : "");
const chars = (value) => [...value].length;

/**
 * Checks a manifest the way the app does before installing it.
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateManifest(manifest, { forRelease = false } = {}) {
  const errors = [];
  const warnings = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { errors: ["manifest.json must be a JSON object"], warnings };
  }
  const id = text(manifest.id);
  if (!ID_RE.test(id) || id.length > LIMITS.idLength) errors.push(`id "${id}" must be reverse-domain and lowercase, e.g. com.you.plugin-name`);
  const name = text(manifest.name);
  if (!name || chars(name) > LIMITS.name) errors.push(`name is required (at most ${LIMITS.name} characters)`);
  if (!VERSION_RE.test(text(manifest.version))) errors.push(`version "${text(manifest.version)}" must be semver, e.g. 1.0.0`);
  const sdk = text(manifest.sdkVersion);
  if (sdk) {
    const major = Number(sdk.split(".")[0]);
    if (!VERSION_RE.test(sdk) || !LIMITS.sdkMajors.includes(major)) errors.push(`sdkVersion "${sdk}" is not supported (use ${SDK_VERSION})`);
  } else {
    warnings.push(`sdkVersion is missing; the app assumes ${SDK_VERSION}`);
  }
  const minApp = text(manifest.minAppVersion);
  if (minApp && !VERSION_RE.test(minApp)) errors.push(`minAppVersion "${minApp}" must be semver, e.g. 0.1.0`);
  const repo = text(manifest.repo);
  if (repo && !REPO_RE.test(repo)) errors.push(`repo "${repo}" must look like owner/name`);
  if (!repo && forRelease) errors.push(`repo is required to publish: set it to your GitHub "owner/name"`);
  if (chars(text(manifest.description)) > LIMITS.description) errors.push(`description is limited to ${LIMITS.description} characters`);
  if (!text(manifest.description)) warnings.push("description is empty; the store shows it under the name");
  if (!text(manifest.author)) warnings.push("author is empty");
  const entry = text(manifest.entry) || "main.js";
  const clean = path.posix.normalize(entry.replaceAll("\\", "/"));
  if (clean === "." || clean.startsWith("../") || clean.startsWith("/")) errors.push(`entry "${entry}" must stay inside the plugin folder`);
  else if (forRelease && clean.includes("/")) errors.push(`entry "${entry}" must be a top-level file: releases ship it as a single asset`);
  if (manifest.permissions !== undefined && !Array.isArray(manifest.permissions)) errors.push("permissions must be a list");
  const known = new Set(PERMISSIONS.map((p) => p.id));
  const seen = new Set();
  for (const perm of Array.isArray(manifest.permissions) ? manifest.permissions : []) {
    if (!known.has(perm)) errors.push(`unknown permission "${perm}"${suggest(perm, [...known])}`);
    else if (seen.has(perm)) errors.push(`duplicate permission "${perm}"`);
    seen.add(perm);
  }
  const contributes = manifest.contributes ?? {};
  const list = (key) => (Array.isArray(contributes[key]) ? contributes[key] : []);
  if (list("commands").length > LIMITS.commands || list("statusItems").length > LIMITS.statusItems || list("panels").length > LIMITS.panels) {
    errors.push(`contributes too many items (at most ${LIMITS.commands} commands, ${LIMITS.statusItems} status items, ${LIMITS.panels} panels)`);
  }
  const checkItems = (key, label, needs) => {
    const ids = new Set();
    for (const item of list(key)) {
      const itemId = text(item?.id);
      if (!ITEM_ID_RE.test(itemId)) errors.push(`${label} id "${itemId}" must be lowercase letters, digits and dashes`);
      else if (ids.has(itemId)) errors.push(`duplicate ${label} id "${itemId}"`);
      if (!text(item?.[needs])) errors.push(`${label} "${itemId}" needs a ${needs}`);
      ids.add(itemId);
    }
  };
  checkItems("commands", "command", "title");
  checkItems("statusItems", "status item", "label");
  checkItems("panels", "panel", "title");
  return { errors, warnings };
}

/**
 * Checks registry/community-plugins.json.
 * @returns {{ errors: string[], entries: object[] }}
 */
export function validateRegistry(data) {
  const errors = [];
  const entries = Array.isArray(data) ? data : data?.plugins;
  if (!Array.isArray(entries)) return { errors: ['the file must be { "version": 1, "plugins": [...] }'], entries: [] };
  const ids = new Set();
  const repos = new Set();
  entries.forEach((entry, index) => {
    const at = `plugins[${index}]${entry?.id ? ` (${entry.id})` : ""}`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`${at}: must be an object`);
      return;
    }
    for (const key of Object.keys(entry)) if (!REGISTRY_FIELDS.includes(key)) errors.push(`${at}: unknown field "${key}"`);
    const id = text(entry.id);
    if (!ID_RE.test(id) || id.length > LIMITS.idLength) errors.push(`${at}: id must be reverse-domain and lowercase, e.g. com.you.plugin-name`);
    if (ids.has(id)) errors.push(`${at}: duplicate id`);
    ids.add(id);
    if (!text(entry.name) || chars(text(entry.name)) > LIMITS.name) errors.push(`${at}: name is required (at most ${LIMITS.name} characters)`);
    const repo = text(entry.repo).toLowerCase();
    if (!REPO_RE.test(text(entry.repo))) errors.push(`${at}: repo must be "owner/name" on GitHub`);
    else if (repos.has(repo)) errors.push(`${at}: ${entry.repo} is already listed`);
    repos.add(repo);
    if (chars(text(entry.description)) > LIMITS.description) errors.push(`${at}: description is limited to ${LIMITS.description} characters`);
    if (entry.tags !== undefined && (!Array.isArray(entry.tags) || entry.tags.length > LIMITS.tags || entry.tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag.length > LIMITS.tagLength))) {
      errors.push(`${at}: tags must be up to ${LIMITS.tags} strings of at most ${LIMITS.tagLength} characters`);
    }
  });
  return { errors, entries };
}

/** The registry entry for a manifest. Registry fields not in the manifest (tags) are kept from `previous`. */
export function registryEntry(manifest, { tags, previous } = {}) {
  const entry = { id: text(manifest.id), name: text(manifest.name) };
  if (text(manifest.author)) entry.author = text(manifest.author);
  if (text(manifest.description)) entry.description = text(manifest.description);
  entry.repo = text(manifest.repo);
  const keep = tags ?? previous?.tags;
  if (Array.isArray(keep) && keep.length) entry.tags = keep;
  return entry;
}

/** Serialises the registry the way every tool writes it, so diffs stay one entry long. */
export function formatRegistry(data, entries) {
  return `${JSON.stringify({ ...data, version: data?.version ?? 1, plugins: entries }, null, 2)}\n`;
}

export function compareVersions(a, b) {
  const parse = (v) => text(v).replace(/^v/, "").split(/[-+]/)[0].split(".").map((n) => Number(n) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0) ? -1 : 1;
  return 0;
}

export function bumpVersion(version, kind) {
  if (VERSION_RE.test(kind)) return kind;
  const [major, minor, patch] = text(version).split(/[-+]/)[0].split(".").map((n) => Number(n) || 0);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  if (kind === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new CliError(`Unknown version bump "${kind}". Use patch, minor, major or a version like 1.4.0.`);
}

export function permissionInfo(id) {
  return PERMISSIONS.find((p) => p.id === id) ?? { id, title: id, risk: "unknown", description: "" };
}

const RISK_ORDER = { high: 0, medium: 1, low: 2, unknown: 3 };
export const sortPermissions = (ids) => [...ids].sort((a, b) => RISK_ORDER[permissionInfo(a).risk] - RISK_ORDER[permissionInfo(b).risk] || a.localeCompare(b));

/**
 * Reads a repo's latest GitHub Release the way the app's store does and checks
 * that it installs: manifest.json + entry (+ optional styles.css) as assets.
 * Works without a token (rate limited) or with GITHUB_TOKEN / GH_TOKEN.
 */
export async function inspectRelease(repo, { token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN, apiBase = process.env.NOTERAL_GITHUB_API || "https://api.github.com" } = {}) {
  const result = { repo, ok: false, errors: [], warnings: [], release: null, manifest: null, assets: [] };
  if (!REPO_RE.test(repo)) {
    result.errors.push(`"${repo}" is not a GitHub owner/name`);
    return result;
  }
  const headers = { accept: "application/vnd.github+json", "user-agent": "noteral-plugin", "x-github-api-version": "2022-11-28" };
  if (token) headers.authorization = `Bearer ${token}`;
  const repoInfo = await fetch(`${apiBase}/repos/${repo}`, { headers });
  if (repoInfo.status === 404) {
    result.errors.push(`github.com/${repo} doesn't exist or is private. Noteral can only install from public repos.`);
    return result;
  }
  if (repoInfo.ok) {
    const info = await repoInfo.json();
    if (info.private) result.errors.push(`github.com/${repo} is private. Noteral can only install from public repos.`);
    if (info.archived) result.warnings.push(`github.com/${repo} is archived`);
    result.repoInfo = { owner: info.owner?.login, ownerType: info.owner?.type, fullName: info.full_name, stars: info.stargazers_count, license: info.license?.spdx_id ?? null };
    if (info.full_name && info.full_name !== repo) result.warnings.push(`the repo is now called ${info.full_name}; use that name`);
  }
  const latest = await fetch(`${apiBase}/repos/${repo}/releases/latest`, { headers });
  if (latest.status === 404) {
    result.errors.push(`${repo} has no published release. Drafts and pre-releases don't count; run \`noteral-plugin release\`.`);
    return result;
  }
  if (!latest.ok) {
    result.errors.push(`GitHub answered ${latest.status} for ${repo}'s latest release`);
    return result;
  }
  const release = await latest.json();
  result.release = { tag: release.tag_name, url: release.html_url, publishedAt: release.published_at, name: release.name };
  result.assets = (release.assets ?? []).map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url }));
  const asset = (name) => result.assets.find((a) => a.name === name);
  const manifestAsset = asset("manifest.json");
  if (!manifestAsset) {
    result.errors.push(`release ${release.tag_name} has no manifest.json asset (attach it to the release, not only the repo)`);
    return result;
  }
  if (manifestAsset.size > LIMITS.manifestBytes) result.errors.push("manifest.json is larger than 256 KB");
  let manifest;
  try {
    const response = await fetch(manifestAsset.url, { headers: { "user-agent": "noteral-plugin" }, redirect: "follow" });
    if (!response.ok) throw new Error(`download failed (${response.status})`);
    manifest = JSON.parse(await response.text());
  } catch (error) {
    result.errors.push(`release manifest.json can't be read: ${error.message}`);
    return result;
  }
  result.manifest = manifest;
  const check = validateManifest(manifest, { forRelease: true });
  result.errors.push(...check.errors.map((e) => `manifest.json: ${e}`));
  result.warnings.push(...check.warnings.map((e) => `manifest.json: ${e}`));
  if (text(manifest.repo) && text(manifest.repo).toLowerCase() !== repo.toLowerCase()) {
    result.errors.push(`manifest.json says repo "${manifest.repo}" but the release is in ${repo}`);
  }
  if (compareVersions(release.tag_name, manifest.version) !== 0) {
    result.warnings.push(`release tag ${release.tag_name} doesn't match manifest version ${manifest.version}`);
  }
  const entry = text(manifest.entry) || "main.js";
  const code = asset(entry);
  if (!code) result.errors.push(`release ${release.tag_name} is missing the ${entry} asset`);
  else if (code.size > LIMITS.entryBytes) result.errors.push(`${entry} is ${kb(code.size)}; the limit is ${kb(LIMITS.entryBytes)}`);
  else if (code.size === 0) result.errors.push(`${entry} is empty`);
  const styles = asset("styles.css");
  if (styles && styles.size > LIMITS.stylesBytes) result.errors.push(`styles.css is ${kb(styles.size)}; the limit is ${kb(LIMITS.stylesBytes)}`);
  result.ok = result.errors.length === 0;
  return result;
}

export const kb = (bytes) => (bytes < 1024 ? `${bytes} B` : bytes < 1 << 20 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1 << 20)).toFixed(2)} MB`);

function suggest(value, options) {
  const near = options.find((o) => o.split(".")[0] === String(value).split(".")[0]) ?? options.find((o) => o.includes(String(value).split(".")[0]));
  return near ? ` (did you mean "${near}"?)` : "";
}

// ── process helpers ────────────────────────────────────────────────────────

export class CliError extends Error {}

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = paint(1);
const dim = paint(2);
const red = paint(31);
const green = paint(32);
const yellow = paint(33);
const cyan = paint(36);
const ok = (msg) => console.log(`${green("✓")} ${msg}`);
const warn = (msg) => console.log(`${yellow("!")} ${msg}`);
const step = (msg) => console.log(`${cyan("→")} ${msg}`);

function run(cmd, args, { cwd, input, allowFail = false, inherit = false } = {}) {
  const res = spawnSync(cmd, args, { cwd, input, encoding: "utf8", stdio: inherit ? ["inherit", "inherit", "inherit"] : ["pipe", "pipe", "pipe"], maxBuffer: 64 << 20 });
  if (res.error) {
    if (res.error.code === "ENOENT") throw new CliError(cmd === "gh" ? GH_MISSING : `${cmd} is not installed`);
    throw res.error;
  }
  if (res.status !== 0 && !allowFail) {
    const detail = (res.stderr || res.stdout || "").trim();
    throw new CliError(`${cmd} ${args.slice(0, 3).join(" ")} failed${detail ? `:\n${detail}` : ""}`);
  }
  return { ok: res.status === 0, out: (res.stdout ?? "").trim(), err: (res.stderr ?? "").trim() };
}

const GH_MISSING = "This needs the GitHub CLI. Install it from https://cli.github.com, then run `gh auth login`.";

function gh(args, opts) {
  return run("gh", args, opts);
}

function ghJson(args, opts) {
  const res = gh(args, { ...opts, allowFail: true });
  if (!res.ok) return null;
  try {
    return JSON.parse(res.out);
  } catch {
    return null;
  }
}

/** `gh api` with a JSON body on stdin (avoids argument-length limits). */
function ghApi(method, route, body, { allowFail = false } = {}) {
  const args = ["api", "-X", method, route, "-H", "Accept: application/vnd.github+json"];
  if (body !== undefined) args.push("--input", "-");
  const res = gh(args, { input: body === undefined ? undefined : JSON.stringify(body), allowFail: true });
  let data = null;
  try {
    data = res.out ? JSON.parse(res.out) : null;
  } catch {
    data = null;
  }
  if (!res.ok && !allowFail) throw new CliError(`GitHub ${method} ${route} failed: ${data?.message ?? res.err ?? res.out}`);
  return { ok: res.ok, data, err: res.err };
}

let ghUser = null;
function requireGh() {
  if (ghUser) return ghUser;
  gh(["--version"]);
  const auth = gh(["auth", "status"], { allowFail: true });
  if (!auth.ok) throw new CliError("You're not signed in to GitHub. Run `gh auth login` and try again.");
  ghUser = gh(["api", "user", "-q", ".login"]).out;
  return ghUser;
}

function git(args, cwd, opts = {}) {
  return run("git", args, { cwd, ...opts });
}

async function confirm(question, flags) {
  if (flags.yes) return true;
  if (!process.stdin.isTTY) throw new CliError(`${question}\nNot a terminal: pass --yes to continue without asking.`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} ${dim("[Y/n]")} `)).trim().toLowerCase();
    return answer === "" || answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function ask(rl, question, fallback = "") {
  const answer = (await rl.question(`${question}${fallback ? dim(` (${fallback})`) : ""}: `)).trim();
  return answer || fallback;
}

// ── plugin folder ──────────────────────────────────────────────────────────

function readManifest(dir) {
  const file = path.join(dir, "manifest.json");
  if (!existsSync(file)) throw new CliError(`No manifest.json in ${dir}. Run this in your plugin folder, or create one with \`noteral-plugin init\`.`);
  const raw = readFileSync(file, "utf8");
  try {
    return { file, raw, manifest: JSON.parse(raw) };
  } catch (error) {
    throw new CliError(`manifest.json is not valid JSON: ${error.message}`);
  }
}

/** Updates top-level string fields without reformatting the rest of the file. */
function writeManifestFields(file, raw, fields) {
  let next = raw;
  for (const [key, value] of Object.entries(fields)) {
    const re = new RegExp(`("${key}"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`);
    if (re.test(next)) next = next.replace(re, `$1${JSON.stringify(value)}`);
    else {
      const data = JSON.parse(next);
      data[key] = value;
      next = `${JSON.stringify(data, null, 2)}\n`;
    }
  }
  writeFileSync(file, next);
  return next;
}

function sourceEntry(dir) {
  for (const name of ["src/main.ts", "src/main.tsx", "src/main.js", "src/index.ts", "src/index.js"]) {
    if (existsSync(path.join(dir, name))) return name;
  }
  return null;
}

function localFiles(dir, manifest) {
  const entry = text(manifest.entry) || "main.js";
  const files = [{ name: "manifest.json", file: path.join(dir, "manifest.json") }, { name: entry, file: path.join(dir, entry) }];
  if (existsSync(path.join(dir, "styles.css"))) files.push({ name: "styles.css", file: path.join(dir, "styles.css") });
  return files;
}

function githubRepoOf(dir) {
  const res = gh(["repo", "view", "--json", "nameWithOwner,visibility,defaultBranchRef"], { cwd: dir, allowFail: true });
  if (!res.ok) return null;
  try {
    return JSON.parse(res.out);
  } catch {
    return null;
  }
}

// ── commands ───────────────────────────────────────────────────────────────

async function cmdBuild(dir, flags, { quiet = false } = {}) {
  const { manifest } = readManifest(dir);
  const source = sourceEntry(dir);
  const entry = text(manifest.entry) || "main.js";
  if (!source) {
    if (!quiet) warn(`No src/main.ts; using ${entry} as it is.`);
    return;
  }
  const local = path.join(dir, "node_modules", ".bin", process.platform === "win32" ? "esbuild.cmd" : "esbuild");
  const [cmd, pre] = existsSync(local) ? [local, []] : [process.platform === "win32" ? "npx.cmd" : "npx", ["--yes", ESBUILD]];
  // Not minified: reviewers and users can read what they install.
  const args = [...pre, source, "--bundle", "--format=iife", "--target=es2020", `--outfile=${entry}`, "--log-level=warning", "--legal-comments=inline"];
  if (flags.watch) args.push("--watch");
  step(`Building ${source} → ${entry}`);
  const res = run(cmd, args, { cwd: dir, allowFail: true, inherit: Boolean(flags.watch) });
  if (!res.ok) throw new CliError(`Build failed:\n${res.err || res.out}`);
  if (!quiet) ok(`Built ${entry} (${kb(statSync(path.join(dir, entry)).size)})`);
}

function checkLocal(dir, { forRelease = false } = {}) {
  const { manifest } = readManifest(dir);
  const { errors, warnings } = validateManifest(manifest, { forRelease });
  const files = localFiles(dir, manifest);
  for (const f of files.slice(1)) {
    if (!existsSync(f.file)) {
      errors.push(`${f.name} doesn't exist${f.name.endsWith(".js") ? ": run `noteral-plugin build`" : ""}`);
      continue;
    }
    const size = statSync(f.file).size;
    f.size = size;
    const limit = f.name === "styles.css" ? LIMITS.stylesBytes : LIMITS.entryBytes;
    if (size > limit) errors.push(`${f.name} is ${kb(size)}; the limit is ${kb(limit)}`);
    if (f.name.endsWith(".js")) {
      const code = readFileSync(f.file, "utf8");
      if (!/\bregister\s*\(|definePlugin\s*\(|Noteral\.register/.test(code)) warnings.push(`${f.name} never calls register(...) or definePlugin(...), so the plugin won't start`);
      if (/\beval\s*\(|new Function\s*\(/.test(code)) warnings.push(`${f.name} uses eval/new Function; reviewers will ask why`);
    }
  }
  files[0].size = statSync(files[0].file).size;
  return { manifest, errors, warnings, files };
}

function printCheck({ manifest, errors, warnings, files }) {
  console.log(`${bold(text(manifest.name) || "(no name)")} ${dim(`${text(manifest.id)} ${text(manifest.version)}`)}`);
  for (const f of files) if (f.size !== undefined) console.log(`  ${f.name.padEnd(16)} ${dim(kb(f.size))}`);
  const perms = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  console.log(`  ${perms.length ? "permissions" : dim("no permissions")}`);
  for (const id of sortPermissions(perms)) {
    const info = permissionInfo(id);
    const risk = info.risk === "high" ? red(info.risk) : info.risk === "medium" ? yellow(info.risk) : dim(info.risk);
    console.log(`    ${id.padEnd(18)} ${risk.padEnd(color ? 15 : 6)} ${dim(info.title)}`);
  }
  for (const w of warnings) warn(w);
  for (const e of errors) console.log(`${red("✗")} ${e}`);
}

async function cmdCheck(dir, flags) {
  if (!flags["no-build"] && sourceEntry(dir)) await cmdBuild(dir, flags, { quiet: true });
  const result = checkLocal(dir, { forRelease: Boolean(flags.release) });
  printCheck(result);
  if (result.errors.length) throw new CliError(`${result.errors.length} problem${result.errors.length === 1 ? "" : "s"} to fix.`);
  ok("Ready to install");
}

async function cmdRelease(dir, flags, positional) {
  requireGh();
  const top = git(["rev-parse", "--show-toplevel"], dir, { allowFail: true });
  if (!top.ok) throw new CliError("This folder isn't a git repository. Run `git init`, commit, and create the GitHub repo with `gh repo create --source . --push`.");
  const remote = githubRepoOf(dir);
  if (!remote) throw new CliError("This repo has no GitHub remote yet. Create it with:\n  gh repo create <name> --public --source . --push");
  if (remote.visibility && remote.visibility !== "PUBLIC") throw new CliError(`github.com/${remote.nameWithOwner} is ${remote.visibility.toLowerCase()}. Noteral installs from public repos only: gh repo edit --visibility public`);
  const dirty = git(["status", "--porcelain"], dir).out.split("\n").filter(Boolean);
  const ignorable = (line) => /^.. (main\.js|styles\.css)$/.test(line);
  const blocking = dirty.filter((line) => !ignorable(line));
  if (blocking.length && !flags["allow-dirty"]) throw new CliError(`Commit or stash your changes first (or pass --allow-dirty):\n${blocking.map((l) => `  ${l}`).join("\n")}`);

  let { file, raw, manifest } = readManifest(dir);
  const repo = remote.nameWithOwner;
  if (!text(manifest.repo)) {
    raw = writeManifestFields(file, raw, { repo });
    manifest = JSON.parse(raw);
    ok(`Set manifest.json repo to ${repo}`);
  } else if (text(manifest.repo).toLowerCase() !== repo.toLowerCase()) {
    throw new CliError(`manifest.json says repo "${manifest.repo}", but this folder pushes to ${repo}. Fix one of them.`);
  }

  const latest = ghJson(["release", "view", "--repo", repo, "--json", "tagName,url,isDraft"]);
  const current = text(manifest.version);
  let next = current;
  if (positional[0]) next = bumpVersion(current, positional[0]);
  else if (latest && compareVersions(latest.tagName, current) >= 0) next = bumpVersion(text(latest.tagName).replace(/^v/, ""), "patch");
  if (!VERSION_RE.test(next)) throw new CliError(`"${next}" isn't a valid version`);
  if (latest && compareVersions(next, latest.tagName) <= 0) throw new CliError(`${next} isn't newer than the latest release (${latest.tagName}). Pass a higher version, e.g. \`release ${bumpVersion(latest.tagName.replace(/^v/, ""), "patch")}\`.`);
  const tag = next;
  if (git(["rev-parse", "-q", "--verify", `refs/tags/${tag}`], dir, { allowFail: true }).ok) throw new CliError(`Tag ${tag} already exists locally. Pick another version or delete it with \`git tag -d ${tag}\`.`);

  const original = raw;
  if (next !== current) raw = writeManifestFields(file, raw, { version: next });
  try {
    await cmdBuild(dir, flags, { quiet: true });
    const result = checkLocal(dir, { forRelease: true });
    printCheck(result);
    if (result.errors.length) throw new CliError("Fix these before releasing.");
    var files = result.files;
  } catch (error) {
    writeFileSync(file, original);
    throw error;
  }

  console.log("");
  console.log(`Release ${bold(`${text(manifest.name)} ${next}`)} to ${bold(`github.com/${repo}`)}${latest ? dim(` (latest: ${latest.tagName})`) : dim(" (first release)")}`);
  console.log(dim(`  commit manifest.json, tag ${tag}, push, and upload ${files.map((f) => f.name).join(", ")}`));
  if (!(await confirm("Continue?", flags))) {
    writeFileSync(file, original);
    console.log("Cancelled. manifest.json is unchanged.");
    return;
  }

  const tracked = (name) => git(["ls-files", "--error-unmatch", name], dir, { allowFail: true }).ok;
  const toAdd = ["manifest.json", ...files.slice(1).map((f) => f.name).filter(tracked)];
  git(["add", ...toAdd], dir);
  if (!git(["diff", "--cached", "--quiet"], dir, { allowFail: true }).ok) {
    git(["commit", "-m", `Release ${next}`], dir);
    ok(`Committed Release ${next}`);
  }
  git(["tag", "-a", tag, "-m", `${text(manifest.name)} ${next}`], dir);
  step("Pushing…");
  const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], dir, { allowFail: true });
  if (upstream.ok) git(["push"], dir);
  else git(["push", "-u", "origin", "HEAD"], dir);
  git(["push", "origin", tag], dir);
  ok(`Pushed tag ${tag}`);

  const notes = flags.notes ? ["--notes", String(flags.notes)] : flags["notes-file"] ? ["--notes-file", String(flags["notes-file"])] : ["--generate-notes"];
  const assets = files.map((f) => f.file);
  const create = gh(["release", "create", tag, ...assets, "--repo", repo, "--title", `${text(manifest.name)} ${next}`, "--verify-tag", ...notes, ...(flags.draft ? ["--draft"] : [])], { cwd: dir, allowFail: true });
  if (!create.ok) {
    // The repo's release workflow may have created it first; upload our assets.
    if (ghJson(["release", "view", tag, "--repo", repo, "--json", "tagName"])) gh(["release", "upload", tag, ...assets, "--repo", repo, "--clobber"], { cwd: dir });
    else throw new CliError(`gh release create failed:\n${create.err}`);
  }
  const url = ghJson(["release", "view", tag, "--repo", repo, "--json", "url"])?.url ?? `https://github.com/${repo}/releases/tag/${tag}`;
  ok(`Published ${url}`);
  if (flags.draft) {
    warn("It's a draft: users won't see it until you publish it on GitHub (gh release edit --draft=false).");
    return;
  }
  const listed = findInRegistry(flags.registry ?? DEFAULT_REGISTRY, text(manifest.id));
  if (listed?.entry) console.log(`\nNoteral users get ${next} the next time they check for updates. No pull request needed.`);
  else console.log(`\nNext: ${bold("noteral-plugin submit")} to list it in the community store.`);
}

function readRegistryFile(registry, ref) {
  const res = ghApi("GET", `repos/${registry}/contents/${REGISTRY_FILE}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`, undefined, { allowFail: true });
  if (!res.ok || !res.data?.content) return null;
  const raw = Buffer.from(res.data.content, "base64").toString("utf8");
  return { sha: res.data.sha, raw, data: JSON.parse(raw) };
}

function findInRegistry(registry, id) {
  try {
    const file = readRegistryFile(registry);
    if (!file) return null;
    const entries = Array.isArray(file.data) ? file.data : file.data.plugins ?? [];
    return { file, entry: entries.find((e) => e.id === id) ?? null, entries };
  } catch {
    return null;
  }
}

function findFork(registry, login) {
  const name = registry.split("/")[1];
  const own = ghApi("GET", `repos/${login}/${name}`, undefined, { allowFail: true });
  const parent = (d) => [d?.parent?.full_name, d?.source?.full_name].map((n) => n?.toLowerCase());
  if (own.ok && parent(own.data).includes(registry.toLowerCase())) return own.data.full_name;
  const forks = gh(["api", `repos/${registry}/forks?per_page=100`, "--paginate", "-q", `.[] | select(.owner.login == "${login}") | .full_name`], { allowFail: true });
  return forks.ok ? forks.out.split("\n").filter(Boolean)[0] ?? null : null;
}

async function ensureFork(registry, login) {
  let fork = findFork(registry, login);
  if (fork) return fork;
  step(`Forking ${registry} to your account…`);
  gh(["repo", "fork", registry, "--clone=false", "--default-branch-only"], { allowFail: true });
  for (let i = 0; i < 20 && !fork; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    fork = findFork(registry, login);
  }
  if (!fork) throw new CliError(`Couldn't fork ${registry}. Fork it on github.com, then run submit again.`);
  ok(`Forked to ${fork}`);
  return fork;
}

function prBody({ manifest, entry, check, existing, login }) {
  const perms = sortPermissions(Array.isArray(manifest.permissions) ? manifest.permissions : []);
  const lines = [
    `${existing ? "Updates" : "Adds"} **${entry.name}** (\`${entry.id}\`) ${existing ? "in" : "to"} the community plugin registry.`,
    "",
    "| | |",
    "| --- | --- |",
    `| Repo | [${entry.repo}](https://github.com/${entry.repo}) |`,
    `| Latest release | [${check.release?.tag}](${check.release?.url}) |`,
    `| Author | ${entry.author ?? login} |`,
    `| Description | ${(entry.description ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ")} |`,
    `| Assets | ${check.assets.map((a) => `\`${a.name}\` (${kb(a.size)})`).join(", ")} |`,
    "",
    perms.length ? "**Permissions**" : "**Permissions:** none",
    ...perms.map((id) => {
      const info = permissionInfo(id);
      return `- \`${id}\` (${info.risk}): ${info.title}`;
    }),
    "",
    "**Checklist**",
    "- [x] Release has `manifest.json` and the entry file as assets (checked by `noteral-plugin submit`)",
    "- [x] I own or maintain this repository",
    "- [x] The release's code is readable (not obfuscated) and matches the repository source",
    "- [x] Every permission is used by the plugin",
    "",
    `<sub>Opened with \`noteral-plugin submit\` ${CLI_VERSION}. New releases reach users automatically after this is merged.</sub>`,
  ];
  return lines.join("\n");
}

async function cmdSubmit(dir, flags) {
  const login = requireGh();
  const registry = String(flags.registry ?? DEFAULT_REGISTRY);
  if (!REPO_RE.test(registry)) throw new CliError(`--registry must be owner/name`);
  const { manifest: local } = readManifest(dir);
  const repo = text(flags.repo ?? local.repo) || githubRepoOf(dir)?.nameWithOwner;
  if (!repo) throw new CliError('Set "repo" in manifest.json to your GitHub "owner/name" (or run `noteral-plugin release` first).');

  step(`Checking the latest release of ${repo}…`);
  const token = gh(["auth", "token"], { allowFail: true }).out || undefined;
  const check = await inspectRelease(repo, { token });
  for (const w of check.warnings) warn(w);
  if (!check.ok) {
    for (const e of check.errors) console.log(`${red("✗")} ${e}`);
    throw new CliError("The release can't be installed yet, so it can't be listed. Fix it and run `noteral-plugin release`.");
  }
  const manifest = check.manifest;
  ok(`${manifest.name} ${manifest.version} installs from ${check.release.url}`);
  if (text(local.id) && text(local.id) !== text(manifest.id)) throw new CliError(`The released manifest id is ${manifest.id}, but your local manifest.json says ${local.id}. Release again first.`);
  if (compareVersions(local.version, manifest.version) > 0) warn(`Your local version ${local.version} isn't released yet (latest is ${manifest.version}). The registry only stores the repo, so that's fine.`);
  if (check.repoInfo?.owner && check.repoInfo.ownerType === "User" && check.repoInfo.owner.toLowerCase() !== login.toLowerCase()) {
    warn(`${repo} belongs to ${check.repoInfo.owner}, and you're signed in as ${login}. Maintainers will check that you're allowed to list it.`);
  }

  const base = ghJson(["repo", "view", registry, "--json", "defaultBranchRef"])?.defaultBranchRef?.name ?? "main";
  const upstream = readRegistryFile(registry, base);
  if (!upstream) throw new CliError(`${registry} has no ${REGISTRY_FILE} on ${base}`);
  const entries = Array.isArray(upstream.data) ? upstream.data : upstream.data.plugins ?? [];
  const existing = entries.find((e) => e.id === manifest.id);
  const sameRepo = entries.find((e) => text(e.repo).toLowerCase() === repo.toLowerCase() && e.id !== manifest.id);
  if (existing && text(existing.repo).toLowerCase() !== repo.toLowerCase()) throw new CliError(`${manifest.id} is already listed for ${existing.repo}. Pick a different id, or ask the maintainers to move it.`);
  if (sameRepo) throw new CliError(`${repo} is already listed as ${sameRepo.id}. One repo can hold one plugin; change your id back to ${sameRepo.id}.`);

  const tags = flags.tags !== undefined ? String(flags.tags).split(",").map((t) => t.trim()).filter(Boolean) : undefined;
  const entry = registryEntry({ ...manifest, repo }, { tags, previous: existing });
  if (existing && JSON.stringify(existing) === JSON.stringify(entry)) {
    ok(`${entry.name} is already listed and up to date. New releases reach users automatically.`);
    return;
  }
  const nextEntries = existing ? entries.map((e) => (e.id === entry.id ? entry : e)) : [...entries, entry];
  const nextRaw = formatRegistry(upstream.data, nextEntries);
  const valid = validateRegistry(JSON.parse(nextRaw));
  if (valid.errors.length) throw new CliError(`The registry entry is invalid:\n${valid.errors.map((e) => `  ${e}`).join("\n")}`);

  const title = `${existing ? "Update" : "Add"} plugin: ${entry.name}`;
  console.log("");
  console.log(`${bold(title)} → ${registry}`);
  console.log(dim(JSON.stringify(entry, null, 2).replace(/^/gm, "  ")));
  if (flags["dry-run"]) {
    console.log(dim("\n--dry-run: nothing was sent."));
    return;
  }
  if (!(await confirm("Open the pull request?", flags))) return;

  const canPush = ghApi("GET", `repos/${registry}`).data?.permissions?.push === true;
  const target = canPush ? registry : await ensureFork(registry, login);
  const branch = `plugin/${entry.id}`;
  const baseSha = ghApi("GET", `repos/${registry}/git/ref/heads/${base}`).data.object.sha;
  const created = ghApi("POST", `repos/${target}/git/refs`, { ref: `refs/heads/${branch}`, sha: baseSha }, { allowFail: true });
  if (!created.ok) {
    let moved = ghApi("PATCH", `repos/${target}/git/refs/heads/${branch}`, { sha: baseSha, force: true }, { allowFail: true });
    if (!moved.ok && !canPush) {
      // The fork may not have the commit yet.
      gh(["repo", "sync", target, "--source", registry, "--branch", base, "--force"], { allowFail: true });
      moved = ghApi("POST", `repos/${target}/git/refs`, { ref: `refs/heads/${branch}`, sha: baseSha }, { allowFail: true });
      if (!moved.ok) moved = ghApi("PATCH", `repos/${target}/git/refs/heads/${branch}`, { sha: baseSha, force: true }, { allowFail: true });
    }
    if (!moved.ok) throw new CliError(`Couldn't create branch ${branch} in ${target}: ${moved.data?.message ?? moved.err}`);
  }
  ghApi("PUT", `repos/${target}/contents/${REGISTRY_FILE}`, {
    message: `${existing ? "Update" : "Add"} ${entry.name} (${entry.id})`,
    content: Buffer.from(nextRaw).toString("base64"),
    branch,
    sha: upstream.sha,
  });
  ok(`Committed the registry change to ${target}:${branch}`);

  const owner = target.split("/")[0];
  const head = canPush ? branch : `${owner}:${branch}`;
  const open = ghJson(["pr", "list", "--repo", registry, "--state", "open", "--head", branch, "--json", "number,url,headRepositoryOwner"]) ?? [];
  const mine = open.find((pr) => pr.headRepositoryOwner?.login?.toLowerCase() === owner.toLowerCase());
  const body = prBody({ manifest, entry, check, existing, login });
  let url;
  if (mine) {
    gh(["pr", "edit", String(mine.number), "--repo", registry, "--title", title, "--body-file", "-"], { input: body });
    url = mine.url;
    ok(`Updated your open pull request: ${url}`);
  } else {
    const pr = gh(["pr", "create", "--repo", registry, "--base", base, "--head", head, "--title", title, "--body-file", "-"], { input: body });
    url = pr.out.split("\n").pop();
    ok(`Opened ${url}`);
  }
  console.log("\nThe registry bot checks your release and comments on the pull request. Once a maintainer merges it, the plugin shows up in every Noteral's Community tab.");
  console.log(dim(`Follow it with: gh pr view ${url} --web   ·   noteral-plugin status`));
}

async function cmdStatus(dir, flags) {
  requireGh();
  const registry = String(flags.registry ?? DEFAULT_REGISTRY);
  const { manifest } = readManifest(dir);
  const repo = text(manifest.repo) || githubRepoOf(dir)?.nameWithOwner;
  console.log(`${bold(text(manifest.name))} ${dim(`${text(manifest.id)} · local ${text(manifest.version)}`)}`);
  if (!repo) {
    warn("No GitHub repo yet (manifest.json repo is empty).");
    return;
  }
  const rel = ghJson(["release", "view", "--repo", repo, "--json", "tagName,url,publishedAt,assets"]);
  if (rel) console.log(`  release   ${rel.tagName} ${dim(`${rel.publishedAt?.slice(0, 10) ?? ""} · ${rel.assets.map((a) => a.name).join(", ")}`)}`);
  else console.log(`  release   ${yellow("none yet")} ${dim("→ noteral-plugin release")}`);
  const listed = findInRegistry(registry, text(manifest.id));
  if (listed?.entry) console.log(`  registry  ${green("listed")} ${dim(`in ${registry}`)}`);
  else {
    const prs = ghJson(["pr", "list", "--repo", registry, "--state", "all", "--head", `plugin/${text(manifest.id)}`, "--json", "number,url,state", "--limit", "1"]) ?? [];
    if (prs[0]) console.log(`  registry  ${yellow(`pull request ${prs[0].state.toLowerCase()}`)} ${dim(prs[0].url)}`);
    else console.log(`  registry  ${yellow("not listed")} ${dim("→ noteral-plugin submit")}`);
  }
}

// ── types ──────────────────────────────────────────────────────────────────

export const SDK_TYPE_FILES = ["index.ts", "runtime.ts", "api.generated.ts", "types.ts"];

async function cmdTypes(dir, flags, _positional, { quiet = false } = {}) {
  const registry = String(flags.registry ?? DEFAULT_REGISTRY);
  const raw = process.env.NOTERAL_GITHUB_RAW || "https://raw.githubusercontent.com";
  const ref = String(flags.ref ?? "main");
  const out = path.join(dir, "types", "noteral-sdk");
  const files = [];
  for (const name of SDK_TYPE_FILES) {
    const url = `${raw}/${registry}/${ref}/sdk/src/${name}`;
    const res = await fetch(url, { headers: { "user-agent": "noteral-plugin" } }).catch((error) => ({ ok: false, status: error.message }));
    if (!res.ok) throw new CliError(`Couldn't download the SDK types (${url}: ${res.status}). The build still works with the fallback in src/sdk.d.ts.`);
    files.push([name, await res.text()]);
  }
  mkdirSync(out, { recursive: true });
  for (const [name, body] of files) writeFileSync(path.join(out, name), body);
  // An ambient fallback would shadow the real types.
  const fallback = path.join(dir, "src", "sdk.d.ts");
  if (existsSync(fallback) && readFileSync(fallback, "utf8").includes('declare module "@noteral/sdk"')) {
    writeFileSync(fallback, "// The SDK types live in types/noteral-sdk/ (run `noteral-plugin types` to update them).\nexport {};\n");
  }
  const tsconfigFile = path.join(dir, "tsconfig.json");
  if (existsSync(tsconfigFile)) {
    try {
      const tsconfig = JSON.parse(readFileSync(tsconfigFile, "utf8"));
      tsconfig.compilerOptions ??= {};
      tsconfig.compilerOptions.paths = { ...tsconfig.compilerOptions.paths, "@noteral/sdk": ["./types/noteral-sdk/index.ts"] };
      writeFileSync(tsconfigFile, `${JSON.stringify(tsconfig, null, 2)}\n`);
    } catch {
      warn('tsconfig.json isn\'t plain JSON; add "paths": { "@noteral/sdk": ["./types/noteral-sdk/index.ts"] } yourself.');
    }
  }
  const sdk = /SDK_VERSION = "([^"]+)"/.exec(files.find(([n]) => n === "api.generated.ts")?.[1] ?? "")?.[1];
  if (!quiet) ok(`Downloaded the SDK ${sdk ?? ""} types into types/noteral-sdk/`);
  return sdk;
}

// ── init ───────────────────────────────────────────────────────────────────

const SDK_SHIM = `// The SDK is provided by Noteral at runtime as \`window.Noteral\`, so this file is
// all a standalone plugin repo needs to build.
import type { NoteralGlobal } from "@noteral/sdk";

const Noteral = (globalThis as unknown as { Noteral: NoteralGlobal }).Noteral;

export const { Plugin, register, app, NoteralError, call } = Noteral;
`;

const SDK_TYPES_FALLBACK = `// Fallback typings so the build works offline. \`noteral-plugin types\` downloads
// the real SDK types into types/noteral-sdk/, which tsconfig.json prefers.
declare module "@noteral/sdk" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type NoteralGlobal = any;
}
`;

const MAIN_TS = (name) => `import { Plugin, register } from "./noteral";

class MyPlugin extends Plugin {
  async onload() {
    this.addCommand({
      id: "hello",
      title: ${JSON.stringify(`${name}: say hello`)},
      run: async () => {
        const page = await this.app.editor.getActive();
        await this.notify(page ? \`Hello from “\${page.title}”\` : "Hello from Home");
      },
    });
  }

  onunload() {
    // Commands, events, panels and views are cleaned up automatically.
  }
}

register(MyPlugin);
`;

export const RELEASE_YML = `# Pushing a version tag (e.g. 1.2.0) publishes a GitHub Release with the files
# Noteral's plugin store downloads. \`noteral-plugin release\` does the same from
# your machine; whichever runs second just refreshes the assets.
name: Release
on:
  push:
    tags: ["*"]
permissions:
  contents: write
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - name: Build and check
        run: node scripts/noteral-plugin.mjs check --release
      - name: Check the tag matches manifest.json
        run: test "$(node -p "require('./manifest.json').version")" = "\${GITHUB_REF_NAME#v}"
      - name: Publish
        env: { GH_TOKEN: "\${{ github.token }}" }
        run: |
          entry="$(node -p "require('./manifest.json').entry || 'main.js'")"
          files="manifest.json $entry"; [ -f styles.css ] && files="$files styles.css"
          if gh release view "$GITHUB_REF_NAME" >/dev/null 2>&1; then
            gh release upload "$GITHUB_REF_NAME" $files --clobber
          else
            gh release create "$GITHUB_REF_NAME" $files --title "$(node -p "require('./manifest.json').name") $GITHUB_REF_NAME" --generate-notes
          fi
`;

const README = (manifest) => `# ${manifest.name}

${manifest.description || "A Noteral plugin."}

## Develop

\`\`\`sh
npm run build        # src/main.ts → main.js
npm run check        # validate manifest.json and the build, like the store does
\`\`\`

To try it, zip \`manifest.json\` and \`main.js\` and use **Plugins → Install from file** in Noteral.

## Publish

Needs the GitHub CLI (\`gh auth login\`).

\`\`\`sh
npm run release      # bump the version, tag, push and publish a GitHub Release
npm run submit       # first time only: open the pull request that lists it in the store
\`\`\`

After the first listing, every \`npm run release\` reaches users as an update.

Docs: https://github.com/neurh/noteral-plugins/blob/main/docs/plugins/README.md
`;

function slugify(value) {
  return String(value).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "plugin";
}

async function cmdInit(dir, flags, positional) {
  const target = path.resolve(dir, positional[0] ?? ".");
  if (existsSync(path.join(target, "manifest.json"))) throw new CliError(`${target} already has a manifest.json`);
  const login = gh(["api", "user", "-q", ".login"], { allowFail: true }).out;
  const gitName = git(["config", "user.name"], undefined, { allowFail: true }).out;
  const interactive = process.stdin.isTTY && !flags.yes;
  const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  const q = (question, fallback) => (rl ? ask(rl, question, fallback) : Promise.resolve(fallback));
  let manifest;
  try {
    const name = text(flags.name) || (await q("Plugin name", positional[0] ? path.basename(target).replace(/-/g, " ") : "My Plugin"));
    const slug = slugify(name);
    const owner = slugify(login || gitName || "you").replace(/-/g, "");
    const id = text(flags.id) || (await q("Plugin id", `com.${owner}.${slug}`));
    const description = text(flags.description) || (await q("One-line description", ""));
    const author = text(flags.author) || (await q("Author", gitName || login || ""));
    const repoName = text(flags["repo-name"]) || `noteral-${slug.replace(/^noteral-/, "")}`;
    manifest = {
      id,
      name,
      version: "0.1.0",
      sdkVersion: SDK_VERSION,
      description,
      author,
      ...(login ? { repo: `${login}/${repoName}` } : {}),
      entry: "main.js",
      permissions: ["editor.read", "ui.notify"],
    };
    var repoFullName = login ? `${login}/${repoName}` : "";
  } finally {
    rl?.close();
  }
  const check = validateManifest(manifest);
  if (check.errors.length) throw new CliError(check.errors.join("\n"));

  const write = (rel, content) => {
    const file = path.join(target, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  };
  write("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  write("src/main.ts", MAIN_TS(manifest.name));
  write("src/noteral.ts", SDK_SHIM);
  write("src/sdk.d.ts", SDK_TYPES_FALLBACK);
  write("scripts/noteral-plugin.mjs", readFileSync(fileURLToPath(import.meta.url), "utf8"));
  write(".github/workflows/release.yml", RELEASE_YML);
  write(".gitignore", "node_modules/\nmain.js\n*.zip\n");
  write("README.md", README(manifest));
  write(
    "package.json",
    `${JSON.stringify(
      {
        name: repoFullName ? repoFullName.split("/")[1] : slugify(manifest.name),
        private: true,
        type: "module",
        scripts: {
          build: "node scripts/noteral-plugin.mjs build",
          check: "node scripts/noteral-plugin.mjs check",
          release: "node scripts/noteral-plugin.mjs release",
          submit: "node scripts/noteral-plugin.mjs submit",
          status: "node scripts/noteral-plugin.mjs status",
        },
      },
      null,
      2,
    )}\n`,
  );
  write(
    "tsconfig.json",
    `${JSON.stringify({ compilerOptions: { strict: true, target: "ES2022", module: "ESNext", moduleResolution: "Bundler", lib: ["ES2022", "DOM"], noEmit: true, skipLibCheck: true }, include: ["src"] }, null, 2)}\n`,
  );
  try {
    await cmdTypes(target, flags, [], { quiet: true });
    ok("Downloaded the SDK types");
  } catch (error) {
    warn(`${error.message} Run \`noteral-plugin types\` later.`);
  }
  ok(`Created ${manifest.name} in ${path.relative(process.cwd(), target) || "."}`);

  if (!git(["rev-parse", "--git-dir"], target, { allowFail: true }).ok) {
    git(["init", "-q", "-b", "main"], target);
    git(["add", "-A"], target);
    git(["commit", "-q", "-m", "Create plugin"], target, { allowFail: true });
    ok("Initialised a git repository");
  }
  if (flags.github) {
    requireGh();
    const visibility = flags.private ? "--private" : "--public";
    if (flags.private) warn("Private repos can't be installed from the store; make it public before you submit.");
    gh(["repo", "create", repoFullName, visibility, "--source", target, "--push", "--description", manifest.description || manifest.name], { cwd: target });
    ok(`Created github.com/${repoFullName}`);
  }
  console.log(`\nNext:\n  cd ${path.relative(process.cwd(), target) || "."}\n  npm run build${flags.github ? "" : `\n  gh repo create ${repoFullName || "<name>"} --public --source . --push`}\n  npm run release\n  npm run submit`);
}

// ── main ───────────────────────────────────────────────────────────────────

const HELP = `${bold("noteral-plugin")} ${CLI_VERSION}: build and publish Noteral plugins with the GitHub CLI

${bold("Usage")}  node scripts/noteral-plugin.mjs <command> [options]

${bold("Commands")}
  init [folder]        Create a plugin (manifest, src/main.ts, release workflow).
                       --github creates the public GitHub repo with gh and pushes.
  build                Bundle src/main.ts into the entry file (esbuild). --watch to rebuild.
  check                Validate manifest.json and the build with the store's rules.
  release [bump]       patch | minor | major | 1.2.3. Bumps manifest.json, builds, checks,
                       commits, tags, pushes and publishes the GitHub Release.
                       --draft  --notes "…"  --notes-file FILE  --allow-dirty
  submit               List the plugin in the community store: checks the latest release,
                       forks the registry if needed and opens (or updates) the pull request.
                       --dry-run  --tags a,b,c  --repo owner/name
  status               Latest release, registry listing and open pull request.
  types                Download the SDK's TypeScript types into types/noteral-sdk/.

${bold("Options")}
  --dir PATH           Plugin folder (default: current folder)
  --registry O/N       Registry repo (default: ${DEFAULT_REGISTRY})
  --yes                Don't ask for confirmation

Docs: https://github.com/neurh/noteral-plugins/blob/main/docs/plugins/publishing.md`;

export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-y") flags.yes = true;
    else if (arg === "-h") flags.help = true;
    else if (arg.startsWith("--")) {
      const [key, inline] = arg.slice(2).split(/=(.*)/s);
      const takesValue = ["dir", "registry", "ref", "notes", "notes-file", "tags", "repo", "name", "id", "description", "author", "repo-name"].includes(key);
      flags[key] = inline !== undefined ? inline : takesValue ? argv[++i] : true;
    } else positional.push(arg);
  }
  return { command: positional.shift() ?? "help", positional, flags };
}

export async function main(argv = process.argv.slice(2)) {
  const { command, positional, flags } = parseArgs(argv);
  const dir = path.resolve(String(flags.dir ?? "."));
  if (flags.help || command === "help" || command === "--help") {
    console.log(HELP);
    return;
  }
  if (command === "version" || flags.version) {
    console.log(`noteral-plugin ${CLI_VERSION} (SDK ${SDK_VERSION})`);
    return;
  }
  const commands = { init: cmdInit, build: cmdBuild, check: cmdCheck, release: cmdRelease, submit: cmdSubmit, status: cmdStatus, types: cmdTypes };
  const fn = commands[command];
  if (!fn) throw new CliError(`Unknown command "${command}". Run \`noteral-plugin help\`.`);
  await fn(dir, flags, positional);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    if (error instanceof CliError) console.error(`${red("✗")} ${error.message}`);
    else console.error(error);
    process.exit(1);
  });
}
