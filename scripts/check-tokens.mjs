#!/usr/bin/env node
// DS-5 — design-token drift check (design-system V2 close-out).
//
// Scans admin-UI .tsx files under app/components/** and app/routes/** for
//   (a) hex color literals (#xxx / #xxxxxx, plus 4/8-digit alpha forms)
//   (b) px box-shadow literals (inline `boxShadow:`/`box-shadow:` with px values)
// — both should come from the --qz-* token system instead.
//
// The V2 repaint did NOT sweep legacy inline styles, so this check pins the
// current offender counts in scripts/check-tokens-baseline.json and fails ONLY
// on NEW offenders (a file exceeding its baselined count, or a brand-new file).
// The count is meant to only ever shrink. After removing offenders, refresh the
// baseline with:  node scripts/check-tokens.mjs --update-baseline
//
// Out of scope by design:
//   - app/lib/** (not scanned; designTokens.ts / themePresets.ts are style DATA)
//   - anything under a runtime/ directory (the shopper side has its own system)
//   - test files (*.test.tsx / *.spec.tsx)

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SCAN_DIRS = ["app/components", "app/routes"];
const BASELINE_PATH = join(ROOT, "scripts", "check-tokens-baseline.json");
const UPDATE = process.argv.includes("--update-baseline");

// Allowlisted basenames (style-data files; harmless if they ever move here).
const ALLOW_BASENAMES = new Set(["designTokens.ts", "themePresets.ts"]);

function isSkipped(relPath) {
  const parts = relPath.split(sep);
  if (parts.includes("runtime")) return true; // shopper side — its own system
  const base = parts[parts.length - 1];
  if (ALLOW_BASENAMES.has(base)) return true;
  if (/\.(test|spec)\.tsx?$/.test(base)) return true;
  return false;
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && entry.name.endsWith(".tsx")) yield full;
  }
}

// Light comment stripping so a hex inside a /* … */ block or a full-line //
// comment doesn't count as an offender (keeps positions line-accurate).
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/^\s*\/\/[^\n]*/gm, (m) => m.replace(/[^\n]/g, " "));
}

const HEX_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z])/g;
// Inline box-shadow values carrying raw px offsets/blur (should be --qz-lift-*
// or another shadow token). Matches JSX style objects and CSS-in-string forms.
const BOX_SHADOW_RE = /(?:boxShadow\s*:\s*|box-shadow\s*:\s*)["'`]?[^;"'`\n]*\d+px/g;

function findOffenders(src) {
  const clean = stripComments(src);
  const lines = clean.split("\n");
  const hex = [];
  const boxShadow = [];
  lines.forEach((line, i) => {
    for (const m of line.matchAll(HEX_RE)) hex.push({ line: i + 1, match: m[0] });
    for (const m of line.matchAll(BOX_SHADOW_RE)) boxShadow.push({ line: i + 1, match: m[0].trim() });
  });
  return { hex, boxShadow };
}

// ── Scan ────────────────────────────────────────────────────────────────────
const current = {}; // relPath -> { hex: n, boxShadow: n }
const detail = {}; // relPath -> offender arrays (for printing)
for (const dir of SCAN_DIRS) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) continue;
  for (const file of walk(abs)) {
    const rel = relative(ROOT, file).split(sep).join("/");
    if (isSkipped(rel)) continue;
    const { hex, boxShadow } = findOffenders(readFileSync(file, "utf8"));
    if (hex.length || boxShadow.length) {
      current[rel] = { hex: hex.length, boxShadow: boxShadow.length };
      detail[rel] = { hex, boxShadow };
    }
  }
}

const sortedCurrent = Object.fromEntries(
  Object.keys(current)
    .sort()
    .map((k) => [k, current[k]]),
);
const totals = Object.values(current).reduce(
  (t, c) => ({ hex: t.hex + c.hex, boxShadow: t.boxShadow + c.boxShadow }),
  { hex: 0, boxShadow: 0 },
);

if (UPDATE || !existsSync(BASELINE_PATH)) {
  writeFileSync(BASELINE_PATH, JSON.stringify({ files: sortedCurrent }, null, 2) + "\n");
  console.log(
    `check-tokens: baseline ${UPDATE ? "updated" : "created"} — ${Object.keys(current).length} file(s), ` +
      `${totals.hex} hex literal(s), ${totals.boxShadow} px box-shadow literal(s).`,
  );
  process.exit(0);
}

// ── Compare against the baseline ────────────────────────────────────────────
const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")).files ?? {};
const failures = [];
for (const [rel, counts] of Object.entries(sortedCurrent)) {
  const base = baseline[rel] ?? { hex: 0, boxShadow: 0 };
  for (const kind of ["hex", "boxShadow"]) {
    if (counts[kind] > base[kind]) {
      failures.push({ rel, kind, have: counts[kind], allowed: base[kind] });
    }
  }
}

if (failures.length === 0) {
  const shrunk = Object.entries(baseline).some(([rel, base]) => {
    const c = sortedCurrent[rel] ?? { hex: 0, boxShadow: 0 };
    return c.hex < base.hex || c.boxShadow < base.boxShadow;
  });
  console.log(
    `check-tokens: OK — ${totals.hex} hex / ${totals.boxShadow} px box-shadow literal(s) across ` +
      `${Object.keys(current).length} file(s), all within baseline.`,
  );
  if (shrunk) {
    console.log(
      "check-tokens: offender count shrank — run `node scripts/check-tokens.mjs --update-baseline` to ratchet it down.",
    );
  }
  process.exit(0);
}

console.error("check-tokens: NEW offenders beyond the baseline:\n");
for (const f of failures) {
  const label = f.kind === "hex" ? "hex color literal(s)" : "px box-shadow literal(s)";
  console.error(`  ${f.rel} — ${f.have} ${label} (baseline allows ${f.allowed}):`);
  for (const o of detail[f.rel][f.kind]) {
    console.error(`    L${o.line}: ${o.match}`);
  }
  console.error("");
}
console.error(
  "Use a --qz-* semantic token (var(--qz-…)) instead of raw values. If an offender was\n" +
    "moved (not added), refresh the pin with: node scripts/check-tokens.mjs --update-baseline",
);
process.exit(1);
