import { describe, expect, it } from "vitest";
import { AI_FEATURES, PLANS, PLAN_ORDER, nextPlanUp, selfServePlan } from "./catalog";
import {
  apportion,
  breakEvenMark,
  clampAmount,
  creditFigures,
  creditSignal,
  creditsCents,
  cycleAfter,
  daysLeftIn,
  defaultAmount,
  fmtUsd,
  fmtUsdShort,
  lastDayOf,
  nextPlanWasCheaper,
  proRataCents,
  quizUsageRows,
  rolloverAtCycleEnd,
  type CycleCredits,
  type CycleUsage,
  type QuizUsage,
} from "./creditMath";

// The mock's example data (docs/design/settings/billing/billing.src.html):
// its figures are the spec for how the numbers relate.

const NO_EXTRA: CycleCredits = { everyCycle: 0, oneTime: 0, rolledOver: 0 };

/** Usage in the mock's shape: rec_copy and ask_ai uses at their rates. */
function usage(engagements: number, recCopyUses: number, askAiUses: number): CycleUsage {
  return {
    engagements,
    ai: [
      { key: "rec_copy", uses: recCopyUses, milliCredits: recCopyUses * 200 },
      { key: "ask_ai", uses: askAiUses, milliCredits: askAiUses * 100 },
    ],
  };
}

describe("the catalog", () => {
  it("prices an extra credit above the next plan's price per credit", () => {
    // The handoff's constraint for whoever sets the prices: without it the
    // bigger plan is not always the better deal.
    for (const key of PLAN_ORDER) {
      const plan = PLANS[key];
      const next = nextPlanUp(key);
      if (!plan.selfServe || !next) continue;
      expect(plan.rate).toBeGreaterThan(next.price / next.credits);
    }
  });

  it("reads an unknown stored plan key as the default plan", () => {
    expect(selfServePlan("growth").key).toBe("growth");
    expect(selfServePlan("enterprise").key).toBe("starter");
    expect(selfServePlan(null).key).toBe("starter");
  });
});

describe("creditFigures", () => {
  it("adds up the mock's Growth cycle", () => {
    const figures = creditFigures(PLANS.growth, { ...NO_EXTRA, rolledOver: 180 }, usage(1180, 644, 276));
    // 644 × 0.2 = 128.8 → 129; 276 × 0.1 = 27.6 → 28.
    expect(figures.features.map((f) => f.credits)).toEqual([129, 28]);
    expect(figures.aiUses).toBe(920);
    expect(figures.used).toBe(1180 + 129 + 28);
    expect(figures.available).toBe(2380);
    expect(figures.left).toBe(2380 - 1337);
    expect(figures.over).toBe(0);
    expect(figures.nextBillCents).toBe(20000);
  });

  it("bills credits past what was available at the plan's rate", () => {
    const figures = creditFigures(PLANS.growth, { ...NO_EXTRA, rolledOver: 180 }, usage(2511, 0, 0));
    expect(figures.over).toBe(131);
    expect(figures.left).toBe(0);
    expect(figures.overCents).toBe(1310);
    expect(figures.nextBillCents).toBe(21310);
  });

  it("counts every-cycle and one-time credits as available, and every-cycle on the bill", () => {
    const figures = creditFigures(PLANS.growth, { everyCycle: 500, oneTime: 300, rolledOver: 0 }, usage(0, 0, 0));
    expect(figures.available).toBe(3000);
    expect(figures.everyCycleCents).toBe(5000);
    expect(figures.monthlyCents).toBe(25000);
  });

  it("shows every feature in the list, at 0 when unused", () => {
    const figures = creditFigures(PLANS.starter, NO_EXTRA, { engagements: 3, ai: [] });
    expect(figures.features.map((f) => f.feature.key)).toEqual(AI_FEATURES.map((f) => f.key));
    expect(figures.aiCredits).toBe(0);
    expect(figures.used).toBe(3);
  });
});

describe("creditSignal", () => {
  const at = (used: number) => creditFigures(PLANS.starter, NO_EXTRA, usage(used, 0, 0));

  it("is quiet under 80%, near from 80%, over past the total", () => {
    expect(creditSignal(at(319), false)).toBeNull();
    expect(creditSignal(at(320), false)).toBe("near");
    expect(creditSignal(at(400), false)).toBe("near");
    expect(creditSignal(at(401), false)).toBe("over");
  });

  it("never shows nearly-out in a trial, but still shows over", () => {
    expect(creditSignal(at(390), true)).toBeNull();
    expect(creditSignal(at(401), true)).toBe("over");
  });
});

describe("nextPlanWasCheaper", () => {
  it("is true once Starter with overage costs more than Growth", () => {
    // Starter $50 + 1,001 extra credits × $0.15 = $200.15 > $200.
    const figures = creditFigures(PLANS.starter, NO_EXTRA, usage(1401, 0, 0));
    expect(nextPlanWasCheaper(figures, PLANS.growth)).toBe(true);
    expect(nextPlanWasCheaper(creditFigures(PLANS.starter, NO_EXTRA, usage(1400, 0, 0)), PLANS.growth)).toBe(false);
  });

  it("never names the top plan, which has no fixed price", () => {
    const figures = creditFigures(PLANS.growth, NO_EXTRA, usage(99999, 0, 0));
    expect(nextPlanWasCheaper(figures, PLANS.enterprise)).toBe(false);
  });
});

describe("apportion", () => {
  it("returns whole parts that add up to the total", () => {
    expect(apportion(129, [0.55, 0.3, 0.15])).toEqual([71, 39, 19]);
    expect(apportion(10, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(10);
  });

  it("gives a zero weight nothing", () => {
    expect(apportion(28, [3, 0, 1])).toEqual([21, 0, 7]);
    expect(apportion(5, [0, 0])).toEqual([0, 0]);
  });
});

describe("quizUsageRows", () => {
  const quizzes: QuizUsage[] = [
    { quizId: "a", name: "Routine", engagements: 649, ai: { rec_copy: 70_800, ask_ai: 18_000 } },
    { quizId: "b", name: "Serum", engagements: 354, ai: { rec_copy: 58_000 } },
    { quizId: "c", name: "Gifts", engagements: 177, ai: { ask_ai: 9_600 } },
  ];
  const figures = creditFigures(PLANS.growth, NO_EXTRA, usage(1180, 644, 276));
  const rows = quizUsageRows(quizzes, figures);

  it("makes every column add up to the Used figure", () => {
    const column = (index: number) => rows.reduce((sum, row) => sum + (row.ai[index] ?? 0), 0);
    expect(column(0)).toBe(figures.features[0]?.credits);
    expect(column(1)).toBe(figures.features[1]?.credits);
    expect(rows.reduce((sum, row) => sum + row.credits, 0)).toBe(figures.used);
  });

  it("shows a dash (null) where a quiz had no use of a feature", () => {
    expect(rows[1]?.ai[1]).toBeNull();
    expect(rows[2]?.ai[0]).toBeNull();
  });
});

describe("the amount control", () => {
  const range = PLANS.growth.add;

  it("clamps to a whole number in the plan's range", () => {
    expect(clampAmount(range, 12)).toBe(100);
    expect(clampAmount(range, 733.6)).toBe(734);
    expect(clampAmount(range, 99999)).toBe(5000);
  });

  it("opens on the plan's usual amount, or on the overage rounded up to a step", () => {
    expect(defaultAmount(range, 0)).toBe(500);
    expect(defaultAmount(range, 131)).toBe(200);
    expect(defaultAmount(PLANS.starter.add, 1001)).toBe(1050);
  });

  it("marks where this plan plus the credits costs the same as the next plan", () => {
    // Starter: ($200 − $50) ÷ $0.15 = 1,000 credits.
    const mark = breakEvenMark(PLANS.starter, 5000, PLANS.growth);
    expect(mark?.amount).toBeCloseTo(1000);
    expect(mark?.shown).toBe(true);
  });

  it("hides the mark in the first or last eighth of the track", () => {
    // Starter already at $185 a month: break-even is 100 credits, near the start.
    expect(breakEvenMark(PLANS.starter, 18500, PLANS.growth)?.shown).toBe(false);
    expect(breakEvenMark(PLANS.starter, 5000, null)).toBeNull();
  });
});

describe("money", () => {
  it("keeps cents whole", () => {
    expect(creditsCents(131, 0.1)).toBe(1310);
    expect(creditsCents(3, 0.15)).toBe(45);
    expect(fmtUsd(1310)).toBe("$13.10");
    expect(fmtUsd(123456)).toBe("$1,234.56");
    expect(fmtUsdShort(20000)).toBe("$200");
    expect(fmtUsdShort(23750)).toBe("$237.50");
  });

  it("charges an upgrade for the days left in the cycle", () => {
    // ($200 − $50) × 18 ÷ 30
    expect(proRataCents(15000, 18)).toBe(9000);
  });
});

describe("the cycle", () => {
  const cycle = { start: new Date("2026-09-19T00:00:00Z"), end: new Date("2026-10-19T00:00:00Z") };

  it("ends the day before the next bill date", () => {
    expect(lastDayOf(cycle).toISOString()).toBe("2026-10-18T00:00:00.000Z");
  });

  it("counts whole days to the next bill date, rounded up, never below 0", () => {
    expect(daysLeftIn(cycle, new Date("2026-10-01T00:00:00Z"))).toBe(18);
    expect(daysLeftIn(cycle, new Date("2026-10-18T09:30:00Z"))).toBe(1);
    expect(daysLeftIn(cycle, new Date("2026-11-02T00:00:00Z"))).toBe(0);
  });

  it("is followed by a 30-day cycle that starts on the bill date", () => {
    const next = cycleAfter(cycle);
    expect(next.start).toEqual(cycle.end);
    expect(next.end.toISOString()).toBe("2026-11-18T00:00:00.000Z");
  });
});

describe("rolloverAtCycleEnd", () => {
  it("rolls over every fresh credit when nothing was used", () => {
    expect(rolloverAtCycleEnd({ fresh: 2200, rolledIn: 0, used: 0 })).toBe(2200);
  });

  it("rolls over what is left of the fresh credits", () => {
    expect(rolloverAtCycleEnd({ fresh: 2200, rolledIn: 0, used: 1337 })).toBe(863);
  });

  it("spends rolled-in credits first, so they shield the fresh ones", () => {
    // 180 rolled in, 100 used: the fresh credits are untouched.
    expect(rolloverAtCycleEnd({ fresh: 2200, rolledIn: 180, used: 100 })).toBe(2200);
    // 1,337 used: the first 180 come from the rolled-in credits.
    expect(rolloverAtCycleEnd({ fresh: 2200, rolledIn: 180, used: 1337 })).toBe(2200 - (1337 - 180));
  });

  it("never rolls a rolled-in credit over a second time", () => {
    // Nothing used: the 180 expire, and only the fresh credits carry on.
    expect(rolloverAtCycleEnd({ fresh: 400, rolledIn: 180, used: 0 })).toBe(400);
    for (const used of [0, 50, 180, 300, 580, 900]) {
      expect(rolloverAtCycleEnd({ fresh: 400, rolledIn: 180, used })).toBeLessThanOrEqual(400);
    }
  });

  it("rolls over nothing when everything was used, or the shop is over", () => {
    expect(rolloverAtCycleEnd({ fresh: 400, rolledIn: 180, used: 580 })).toBe(0);
    expect(rolloverAtCycleEnd({ fresh: 400, rolledIn: 180, used: 1401 })).toBe(0);
  });

  it("counts one-time credits as fresh: they roll over like plan credits", () => {
    const fresh = PLANS.starter.credits + 300;
    expect(rolloverAtCycleEnd({ fresh, rolledIn: 0, used: 500 })).toBe(200);
  });
});
