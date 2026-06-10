import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import {
  extractTranslatableStrings,
  applyTranslations,
  sourceHashOf,
  resolveLocale,
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
