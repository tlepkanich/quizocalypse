// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";
import { TargetOptions } from "./TargetOptions";
import type { BuilderCategory } from "../../../builder/stepProps";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(cats: BuilderCategory[]): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(createElement("select", null, createElement(TargetOptions, { categories: cats }))),
  );
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.replaceChildren();
});

const cat = (id: string, name: string, quizId: string | null): BuilderCategory => ({
  id,
  name,
  description: "",
  tags: [],
  productIds: [],
  source: "tag",
  sourceRef: null,
  quizId,
});

describe("TargetOptions grouping (reduced cognitive load)", () => {
  it("labels two optgroups (This quiz / Reusable Groups) when both kinds exist", () => {
    const el = mount([cat("a", "Quiz A", "q1"), cat("g", "Group G", null)]);
    const groups = [...el.querySelectorAll("optgroup")];
    expect(groups.map((g) => g.label)).toEqual(["This quiz", "Reusable Groups"]);
  });

  it("renders a FLAT list (no optgroups) when there is only one kind", () => {
    const el = mount([cat("a", "Quiz A", "q1"), cat("b", "Quiz B", "q1")]);
    expect(el.querySelectorAll("optgroup").length).toBe(0);
    expect(el.querySelectorAll("option").length).toBe(2);
  });
});
