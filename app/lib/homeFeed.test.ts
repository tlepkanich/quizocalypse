import { describe, it, expect } from "vitest";
import {
  buildHomeQueue,
  buildHomeStarters,
  editedLabel,
  sparkHeights,
  splitHomeQueue,
  APP_HOME_LINKS,
  STUDIO_HOME_LINKS,
  type HomeQueueQuiz,
} from "./homeFeed";

const links = STUDIO_HOME_LINKS;

const quiz = (over: Partial<HomeQueueQuiz>): HomeQueueQuiz => ({
  id: "q1",
  name: "Serum Finder",
  status: "draft",
  inSetup: false,
  stepIndex: 0,
  stalled: false,
  starts: 0,
  ...over,
});

describe("buildHomeQueue", () => {
  it("orders setup, publish, store, emails", () => {
    const items = buildHomeQueue({
      quizzes: [
        quiz({ id: "live", name: "Live", status: "published", starts: 0 }),
        quiz({ id: "draft", name: "Draft" }),
        quiz({ id: "setup", name: "Setup", inSetup: true, stepIndex: 2 }),
      ],
      emailsWithoutDestination: true,
      links,
    });
    expect(items.map((i) => i.kind)).toEqual(["setup", "publish", "store", "emails"]);
    expect(items[0]).toMatchObject({ href: "/studio/onboarding/setup", stepIndex: 2 });
    expect(items[2]!.href).toBe("/studio/live/embed");
  });

  it("marks a stalled setup", () => {
    const [item] = buildHomeQueue({
      quizzes: [quiz({ inSetup: true, stalled: true })],
      emailsWithoutDestination: false,
      links,
    });
    expect(item).toMatchObject({ kind: "stalled", title: "Setup stalled on “Serum Finder”" });
  });

  it("links into the embedded app with the same keys (§12)", () => {
    const input = {
      quizzes: [
        quiz({ id: "live", status: "published", starts: 0 }),
        quiz({ id: "draft" }),
        quiz({ id: "setup", inSetup: true }),
      ],
      emailsWithoutDestination: true,
    };
    const app = buildHomeQueue({ ...input, links: APP_HOME_LINKS });
    expect(app.map((i) => i.href)).toEqual([
      "/app/onboarding/setup",
      "/app/quizzes/draft/studio",
      "/app/quizzes/live/studio",
      "/app/captures",
    ]);
    // A reminder dismissed on one surface stays dismissed on the other.
    expect(app.map((i) => i.key)).toEqual(buildHomeQueue({ ...input, links }).map((i) => i.key));
  });

  it("skips a live quiz that already has starts", () => {
    const items = buildHomeQueue({
      quizzes: [quiz({ status: "published", starts: 4 })],
      emailsWithoutDestination: false,
      links,
    });
    expect(items).toEqual([]);
  });
});

describe("splitHomeQueue", () => {
  const items = buildHomeQueue({
    quizzes: [quiz({ id: "d" })],
    emailsWithoutDestination: true,
      links,
  });

  it("leads with the first item", () => {
    const { next, also } = splitHomeQueue(items, null);
    expect(next?.kind).toBe("publish");
    expect(also.map((i) => i.kind)).toEqual(["emails"]);
  });

  it("drops a dismissed lead to the top of Also waiting", () => {
    const { next, also } = splitHomeQueue(items, "publish:d");
    expect(next).toBeNull();
    expect(also.map((i) => i.kind)).toEqual(["publish", "emails"]);
  });

  it("never leads with emails", () => {
    const emailsOnly = buildHomeQueue({ quizzes: [], emailsWithoutDestination: true, links });
    expect(splitHomeQueue(emailsOnly, null)).toEqual({ next: null, also: emailsOnly });
  });
});

describe("buildHomeStarters", () => {
  const catalog = {
    label: "Skincare routine",
    goal: "Help shoppers find the right skincare routine for their skin type, concerns, and how much time they want to spend.",
    criteria: "their skin type and concerns",
  };

  it("offers the whole catalog then the two biggest collections, singular", () => {
    const starters = buildHomeStarters({
      productCount: 64,
      catalog,
      groups: [
        { name: "Cleansers", size: 9 },
        { name: "Moisturizers", size: 21 },
        { name: "Serums", size: 18 },
      ],
    });
    expect(starters.map((s) => [s.label, s.meta])).toEqual([
      ["Skincare routine", "Whole catalog · 64"],
      ["Moisturizer", "Moisturizers · 21"],
      ["Serum", "Serums · 18"],
    ]);
    expect(starters[1]!.goal).toBe(
      "Help shoppers pick the right moisturizer for their skin type and concerns.",
    );
  });

  it("offers nothing for an empty catalog", () => {
    expect(buildHomeStarters({ productCount: 0, catalog, groups: [] })).toEqual([]);
  });
});

describe("sparkHeights", () => {
  it("scales slices to the busiest one", () => {
    const start = 0;
    const now = 1000;
    const heights = sparkHeights([new Date(50), new Date(60), new Date(950)], start, now);
    expect(heights).toEqual([100, 0, 0, 0, 0, 0, 0, 0, 0, 50]);
  });

  it("is flat with no data", () => {
    expect(sparkHeights([], 0, 1000)).toEqual(new Array(10).fill(0));
  });
});

describe("editedLabel", () => {
  const now = Date.UTC(2026, 8, 29, 15);
  it("says today on the same UTC day", () => {
    expect(editedLabel(new Date(Date.UTC(2026, 8, 29, 1)), now)).toBe("Edited today");
  });
  it("uses a short month otherwise", () => {
    expect(editedLabel(new Date(Date.UTC(2026, 8, 12)), now)).toBe("Edited Sep 12");
    expect(editedLabel(new Date(Date.UTC(2025, 0, 3)), now)).toBe("Edited Jan 3, 2025");
  });
});
