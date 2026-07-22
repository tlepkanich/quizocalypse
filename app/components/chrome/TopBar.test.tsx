import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { TopBar } from "./TopBar";

// The Wordmark links, so TopBar needs a router context to render.
function render(ui: React.ReactElement): string {
  const router = createMemoryRouter([{ path: "/", element: ui }]);
  return renderToString(<RouterProvider router={router} />);
}

describe("TopBar — step1 handoff §1 two-row funnel chrome", () => {
  it("without nav renders the classic three-zone single row", () => {
    const html = render(<TopBar center={<span>pills</span>} right={<span>actions</span>} />);
    expect(html).toContain("qz-topbar-center");
    expect(html).not.toContain("qz-topbar--tworow");
    expect(html).not.toContain("qz-topbar-nav");
  });

  it("with nav renders two rows: wordmark+actions row, then the nav row", () => {
    const html = render(<TopBar nav={<span>stepper</span>} right={<span>actions</span>} />);
    expect(html).toContain("qz-topbar--tworow");
    // Row 1 carries the actions; the stepper sits in its own row below.
    expect(html).toMatch(/qz-topbar-row[\s\S]*actions[\s\S]*qz-topbar-nav[\s\S]*stepper/);
    // The center zone (and its dividers) is gone in the two-row variant.
    expect(html).not.toContain("qz-topbar-center");
  });

  it("nav wins over center — the stepper never renders twice", () => {
    const html = render(<TopBar nav={<span>stepper</span>} center={<span>pills</span>} />);
    expect(html).not.toContain("pills");
  });
});
