import { describe, it, expect } from "vitest";
import { parseHomeState, withDialogShown, withReminderDismissed } from "./homeState";

describe("homeState", () => {
  it("reads null and junk as a fresh shop", () => {
    expect(parseHomeState(null)).toEqual({});
    expect(parseHomeState({ reminder: { key: 5 } })).toEqual({});
  });

  it("stamps the dialog once and never moves it", () => {
    const first = withDialogShown({}, new Date("2026-09-29T10:00:00Z"));
    expect(first.goalDialogShownAt).toBe("2026-09-29T10:00:00.000Z");
    expect(withDialogShown(first, new Date("2026-10-01T10:00:00Z"))).toBe(first);
  });

  it("keeps one dismissed reminder, replacing the last", () => {
    const now = new Date("2026-09-29T10:00:00Z");
    const a = withReminderDismissed({ goalDialogShownAt: "x" }, "setup:q1", now);
    const b = withReminderDismissed(a, "publish:q2", now);
    expect(b).toEqual({
      goalDialogShownAt: "x",
      reminder: { key: "publish:q2", dismissedAt: "2026-09-29T10:00:00.000Z" },
    });
    expect(parseHomeState(b)).toEqual(b);
  });
});
