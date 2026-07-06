import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["app/**/*.test.{ts,tsx}"],
    environment: "node",
    globals: false,
    // BIC-2 D4: coverage is REPORT-ONLY — no thresholds. Run via
    // `npm run test:coverage`. After a baseline period, ratchet like
    // scripts/check-tokens.mjs (fail on regression, not an arbitrary floor).
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      include: ["app/**"],
      exclude: ["app/**/*.test.{ts,tsx}", "app/**/*.d.ts"],
    },
  },
});
