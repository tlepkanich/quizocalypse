import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import {
  extractTranslatableStrings,
  applyTranslations,
  sourceHashOf,
  resolveLocale,
  parseLocaleParam,
  LOCALE_RE,
  mergeTagsOf,
} from "./quizTranslate";

const doc = () =>
  Quiz.parse({
    quiz_id: "qz_i18n",
    scope: { collection_ids: [] },
    launcher_config: { enabled: true, label: "Find your match" },
    nodes: [
      {
        id: "intro",
        type: "intro",
        position: { x: 0, y: 0 },
        data: { headline: "Find your board", subtext: "Two minutes.", button_label: "Start" },
      },
      {
        id: "q1",
        type: "question",
        position: { x: 1, y: 0 },
        data: {
          text: "What terrain?",
          question_type: "single_select",
          education_card_before: "Terrain shapes flex.",
          answers: [
            { id: "a1", text: "Powder", tags: ["powder"], edge_handle_id: "h1", tooltip_text: "Deep snow" },
            { id: "a2", text: "Park", tags: ["park"], edge_handle_id: "h2" },
          ],
        },
      },
      {
        id: "msg",
        type: "message",
        position: { x: 2, y: 0 },
        data: { text: "Thanks @name — based on @answer.q1 we picked these." },
      },
      {
        id: "r1",
        type: "result",
        position: { x: 3, y: 0 },
        data: {
          headline: "Ride on",
          subtext: "",
          cta_label: "Shop now",
          why_bullets: ["Forgiving flex", "True to size"],
          fallback_collection_id: "gid://c/1",
        },
      },
    ],
    edges: [
      { id: "e1", source: "intro", target: "q1" },
      { id: "e2", source: "q1", target: "msg" },
      { id: "e3", source: "msg", target: "r1" },
    ],
    node_layouts: {
      intro: [
        { id: "blkH", type: "heading", bind: "headline", text: "" },
        { id: "blkT", type: "text", bind: "none", text: "A literal note." },
      ],
    },
  });

describe("extractTranslatableStrings", () => {
  it("covers nodes, answers, tooltips, bullets, blocks, launcher, and chrome with stable keys", () => {
    const keys = new Map(extractTranslatableStrings(doc()).map((s) => [s.key, s.text]));
    expect(keys.get("node.intro.headline")).toBe("Find your board");
    expect(keys.get("node.q1.education_card_before")).toBe("Terrain shapes flex.");
    expect(keys.get("answer.q1.a1.text")).toBe("Powder");
    expect(keys.get("answer.q1.a1.tooltip_text")).toBe("Deep snow");
    expect(keys.get("bullets.r1.0")).toBe("Forgiving flex");
    expect(keys.get("block.intro.blkT.text")).toBe("A literal note.");
    expect(keys.has("block.intro.blkH.text")).toBe(false); // bound block → node key
    expect(keys.get("launcher.label")).toBe("Find your match");
    expect(keys.get("chrome.continue")).toBe("Continue");
    // Empty subtext on r1 is skipped.
    expect(keys.has("node.r1.subtext")).toBe(false);
  });
});

describe("applyTranslations", () => {
  it("swaps copy, leaves structure, and falls back per-string", () => {
    const out = applyTranslations(doc(), {
      "node.intro.headline": "Trouvez votre planche",
      "answer.q1.a1.text": "Poudreuse",
      "bullets.r1.1": "Taille fidèle",
      "launcher.label": "Trouvez votre match",
      // node.q1.text deliberately missing → English stays
    });
    const intro = out.nodes.find((n) => n.id === "intro")!;
    const q1 = out.nodes.find((n) => n.id === "q1")!;
    const r1 = out.nodes.find((n) => n.id === "r1")!;
    expect(intro.type === "intro" && intro.data.headline).toBe("Trouvez votre planche");
    expect(q1.type === "question" && q1.data.text).toBe("What terrain?"); // fallback
    expect(q1.type === "question" && q1.data.answers[0]!.text).toBe("Poudreuse");
    expect(q1.type === "question" && q1.data.answers[0]!.id).toBe("a1"); // ids stable
    expect(r1.type === "result" && r1.data.why_bullets).toEqual(["Forgiving flex", "Taille fidèle"]);
    expect(out.launcher_config.label).toBe("Trouvez votre match");
    expect(out.edges).toEqual(doc().edges); // routing untouched
    expect(() => Quiz.parse(out)).not.toThrow();
  });

  it("drops a translation that lost a merge tag (renders English instead)", () => {
    const broken = applyTranslations(doc(), {
      "node.msg.text": "Merci — on a choisi ceci.", // lost @name AND @answer.q1
    });
    const msg = broken.nodes.find((n) => n.id === "msg")!;
    expect(msg.type === "message" && msg.data.text).toContain("@answer.q1"); // English kept

    const good = applyTranslations(doc(), {
      "node.msg.text": "Merci @name — selon @answer.q1 on a choisi ceci.",
    });
    const msg2 = good.nodes.find((n) => n.id === "msg")!;
    expect(msg2.type === "message" && msg2.data.text).toContain("Merci @name");
  });
});

describe("sourceHashOf + resolveLocale", () => {
  it("hash is stable across extraction order and changes when copy changes", () => {
    const a = extractTranslatableStrings(doc());
    const b = [...a].reverse();
    expect(sourceHashOf(a)).toBe(sourceHashOf(b));
    const edited = doc();
    const intro = edited.nodes.find((n) => n.id === "intro")!;
    if (intro.type === "intro") intro.data.headline = "New headline";
    expect(sourceHashOf(extractTranslatableStrings(edited))).not.toBe(sourceHashOf(a));
  });

  it("resolves exact then language-prefix then null", () => {
    expect(resolveLocale("fr", ["fr", "pt-br"])).toBe("fr");
    expect(resolveLocale("PT-BR", ["fr", "pt-br"])).toBe("pt-br");
    expect(resolveLocale("pt", ["fr", "pt-br"])).toBe("pt-br");
    expect(resolveLocale("fr-ca", ["fr"])).toBe("fr");
    expect(resolveLocale("de", ["fr"])).toBeNull();
    expect(resolveLocale(null, ["fr"])).toBeNull();
  });

  it("mergeTagsOf finds the render-time tag syntax", () => {
    expect(mergeTagsOf("Hi @name, re @answer.q1!")).toEqual(["@name", "@answer.q1"]);
  });
});

describe("parseLocaleParam (HII-6 — public ?locale= boundary)", () => {
  it("passes simple + single-subtag tags through UNCHANGED", () => {
    expect(parseLocaleParam("fr")).toBe("fr");
    expect(parseLocaleParam("pt-br")).toBe("pt-br");
    expect(parseLocaleParam("zh-hant")).toBe("zh-hant");
    expect(parseLocaleParam("fil")).toBe("fil"); // 3-letter primary subtag
  });

  it("passes MULTI-subtag BCP-47 storefront tags through (the adversarial-review fix)", () => {
    // Shopify's request.locale.iso_code can carry script + region + variants;
    // resolveLocale narrows them by language prefix, so we must NOT reject them.
    expect(parseLocaleParam("zh-Hant-TW")).toBe("zh-Hant-TW");
    expect(parseLocaleParam("zh-Hans-CN")).toBe("zh-Hans-CN");
    expect(parseLocaleParam("sr-Latn-RS")).toBe("sr-Latn-RS");
    expect(parseLocaleParam("es-419")).toBe("es-419"); // numeric (UN M49) region subtag
    expect(parseLocaleParam("ca-ES-valencia")).toBe("ca-ES-valencia");
  });

  it("is case-insensitive (resolveLocale lowercases anyway)", () => {
    expect(parseLocaleParam("FR")).toBe("FR");
    expect(parseLocaleParam("en-US")).toBe("en-US");
  });

  it("rejects only true garbage (chars no locale tag can contain / oversized) to null", () => {
    expect(parseLocaleParam("<script>")).toBeNull();
    expect(parseLocaleParam("../../etc/passwd")).toBeNull();
    expect(parseLocaleParam("fr; DROP TABLE")).toBeNull();
    expect(parseLocaleParam("fr_bad@x")).toBeNull(); // underscore + @
    expect(parseLocaleParam("english")).toBeNull(); // 7-letter primary, not a tag
    expect(parseLocaleParam("f")).toBeNull(); // too short
    expect(parseLocaleParam("fr-")).toBeNull(); // dangling subtag
    expect(parseLocaleParam("a".repeat(40))).toBeNull(); // length cap
    expect(parseLocaleParam("")).toBeNull();
    expect(parseLocaleParam(null)).toBeNull();
  });

  it("composes with resolveLocale: BYTE-STABLE for every input class vs. raw resolveLocale", () => {
    // THE headline regression the review caught: a multi-subtag request locale
    // must still narrow to its stored 2-subtag key (Traditional Chinese stays
    // Traditional Chinese, never flips to base English).
    expect(resolveLocale(parseLocaleParam("zh-Hant-TW"), ["zh-hant"])).toBe("zh-hant");
    expect(resolveLocale(parseLocaleParam("es-419"), ["es"])).toBe("es");
    // Garbage resolves to base (null) — same as before, now short-circuited earlier.
    expect(resolveLocale(parseLocaleParam("<script>"), ["fr", "de"])).toBeNull();
    // A valid, available locale resolves identically.
    expect(resolveLocale(parseLocaleParam("fr"), ["fr", "de"])).toBe("fr");
    // A valid-shaped but unavailable locale → base (null), same as raw resolveLocale.
    expect(resolveLocale(parseLocaleParam("es"), ["fr", "de"])).toBeNull();
  });

  it("is a strict SUPERSET of the stored-key gate (every LOCALE_RE key stays requestable)", () => {
    // The broadening is byte-stable ONLY because resolveLocale only ever returns
    // a member of `available`, and every stored key is LOCALE_RE-shaped (gated by
    // the translate intent). So a stored locale must always pass parseLocaleParam
    // — if someone tightened REQUEST_LOCALE_RE below LOCALE_RE, a stored locale
    // could stop being requestable. This pins that coupling.
    for (const k of ["fr", "de", "pt-br", "zh-hant", "en-us", "es-mx", "ar"]) {
      expect(LOCALE_RE.test(k)).toBe(true); // representative stored-key shapes
      expect(parseLocaleParam(k)).toBe(k); // ...are all requestable
    }
  });
});
