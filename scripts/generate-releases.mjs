#!/usr/bin/env node
// scripts/generate-releases.mjs
// Regenerates app/lib/releases.ts from `git log`. Runs after each commit
// via `npm run gen:releases`. The maintainer commits the regenerated file
// so production builds + tests don't need git history.
//
// Workflow:
//   1. git commit (with a meaningful subject + body bullet points)
//   2. npm run gen:releases
//   3. git add app/lib/releases.ts && git commit --amend --no-edit
//      (or commit it separately — either works)

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUTPUT_FILE = join(REPO_ROOT, "app", "lib", "releases.ts");

// Commit subjects matching this pattern are skipped — they're internal
// plumbing the merchant doesn't care about. Conventional-commit style.
const SKIP_SUBJECT_RE =
  /^(fix|chore|docs|refactor|test|wip|style|build|ci|perf|merge)[:!(]/i;

// Sentinel strings that delimit fields in the git log output. Using
// unlikely Unicode glyphs so commit content can never collide with them
// even if the body contains quotes, newlines, or backticks.
const COMMIT_START = "⟦C⟧";
const COMMIT_END = "⟦/C⟧";
const FIELD_SEP = "⟦F⟧";

function readGitLog() {
  const format =
    `${COMMIT_START}%H${FIELD_SEP}%s${FIELD_SEP}%aI${FIELD_SEP}%b${COMMIT_END}`;
  const result = spawnSync(
    "git",
    [
      "log",
      "--no-merges",
      "--reverse",
      `--pretty=format:${format}`,
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 16, // 16MB — plenty for thousands of commits
    },
  );
  if (result.status !== 0) {
    process.stderr.write(`git log failed: ${result.stderr ?? ""}\n`);
    process.exit(1);
  }
  return result.stdout;
}

function parseCommits(raw) {
  // Split on COMMIT_START and discard anything before the first one (git
  // log prepends nothing, but be defensive).
  const blocks = raw.split(COMMIT_START).slice(1);
  const commits = [];
  for (const block of blocks) {
    const endIdx = block.lastIndexOf(COMMIT_END);
    const inner = endIdx === -1 ? block : block.slice(0, endIdx);
    const parts = inner.split(FIELD_SEP);
    if (parts.length < 4) continue;
    const [hash, subject, isoDate, body] = parts;
    commits.push({
      hash: hash.trim(),
      subject: subject.trim(),
      isoDate: isoDate.trim(),
      body: (body ?? "").trim(),
    });
  }
  return commits;
}

// Pull bullet-style features out of a commit body. Recognizes `- ` and
// `* ` at the start of a line (with optional leading whitespace).
// Continuation lines (not starting with a bullet and not blank) are
// appended to the current bullet's content.
function parseFeatures(body) {
  const lines = body.split(/\r?\n/);
  const bullets = [];
  let current = null;
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, ""); // trim trailing space
    const bulletMatch = line.match(/^\s*[-*]\s+(.*)$/);
    if (bulletMatch) {
      if (current) bullets.push(current);
      current = bulletMatch[1].trim();
    } else if (current && line.trim().length > 0) {
      // Continuation line — append with a space.
      current += " " + line.trim();
    } else if (line.trim().length === 0 && current) {
      // Blank line ends the current bullet.
      bullets.push(current);
      current = null;
    }
  }
  if (current) bullets.push(current);

  return bullets.map((text) => {
    // Title = up to the first sentence boundary, capped at 60 chars.
    // Description = everything after (or empty if the bullet fits in the title).
    const collapsed = text.replace(/\s+/g, " ").trim();
    let splitIdx = -1;
    for (let i = 0; i < collapsed.length && i < 60; i++) {
      const ch = collapsed[i];
      if (ch === "." || ch === ":") {
        // Avoid splitting on dotted abbreviations like "e.g." or version
        // numbers — require the next char to be a space or end-of-string.
        const next = collapsed[i + 1];
        if (next === undefined || next === " ") {
          splitIdx = i;
          break;
        }
      }
    }
    let title;
    let description;
    if (splitIdx === -1) {
      // No sentence break found — split at the 60-char mark or take the whole thing if shorter.
      if (collapsed.length <= 60) {
        title = collapsed;
        description = "";
      } else {
        // Find the nearest space before 60 to avoid mid-word cut.
        const cut = collapsed.lastIndexOf(" ", 60);
        const at = cut > 30 ? cut : 60;
        title = collapsed.slice(0, at).trim() + "…";
        description = collapsed.slice(at).trim();
      }
    } else {
      title = collapsed.slice(0, splitIdx).trim();
      description = collapsed.slice(splitIdx + 1).trim();
    }
    return { title, description: description || title };
  });
}

// Pick a summary line: first non-empty body line that isn't a bullet, a
// section header (ends in : or — or em-dash), or a quote. Truncated at
// 200 chars.
function pickSummary(body) {
  const lines = body.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (/^[-*]\s+/.test(line)) continue;
    if (/[—:]$/.test(line)) continue;
    if (/^>/.test(line)) continue;
    return line.length > 200 ? line.slice(0, 197).trimEnd() + "…" : line;
  }
  return "";
}

function commitToRelease(commit) {
  if (SKIP_SUBJECT_RE.test(commit.subject)) return null;
  const features = parseFeatures(commit.body);
  if (features.length === 0) return null; // body-less commits don't earn a release entry
  const date = commit.isoDate.split("T")[0];
  return {
    version: `#${commit.hash.slice(0, 7)}`,
    name: commit.subject,
    date,
    summary: pickSummary(commit.body),
    features,
  };
}

function formatFileContent(releases) {
  const banner = [
    "// AUTO-GENERATED by scripts/generate-releases.mjs.",
    "// Run `npm run gen:releases` after each commit to refresh.",
    "// Do not edit this file by hand — your changes will be overwritten.",
    "",
    "export interface ReleaseFeature {",
    "  title: string;",
    "  description: string;",
    "}",
    "",
    "export interface Release {",
    "  version: string;",
    "  name: string;",
    "  date: string; // ISO yyyy-mm-dd",
    "  summary: string;",
    "  features: ReleaseFeature[];",
    "}",
    "",
    "export const RELEASES: Release[] = " + JSON.stringify(releases, null, 2) + ";",
    "",
    "// Compact dashboard card shows the most recent N releases.",
    "export const LATEST_RELEASES = RELEASES.slice(0, 4);",
    "",
  ];
  return banner.join("\n");
}

function main() {
  const raw = readGitLog();
  const commits = parseCommits(raw);
  const releases = commits
    .map(commitToRelease)
    .filter((r) => r !== null)
    // Newest first.
    .sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
    );

  if (releases.length === 0) {
    process.stderr.write(
      "No release-worthy commits found. Check SKIP_SUBJECT_RE or commit body format.\n",
    );
    process.exit(1);
  }

  writeFileSync(OUTPUT_FILE, formatFileContent(releases), "utf8");
  process.stdout.write(
    `Wrote ${releases.length} releases to ${OUTPUT_FILE}\n`,
  );
}

main();
