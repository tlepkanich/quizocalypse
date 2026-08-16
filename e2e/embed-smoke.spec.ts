import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

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
const THEME_RED = "rgb(192, 57, 43)"; // #c0392b, what the hostile CSS forces

/**
 * A REAL http server for the fake storefront, on an ephemeral loopback port.
 *
 * The obvious design — page.route() fulfilling a made-up origin — works
 * against the deploy and silently cannot work against a local build.
 * Chromium refuses it with:
 *
 *   Access to script at 'http://localhost:3111/embed/wiskr-embed.js' from
 *   origin '…' has been blocked by CORS policy: Permission was denied for
 *   this request to access the `loopback` address space.
 *
 * Private Network Access. A fulfilled page never came from the network, so it
 * is not classified as loopback and may not pull subresources from loopback —
 * true even when the fake origin is itself spelled "localhost". The bundle
 * never loaded, and the two DOM tests below failed for a reason that had
 * nothing to do with the code under test. A mutation test run against a local
 * build was invalidated by exactly this.
 *
 * A genuine listener is classified loopback, so local→local passes, and
 * loopback→https-public is a normal upgrade. Different port = different
 * origin, so the cross-origin property this suite exists to prove still holds
 * in both environments.
 */
const openStorefronts: Array<() => Promise<void>> = [];

// Every listener started by a test is closed here, so a failing assert can
// never leave a port bound and wedge the rest of the run.
test.afterEach(async () => {
  while (openStorefronts.length) await openStorefronts.pop()!();
});

async function startStorefront(html: string) {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  openStorefronts.push(close);
  return { url: `http://127.0.0.1:${port}/`, close };
}

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

// Merchants paste ONE stable URL, so this bundle must stay revalidatable.
// It originally shipped from build/client/, where remix-serve stamps
// `max-age=31536000, immutable` — correct for content-hashed /assets/*, and
// silently fatal here: every shopper who loaded it once would be pinned to
// that build for a year and no runtime fix would ever reach them. A fresh
// browser context (like this suite) would never notice, which is exactly why
// it needs an explicit header assert rather than a behavioural one.
test("embed bundle is cacheable but NOT immutable", async ({ request, baseURL }) => {
  const res = await request.get(`${baseURL}/embed/wiskr-embed.js`);
  const cacheControl = res.headers()["cache-control"] ?? "";
  const etag = res.headers()["etag"];

  expect(cacheControl, "a stable-path bundle must never be immutable").not.toContain(
    "immutable",
  );
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/)?.[1] ?? "0");
  expect(maxAge, `max-age too long for a stable path: ${cacheControl}`).toBeLessThanOrEqual(
    3600,
  );
  expect(etag, "no ETag — every revalidation would re-download ~420KB").toBeTruthy();

  // And the ETag must actually work, or the short max-age just costs bandwidth.
  const revalidated = await request.get(`${baseURL}/embed/wiskr-embed.js`, {
    headers: { "If-None-Match": etag! },
  });
  expect(revalidated.status()).toBe(304);
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

  const storefront = await startStorefront(storefrontHtml(baseURL!, QUIZ_ID));
  await page.goto(storefront.url);

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
  const storefront = await startStorefront(storefrontHtml(baseURL!, QUIZ_ID));
  await page.goto(storefront.url);
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
