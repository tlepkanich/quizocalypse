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

// The "What's new" card is for merchants — they care about visual /
// surface changes, not the AI prompt pipeline or schema cascade. We
// hard-filter each parsed feature against these two regex lists. UI hits
// must equal or outnumber backend hits.
const UI_KEYWORDS =
  /\b(card|drawer|tab|page|panel|sidebar|modal|popover|tooltip|banner|badge|pill|chip|menu|dropdown|picker|wizard|dashboard|canvas|button|icon|toggle|switch|slider|header|footer|preview|launcher|optgroup|node|edge|handle|view|screen|step|flow|preset|theme|palette|color|font|typography|spacing|radius|layout|click|tap|hover|hovers?|visible|shows|displays|renders|reveal|chevron|tile|grid|row|column|swatch|input|placeholder|page|route|mobile|admin|storefront)\b/i;

const BACKEND_KEYWORDS =
  /\b(SDK|endpoint|Prisma|migration|Zod|schema|tool-use|server-side|HMAC|webhook signature|payload|JSON blob|interface|type alias|TypeScript|byte-identical|MAX_ATTEMPTS|SYSTEM_PROMPT|generateQuiz|regenerateQuestion|extractBrandGuidelines|runAskAIChat|buildPromptAdditions|buildBrandVoiceAddition|parseBrandGuidelinesSafe|resolveDesignTokens|content block|Anthropic SDK|cascade|loader|action route|attempts|retries|defensively re-parse|fetch|spawn|fixture|assert|mock|test|library|helper function|utility|parser)\b/i;

// Hard cap on features surfaced per release. 3 reads cleanly inside the
// dashboard card; the dedicated /app/releases page also benefits from a
// short, focused list. Maintainers who want more granularity can edit
// their commit messages to lead with the user-visible bullets.
const MAX_FEATURES_PER_RELEASE = 3;

// Catches feature titles that are clearly code: file paths, dotted
// member expressions, arrow functions, percent-encoded names. These are
// internal implementation references the merchant doesn't care about.
function looksLikeCode(title) {
  if (/\.(ts|tsx|js|mjs|css|prisma|sql|json)\b/.test(title)) return true;
  if (/\bapp\/(routes|lib|components|styles)\//.test(title)) return true;
  if (/=>|=\s|\+\+|::/.test(title)) return true;
  if (/\([a-z]+:[^)]+\)/i.test(title)) return true; // foo(arg: type)
  if (/`[^`]*=[^`]*`/.test(title)) return true; // backtick contains assignment
  // Backtick-leading identifier with member access or property dump:
  // \`QuestionData.show_preview_after, \`IndexedProduct\` gains \`handle, etc.
  if (/^`[A-Z][A-Za-z0-9_]*\.[a-z_]/.test(title)) return true;
  if (/`[A-Z][A-Za-z0-9_]+`\s+(gains?|has|exposes?|adds?)\s+`/.test(title)) {
    return true;
  }
  // Title is dominated by backtick-quoted identifiers — 2+ backticked
  // spans and they cover most of the visible text.
  const tickedSpans = (title.match(/`[^`]+`/g) ?? []).join("");
  if (tickedSpans.length > 0 && tickedSpans.length / title.length > 0.4) {
    const tickCount = (title.match(/`/g) ?? []).length;
    if (tickCount >= 4) return true;
  }
  // Long camelCase / snake_case sequence with no spaces — likely an
  // identifier dump like "buildAskAISystem" or "MAX_ATTEMPTS"
  if (/^[A-Za-z_][A-Za-z0-9_]{14,}$/.test(title.trim())) return true;
  return false;
}

function looksLikeUI(text) {
  const uiHits = (text.match(new RegExp(UI_KEYWORDS, "gi")) ?? []).length;
  const backendHits = (text.match(new RegExp(BACKEND_KEYWORDS, "gi")) ?? [])
    .length;
  if (uiHits === 0) return false;
  // Backend mentions are fine as long as the bullet is still primarily
  // about a visible surface. Equal counts default to "show it".
  return uiHits >= backendHits;
}

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
  const allFeatures = parseFeatures(commit.body);

  // Keep only user-visible changes, dedupe near-identical titles, then cap
  // to the per-release maximum. Releases with no UI-shaped bullets are
  // dropped entirely — backend-only commits don't earn a card.
  const seenTitles = new Set();
  const uiFeatures = [];
  for (const f of allFeatures) {
    if (looksLikeCode(f.title)) continue;
    if (!looksLikeUI(`${f.title} ${f.description}`)) continue;
    const titleKey = f.title.toLowerCase().replace(/\s+/g, " ").trim();
    if (seenTitles.has(titleKey)) continue;
    seenTitles.add(titleKey);
    uiFeatures.push(f);
    if (uiFeatures.length >= MAX_FEATURES_PER_RELEASE) break;
  }
  if (uiFeatures.length === 0) return null;

  const date = commit.isoDate.split("T")[0];
  return {
    version: `#${commit.hash.slice(0, 7)}`,
    name: commit.subject,
    date,
    summary: pickSummary(commit.body),
    features: uiFeatures,
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
