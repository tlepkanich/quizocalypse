// PORT-10 — global industry starter templates: payload schema round-trip
// (old rows byte-stable, new fields parse), the 8 checked-in templates convert
// to valid RichTemplateOption payloads, shop+global merge ordering, and the
// §I2 v1 guidance-only rendering.
import { describe, expect, it } from "vitest";
import { RichTemplateOption, IndustryTemplateMeta } from "./quizSchema";
import {
  mergeTemplateOptions,
  categoryLabel,
  industryGuidanceText,
} from "./industryTemplates";
import { loadIndustryTemplates } from "../../scripts/seed-templates.mjs";

// A pre-PORT-10 merchant-saved payload, exactly as save-template writes it
// (every field present — the funnel serializes full objects).
const legacyPayload = {
  id: "skin-goals-match",
  experience_type: "product_match",
  title: "Skin Goals Match",
  angle: "Match shoppers to their routine",
  rationale: "Fits the catalog",
  sample_questions: ["What's your skin type?", "What's your top goal?"],
  feature_notes: ["3 questions", "1 result"],
  dials: { imagery: "medium", graphics: "medium", word_forward: "medium", lines: "rounded" },
  rec_defaults: { max_products: 3, oos_behavior: "show_with_badge", fallback_collection_id: "" },
  recommended_bucket_ids: [],
  question_count: 6,
};

describe("RichTemplateOption round-trip (PORT-10 schema extension)", () => {
  it("parses a pre-PORT-10 payload byte-stable (no added/changed keys)", () => {
    const parsed = RichTemplateOption.parse(legacyPayload);
    expect(parsed).toEqual(legacyPayload);
    // absent `industry` round-trips ABSENT — not an undefined key.
    expect(Object.keys(parsed)).not.toContain("industry");
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(RichTemplateOption.parse(parsed)));
  });

  it("still rejects out-of-range question_count but admits the widened band", () => {
    expect(RichTemplateOption.safeParse({ ...legacyPayload, question_count: 25 }).success).toBe(true);
    expect(RichTemplateOption.safeParse({ ...legacyPayload, question_count: 40 }).success).toBe(true);
    expect(RichTemplateOption.safeParse({ ...legacyPayload, question_count: 41 }).success).toBe(false);
    expect(RichTemplateOption.safeParse({ ...legacyPayload, question_count: 2 }).success).toBe(false);
  });
});

describe("industry template conversion (scripts/seed-templates.mjs)", () => {
  const templates = loadIndustryTemplates() as Array<{
    slug: string;
    name: string;
    payload: unknown;
    file: string;
  }>;

  it("finds all 8 checked-in templates", () => {
    expect(templates.map((t) => t.slug).sort()).toEqual([
      "starter-apparel-fit",
      "starter-durables-narrower",
      "starter-gift-finder",
      "starter-instant-shade-match",
      "starter-pet-food-plan",
      "starter-skincare-formulation",
      "starter-subscription-onboarding",
      "starter-supplements-routine",
    ]);
  });

  it("every payload parses as RichTemplateOption, byte-stable, with faithful industry metadata", () => {
    for (const t of templates) {
      const parsed = RichTemplateOption.parse(t.payload);
      // byte-stable through the parse (a re-save never rewrites the row)
      expect(parsed, t.slug).toEqual(t.payload);
      expect(parsed.industry, t.slug).toBeDefined();
      const meta = IndustryTemplateMeta.parse(parsed.industry);
      expect(meta.category.length, t.slug).toBeGreaterThan(0);
      // §I2 v1 — the freeform maps_to keyword bindings are STORED faithfully.
      const qs = meta.questions ?? [];
      expect(qs.length, t.slug).toBeGreaterThan(0);
      expect(qs.some((q) => Boolean(q.maps_to)), t.slug).toBe(true);
    }
  });

  it("subscription-onboarding's long band (25+) fits the widened caps", () => {
    const sub = templates.find((t) => t.slug === "starter-subscription-onboarding");
    expect(sub).toBeDefined();
    const parsed = RichTemplateOption.parse(sub?.payload);
    expect(parsed.question_count).toBe(25);
    expect(parsed.industry?.length).toEqual({
      min: 25,
      max: 40,
      band: "long",
      note: "10–15 min / 25+ inputs. The survey IS friction that builds investment, trust, and identity (sunk-cost).",
    });
  });
});

describe("mergeTemplateOptions", () => {
  const shopRow = { id: "s1", name: "My saved", template: RichTemplateOption.parse(legacyPayload) };
  const starterRow = {
    id: "g1",
    name: "Gift finder",
    template: RichTemplateOption.parse({
      ...legacyPayload,
      id: "starter-gift-finder",
      industry: { category: "gifting" },
    }),
  };

  it("orders shop rows first, then starters, each labeled", () => {
    const merged = mergeTemplateOptions([shopRow], [starterRow]);
    expect(merged.map((m) => m.id)).toEqual(["s1", "g1"]);
    expect(merged[0]).toMatchObject({ scope: "shop", category: null });
    expect(merged[1]).toMatchObject({ scope: "starter", category: "gifting" });
  });

  it("handles either side empty", () => {
    expect(mergeTemplateOptions([], [starterRow])).toHaveLength(1);
    expect(mergeTemplateOptions([shopRow], [])).toHaveLength(1);
    expect(mergeTemplateOptions([], [])).toEqual([]);
  });
});

describe("categoryLabel", () => {
  it("takes the vertical head, capitalized", () => {
    expect(categoryLabel("beauty/custom-formulation")).toBe("Beauty");
    expect(categoryLabel("gifting")).toBe("Gifting");
    expect(categoryLabel(null)).toBe("");
  });
});

describe("industryGuidanceText (§I2 v1 — guidance, not bindings)", () => {
  it("renders skeleton, arc, gate and the grounding rule", () => {
    const meta = IndustryTemplateMeta.parse({
      category: "gifting",
      length: { min: 5, max: 7, band: "short" },
      gate: { placement: "deferred_to_action", style: "soft", rationale: "givers have low patience" },
      result_shape: "ranked_shortlist",
      arc: ["recipient", "occasion", "budget"],
      branching: "light",
      questions: [
        {
          prompt: "Who is the gift for?",
          type: "single_select",
          maps_to: "recipient",
          weight_tier: "primary",
          options: [{ label: "Partner", maps_to: "recipient:partner" }],
        },
      ],
      recommendation: { architecture: "attribute_filter", tie_break: "best sellers", empty_fallback: "widen budget" },
      personalization_hooks: ["greeting card copy"],
    });
    const text = industryGuidanceText(meta);
    expect(text).toContain("vertical: gifting");
    expect(text).toContain("5–7 questions (short band)");
    expect(text).toContain("recipient → occasion → budget");
    expect(text).toContain("deferred to action, soft");
    expect(text).toContain("Who is the gift for? [primary] — options: Partner (recipient:partner)");
    // the §I2 posture is stated IN the prompt: keywords are guidance, not tags
    expect(text).toContain("authoring guidance, not literal tags");
    expect(text).toContain("Ground every question and recommendation in the merchant's chosen product groups");
    expect(text).toContain("tie-break: best sellers");
  });

  it("stays minimal when optional blocks are absent", () => {
    const text = industryGuidanceText(IndustryTemplateMeta.parse({ category: "durables" }));
    expect(text).toContain("vertical: durables");
    expect(text).not.toContain("Skeleton questions");
    expect(text).not.toContain("Contact gate");
  });
});
