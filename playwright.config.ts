import { defineConfig } from "@playwright/test";

// Headless runtime smoke test — walks a published quiz against the live Fly
// deployment (no local DB/server needed). Catches the class of interactive
// layout bugs SSR can't (the progress-trail ovals, horizontal overflow, etc.).
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: {
    timeout: 10_000,
    // Screenshot regression (SMOKE_SHOTS=1 in runtime-smoke): small tolerance
    // absorbs antialiasing jitter; animations frozen for determinism. Baselines
    // are PLATFORM-SUFFIXED (…-darwin.png / …-linux.png) — darwin baselines are
    // committed; CI (linux) must not set SMOKE_SHOTS until linux baselines are
    // blessed (procedure in e2e/README.md), so the post-deploy smoke can never
    // flake on cross-platform font rendering.
    toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: "disabled", caret: "hide" },
  },
  // This suite runs against the LIVE Fly deploy, so a single transient network
  // blip (e.g. net::ERR_TIMED_OUT from the single machine momentarily stalling)
  // shouldn't red the whole run — retry transient failures. The locale page,
  // for instance, serves 200 in ~560ms yet occasionally times out the nav.
  retries: 2,
  reporter: [["list"]],
  use: {
    headless: true,
    baseURL: process.env.SMOKE_BASE || "https://quizocalypse-studio.fly.dev",
    // The runtime honors prefers-reduced-motion (the served stylesheet's
    // body[data-qz] strip kills step-enter/urgency-pulse animations under it)
    // — emulate it so screenshots never catch a mid-flight transition frame.
    contextOptions: { reducedMotion: "reduce" },
  },
});
