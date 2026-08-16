import { test, expect } from "@playwright/test";

// Post-deploy smoke for the DOM embed (EMBED-1). runtime-smoke.spec.ts covers
// /q — the iframe path — and knew nothing about this one, so a broken embed
// bundle could ship and auto-rollback would never fire.
//
// The whole point of the embed is that it works CROSS-ORIGIN, mounted in a
// merchant's document. Navigating to our own origin and injecting the script
// would be same-origin and would prove nothing: the CORS on
// /q/:id.embed.json, and the script-src origin discovery, are exactly what
// breaks in the real world. So we intercept a fake storefront origin and
// fulfil it locally; the <script src> inside it is NOT intercepted, so it
// hits the real deploy and the browser treats it as genuinely cross-origin.
//
// The storefront CSS below is deliberately hostile — the same rules that
// recoloured the quiz's Start button when this was built light-DOM. They are
// the regression test for the shadow root.

const QUIZ_ID = process.env.SMOKE_EMBED_QUIZ || "cmq566eof0001qvky8ze2qcwn";
const STOREFRONT = "https://wiskr-embed-smoke.test/";
const THEME_RED = "rgb(192, 57, 43)"; // #c0392b, what the hostile CSS forces

function storefrontHtml(appOrigin: string, quizId: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>embed smoke storefront</title>
<style>
  body { font-family: Georgia, serif; margin: 0; }
  /* Hostile theme CSS — must NOT reach inside the shadow root. */
  button { background: #c0392b !important; color: #fff !important;
           border-radius: 0 !important; font-family: cursive !important; }
  h1, h2 { color: #c0392b !important; letter-spacing: .3em !important; }
</style></head>
<body>
  <!-- CONTROL: a button OUTSIDE the shadow root. The test asserts this one IS
       theme-red. Without it, "the quiz button isn't red" would also pass if
       the hostile CSS silently stopped applying at all — a vacuous green. -->
  <button id="theme-control">theme control</button>
  <div data-wiskr-quiz data-quiz-id="${quizId}" data-locale="en"></div>
  <script defer src="${appOrigin}/embed/wiskr-embed.js"></script>
</body></html>`;
}

test("embed bundle is served with a JS content-type", async ({ request, baseURL }) => {
  const res = await request.get(`${baseURL}/embed/wiskr-embed.js`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("javascript");
  // Guards against an empty/truncated artifact being served as 200.
  expect((await res.body()).byteLength).toBeGreaterThan(100_000);
});

// The embed bundle is PUBLIC — anyone can GET it. Its import graph reaches
// into app/lib and app/components, which also hold server-only modules, so a
// future refactor that pulls one in would publish it to the internet. This
// asserts against what is ACTUALLY SERVED rather than what built locally,
// which is the only version that can actually leak.
test("embed bundle contains no server-only code or secrets", async ({ request, baseURL }) => {
  const body = await (await request.get(`${baseURL}/embed/wiskr-embed.js`)).text();

  const forbidden: Array<[string, string]> = [
    ["PrismaClient", "database client bundled into a public asset"],
    ["@prisma/client", "prisma import reached the embed graph"],
    ["DATABASE_URL", "database connection string"],
    ["ANTHROPIC_API_KEY", "Anthropic key"],
    ["sk-ant-", "literal Anthropic key"],
    ["STUDIO_ACCESS_TOKEN", "studio break-glass token"],
    ["STUDIO_SESSION_SECRET", "studio session signing secret"],
    ["SHOPIFY_API_SECRET", "Shopify app secret"],
    ["RESEND_API_KEY", "Resend key"],
    ["webhookSignature", "server-side webhook signing helper"],
    ["aiBudget.server", "server-only budget module"],
  ];

  const found = forbidden.filter(([needle]) => body.includes(needle));
  expect(
    found.map(([needle, why]) => `${needle} (${why})`),
    "server-only code or a secret is being served in the PUBLIC embed bundle",
  ).toEqual([]);
});

test("embed.json answers cross-origin with CORS and the runtime props", async ({
  request,
  baseURL,
}) => {
  const res = await request.get(`${baseURL}/q/${QUIZ_ID}.embed.json`, {
    headers: { Origin: "https://a-store.myshopify.com" },
  });
  expect(res.status()).toBe(200);
  expect(res.headers()["access-control-allow-origin"]).toBe("*");

  const body = await res.json();
  // The props the runtime cannot render without.
  for (const key of ["quizId", "doc", "productIndex", "chrome", "locale"]) {
    expect(body).toHaveProperty(key);
  }
  expect(Array.isArray(body.doc?.nodes)).toBe(true);
  expect(body.doc.nodes.length).toBeGreaterThan(0);
  // Never ship the raw multi-locale maps to the client (they are stripped
  // server-side after the locale is applied).
  expect(body.doc).not.toHaveProperty("translations");
});

test("DOM embed mounts cross-origin into a shadow root, immune to theme CSS", async ({
  page,
  baseURL,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  await page.route(STOREFRONT, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: storefrontHtml(baseURL!, QUIZ_ID),
    }),
  );
  await page.goto(STOREFRONT);

  // The runtime mounts after fetching embed.json, so wait on the rendered
  // tree rather than a fixed timeout.
  await page.waitForFunction(
    () => {
      const host = document.querySelector("[data-wiskr-quiz]");
      return !!host?.shadowRoot?.querySelector("button");
    },
    undefined,
    { timeout: 30_000 },
  );

  const probe = await page.evaluate(() => {
    const host = document.querySelector("[data-wiskr-quiz]") as HTMLElement;
    const shadow = host.shadowRoot!;
    const button = shadow.querySelector("button")!;
    const buttonStyle = getComputedStyle(button);
    const control = document.getElementById("theme-control")!;
    return {
      // Proves the hostile CSS is live on this page, so the shadow-root
      // assertions below are meaningful rather than vacuously true.
      controlBackground: getComputedStyle(control).backgroundColor,
      origin: (window as unknown as { Wiskr?: { origin: string } }).Wiskr?.origin,
      hasShadowRoot: !!host.shadowRoot,
      // Styles must be scoped INSIDE the shadow root, not leaked to the host page.
      stylesInShadow: !!shadow.getElementById("wiskr-embed-styles"),
      stylesLeakedToHead: !!document.getElementById("wiskr-embed-styles"),
      iframeCount: document.querySelectorAll("iframe").length,
      buttonBackground: buttonStyle.backgroundColor,
      buttonRadius: buttonStyle.borderRadius,
      buttonFontFamily: buttonStyle.fontFamily,
      renderedText: (shadow.textContent || "").replace(/\s+/g, " ").trim().length,
    };
  });

  expect(probe.hasShadowRoot).toBe(true);
  expect(probe.stylesInShadow).toBe(true);
  expect(probe.stylesLeakedToHead).toBe(false);
  // Origin is discovered from the <script src>, not configured.
  expect(probe.origin).toBe(baseURL);
  // The defining property of the DOM embed.
  expect(probe.iframeCount).toBe(0);
  expect(probe.renderedText).toBeGreaterThan(0);

  // Control first: if this is not red the hostile CSS never applied and every
  // assertion after it would pass for the wrong reason.
  expect(
    probe.controlBackground,
    "hostile theme CSS did not apply to the control button — the shadow-root assertions below would be vacuous",
  ).toBe(THEME_RED);

  // The shadow boundary must block the host theme's !important rules.
  expect(probe.buttonBackground).not.toBe(THEME_RED);
  expect(probe.buttonRadius).not.toBe("0px");
  expect(probe.buttonFontFamily.toLowerCase()).not.toContain("cursive");

  expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toHaveLength(0);
});

test("embed survives a re-init without double-mounting", async ({ page, baseURL }) => {
  // Themes re-run section JS on every theme-editor settings change, and the
  // entry re-scans on shopify:section:load. Mounting must be idempotent or a
  // merchant editing their theme ends up with two quizzes stacked.
  await page.route(STOREFRONT, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: storefrontHtml(baseURL!, QUIZ_ID),
    }),
  );
  await page.goto(STOREFRONT);
  await page.waitForFunction(
    () => !!document.querySelector("[data-wiskr-quiz]")?.shadowRoot?.querySelector("button"),
    undefined,
    { timeout: 30_000 },
  );

  const rootsAfterReinit = await page.evaluate(async () => {
    const w = window as unknown as { Wiskr?: { mountAll: () => void } };
    w.Wiskr?.mountAll();
    document.dispatchEvent(new CustomEvent("shopify:section:load"));
    await new Promise((r) => setTimeout(r, 750));
    const shadow = document.querySelector("[data-wiskr-quiz]")!.shadowRoot!;
    return shadow.querySelectorAll(".qz-embed-root").length;
  });

  expect(rootsAfterReinit).toBe(1);
});
