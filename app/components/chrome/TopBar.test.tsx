import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { TopBar } from "./TopBar";

// The Wordmark links, so TopBar needs a router context to render.
function render(ui: React.ReactElement): string {
  const router = createMemoryRouter([{ path: "/", element: ui }]);
  return renderToString(<RouterProvider router={router} />);
}

describe("TopBar — one-line-chrome funnel bar", () => {
  it("without nav renders the classic three-zone single row", () => {
    const html = render(<TopBar center={<span>pills</span>} right={<span>actions</span>} />);
    expect(html).toContain("qz-topbar-center");
    expect(html).not.toContain("qz-topbar--flow");
  });

  it("with nav renders ONE line: logo · flow · right zone", () => {
    const html = render(<TopBar nav={<span>stepper</span>} right={<span>actions</span>} />);
    expect(html).toContain("qz-topbar--flow");
    // The flow sits between the left (logo) zone and the right (actions) zone.
    expect(html).toMatch(/qz-topbar-left[\s\S]*qz-topbar-flow[\s\S]*stepper[\s\S]*qz-topbar-right[\s\S]*actions/);
    // The center zone (and its dividers) is gone in the flow variant, and the
    // logo renders compact — the tile alone, no product name (§1.1).
    expect(html).not.toContain("qz-topbar-center");
    expect(html).not.toContain("qz-wordmark-name");
  });

  it("nav wins over center — the stepper never renders twice", () => {
    const html = render(<TopBar nav={<span>stepper</span>} center={<span>pills</span>} />);
    expect(html).not.toContain("pills");
  });
});
