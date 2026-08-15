import { afterEach, describe, expect, it, vi } from "vitest";
import { apiUrl, getApiBase, setApiBase } from "./apiBase";

// The whole point of the default is that /q is untouched: every existing
// caller must keep producing the exact same relative path it did before the
// DOM-embed seam landed. These tests pin that.

afterEach(() => {
  vi.unstubAllGlobals();
  setApiBase("");
});

describe("apiBase", () => {
  it("returns the path unchanged when no base is set (the /q iframe case)", () => {
    expect(getApiBase()).toBe("");
    expect(apiUrl("/events")).toBe("/events");
    expect(apiUrl("/q/abc123/rec-copy")).toBe("/q/abc123/rec-copy");
  });

  it("no-ops during SSR so module state can never leak between requests", () => {
    vi.stubGlobal("window", undefined);
    setApiBase("https://quizocalypse-studio.fly.dev");
    expect(getApiBase()).toBe("");
    expect(apiUrl("/events")).toBe("/events");
  });

  it("prefixes an absolute origin in the browser", () => {
    vi.stubGlobal("window", {} as unknown as Window);
    setApiBase("https://quizocalypse-studio.fly.dev");
    expect(apiUrl("/events")).toBe("https://quizocalypse-studio.fly.dev/events");
  });

  it("strips trailing slashes so paths never double up", () => {
    vi.stubGlobal("window", {} as unknown as Window);
    setApiBase("https://quizocalypse-studio.fly.dev///");
    expect(apiUrl("/captures")).toBe("https://quizocalypse-studio.fly.dev/captures");
  });

  it("can be reset back to same-origin", () => {
    vi.stubGlobal("window", {} as unknown as Window);
    setApiBase("https://example.test");
    setApiBase("");
    expect(apiUrl("/sessions")).toBe("/sessions");
  });
});
