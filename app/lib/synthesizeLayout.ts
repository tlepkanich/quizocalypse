import type { ContentBlock, QuizNode } from "./quizSchema";

// ───────────────────────────────────────────────────────────────────────────
// synthesizeLayout — reproduce a node's fixed template as an editable block
// stack (Phase 2). Powers "break this step into blocks" and seeds the Layout
// Library from a faithful baseline. Pure; deterministic block ids so
// re-synthesis is stable and diffable.
//
// Round-trip contract: rendering synthesizeLayout(node) through QuizStepView
// produces the same output as the fixed template. `branch` / `integration` are
// invisible auto-advance nodes → empty stack (the renderer treats [] as the
// fixed path, preserving their behavior).
// ───────────────────────────────────────────────────────────────────────────

const EMPTY = {} as const; // BlockStyle default ({})

function bid(nodeId: string, suffix: string): string {
  return `${nodeId}::${suffix}`;
}

function heading(
  nodeId: string,
  bind: "headline" | "text" | "persona_name" | "none",
  opts?: { level?: "h1" | "h2"; text?: string },
): ContentBlock {
  return {
    id: bid(nodeId, "heading"),
    style: EMPTY,
    type: "heading",
    level: opts?.level ?? "h2",
    bind,
    text: opts?.text ?? "",
  };
}

function text(
  nodeId: string,
  bind: "subtext" | "text" | "opening_message" | "none",
  opts?: { suffix?: string; mergeTags?: boolean; text?: string },
): ContentBlock {
  return {
    id: bid(nodeId, opts?.suffix ?? "text"),
    style: EMPTY,
    type: "text",
    bind,
    text: opts?.text ?? "",
    supports_merge_tags: opts?.mergeTags ?? false,
  };
}

function image(nodeId: string, bind: "hero_image_url"): ContentBlock {
  return {
    id: bid(nodeId, "image"),
    style: EMPTY,
    type: "image",
    bind,
    alt: "",
    fit: "cover",
    aspect: "auto",
  };
}

function button(
  nodeId: string,
  bind: "button_label" | "cta_label" | "continue_label" | "none",
  opts?: { label?: string; variant?: "primary" | "outline" | "ghost" },
): ContentBlock {
  return {
    id: bid(nodeId, "button"),
    style: EMPTY,
    type: "button",
    bind,
    label: opts?.label ?? "Continue",
    variant: opts?.variant ?? "primary",
  };
}

function smart(
  nodeId: string,
  type: "answers" | "recommendations" | "email_input" | "ai_chat" | "product_grid",
): ContentBlock {
  switch (type) {
    case "answers":
      return { id: bid(nodeId, "answers"), style: EMPTY, type, layout: "auto" };
    case "recommendations":
      return { id: bid(nodeId, "recs"), style: EMPTY, type, stage: "all" };
    case "email_input":
      return { id: bid(nodeId, "email"), style: EMPTY, type };
    case "ai_chat":
      return { id: bid(nodeId, "chat"), style: EMPTY, type };
    case "product_grid":
      return { id: bid(nodeId, "grid"), style: EMPTY, type };
  }
}

export function synthesizeLayout(node: QuizNode): ContentBlock[] {
  const id = node.id;
  switch (node.type) {
    case "intro": {
      const blocks: ContentBlock[] = [];
      if (node.data.hero_image_url) blocks.push(image(id, "hero_image_url"));
      blocks.push(heading(id, "headline", { level: "h1" }));
      if (node.data.subtext) blocks.push(text(id, "subtext"));
      blocks.push(button(id, "button_label"));
      return blocks;
    }
    case "question":
      return [heading(id, "text"), smart(id, "answers")];
    case "email_gate": {
      const blocks: ContentBlock[] = [heading(id, "headline")];
      if (node.data.subtext) blocks.push(text(id, "subtext"));
      blocks.push(smart(id, "email_input"));
      return blocks;
    }
    case "result": {
      const blocks: ContentBlock[] = [heading(id, "headline")];
      if (node.data.subtext) blocks.push(text(id, "subtext"));
      blocks.push(smart(id, "recommendations"));
      return blocks;
    }
    case "message":
      return [
        text(id, "text", { mergeTags: node.data.supports_merge_tags }),
        button(id, "none", { label: "Continue" }),
      ];
    case "end": {
      const blocks: ContentBlock[] = [heading(id, "headline")];
      if (node.data.subtext) blocks.push(text(id, "subtext"));
      if (node.data.cta_url) blocks.push(button(id, "cta_label"));
      return blocks;
    }
    case "ask_ai":
      return [smart(id, "ai_chat")];
    case "product_cards": {
      const blocks: ContentBlock[] = [heading(id, "headline")];
      if (node.data.subtext) blocks.push(text(id, "subtext"));
      blocks.push(smart(id, "product_grid"));
      blocks.push(button(id, "continue_label"));
      return blocks;
    }
    case "branch":
    case "integration":
      return [];
  }
}
