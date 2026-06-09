import { defineConfig } from "@playwright/test";

// Headless runtime smoke test — walks a published quiz against the live Fly
// deployment (no local DB/server needed). Catches the class of interactive
// layout bugs SSR can't (the progress-trail ovals, horizontal overflow, etc.).
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [["list"]],
  use: {
    headless: true,
    baseURL: process.env.SMOKE_BASE || "https://quizocalypse-studio.fly.dev",
  },
});
