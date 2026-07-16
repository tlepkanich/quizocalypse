import { describe, expect, it } from "vitest";
import {
  ALPINE_ART_DIRECTION_CSS,
  GENERATED_ART_DIRECTION_CSS,
} from "./runtimeArtDirection";

describe("generated runtime art direction", () => {
  it("keeps decorative layers out of the content plane", () => {
    const css = `${GENERATED_ART_DIRECTION_CSS}\n${ALPINE_ART_DIRECTION_CSS}`;
    expect(css).not.toContain("::before");
    expect(css).not.toContain("::after");
    expect(css).not.toContain("repeating-linear-gradient");
    expect(css).not.toContain("linear-gradient(");
    expect(css).not.toContain("position: absolute");
  });

  it("responds to the quiz canvas instead of the surrounding window", () => {
    const css = `${GENERATED_ART_DIRECTION_CSS}\n${ALPINE_ART_DIRECTION_CSS}`;
    expect(css).toContain(".qz-bp-mobile");
    expect(css).toContain(".qz-bp-desktop");
    expect(css).not.toContain("@media (max-width");
    expect(css).not.toContain("vw");
    expect(css).not.toContain("vh");
  });

  it("contains long generated copy instead of turning it into a billboard", () => {
    expect(GENERATED_ART_DIRECTION_CSS).toContain("overflow-wrap: anywhere");
    expect(GENERATED_ART_DIRECTION_CSS).not.toContain("text-transform: uppercase");
    expect(GENERATED_ART_DIRECTION_CSS).not.toMatch(
      /font-size:[^;]*(?:9[7-9]|[1-9][0-9]{2,})px/,
    );
  });
});
