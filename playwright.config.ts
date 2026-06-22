import { defineConfig } from "@playwright/test";

// Headless runtime smoke test — walks a published quiz against the live Fly
// deployment (no local DB/server needed). Catches the class of interactive
// layout bugs SSR can't (the progress-trail ovals, horizontal overflow, etc.).
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  // This suite runs against the LIVE Fly deploy, so a single transient network
  // blip (e.g. net::ERR_TIMED_OUT from the single machine momentarily stalling)
  // shouldn't red the whole run — retry transient failures. The locale page,
  // for instance, serves 200 in ~560ms yet occasionally times out the nav.
  retries: 2,
  reporter: [["list"]],
  use: {
    headless: true,
    baseURL: process.env.SMOKE_BASE || "https://quizocalypse-studio.fly.dev",
  },
});
