#!/usr/bin/env node
// Validates registry/community-plugins.json with the app's rules (the same code
// as `noteral-plugin submit`). Offline: it doesn't contact GitHub; the release
// checks live in review.mjs.
//
//   node registry/validate.mjs [file] [--fix]   --fix rewrites it in the standard format
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { formatRegistry, validateRegistry } from "../sdk/cli/noteral-plugin.mjs";

const fix = process.argv.includes("--fix");
const file = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? fileURLToPath(new URL("./community-plugins.json", import.meta.url));
const raw = readFileSync(file, "utf8");
let data;
try {
  data = JSON.parse(raw);
} catch (error) {
  console.error(`✗ ${file}: not valid JSON (${error.message})`);
  process.exit(1);
}
const { errors, entries } = validateRegistry(data);
if (errors.length) {
  for (const error of errors) console.error(`✗ ${error}`);
  process.exit(1);
}
const formatted = formatRegistry(data, entries);
if (formatted !== raw) {
  if (fix) writeFileSync(file, formatted);
  else {
    console.error("✗ not in the standard format (2-space JSON, trailing newline). Run: node registry/validate.mjs --fix");
    process.exit(1);
  }
}
console.log(`✓ ${entries.length} registry ${entries.length === 1 ? "entry" : "entries"} valid`);
