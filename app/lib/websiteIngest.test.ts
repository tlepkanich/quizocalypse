import { describe, it, expect } from "vitest";
import { extractReadableText } from "./websiteIngest.server";

describe("extractReadableText", () => {
  it("keeps body copy and drops script/style/nav/footer chrome", () => {
    const html = `
      <html><head><title>Brand</title><style>.x{color:red}</style></head>
      <body>
        <nav>Home Shop About <a href="/cart">Cart</a></nav>
        <header>MENU</header>
        <main><h1>Our Mission</h1><p>We make gentle skincare for sensitive skin.</p></main>
        <script>analytics('track')</script>
        <footer>© 2026 Brand · Privacy</footer>
      </body></html>`;
    const text = extractReadableText(html);
    expect(text).toMatch(/Our Mission/);
    expect(text).toMatch(/gentle skincare for sensitive skin/);
    // chrome + code stripped
    expect(text).not.toMatch(/analytics/);
    expect(text).not.toMatch(/color:red/);
    expect(text).not.toMatch(/© 2026/);
    expect(text).not.toMatch(/MENU/);
    expect(text).not.toMatch(/Cart/);
  });

  it("decodes common entities and collapses whitespace", () => {
    const text = extractReadableText("<p>Tom &amp; Jerry&nbsp;&nbsp;say&#39;s   hi</p>");
    expect(text).toBe("Tom & Jerry say's hi");
  });

  it("removes all tags, leaving plain text", () => {
    expect(extractReadableText("<div><b>Hi</b> <i>there</i></div>")).toBe("Hi there");
  });

  it("handles empty / tagless input", () => {
    expect(extractReadableText("")).toBe("");
    expect(extractReadableText("just words")).toBe("just words");
  });
});
