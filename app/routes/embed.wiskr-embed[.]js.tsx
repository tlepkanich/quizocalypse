import type { LoaderFunctionArgs } from "@remix-run/node";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Serves the DOM-embed bundle (built by vite.embed.config.ts into
// build/embed/wiskr-embed.js).
//
// WHY A ROUTE AND NOT A STATIC FILE. The bundle first shipped from
// build/client/embed/, which remix-serve serves statically — and stamps with
// `cache-control: public, max-age=31536000, immutable`. That header is right
// for /assets/*, where the FILENAME carries a content hash, and wrong here:
// merchants paste one stable URL, so `immutable` tells every shopper's
// browser to keep whatever bundle it first saw for a year without ever
// revalidating. A runtime fix would reach new visitors only. Serving it from
// a route is the only way to set our own headers, because static files are
// matched before routes.
//
// 5 minutes + SWR: a deploy reaches storefronts within minutes, and the ETag
// makes the revalidation a 304 rather than a re-download of ~420KB.
//
// NOT byte-pinned and NOT part of the /q contract — this file changes on any
// runtime change, by design.

const CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=86400";

let cached: { body: string; etag: string } | null = null;

/** Read once per process; the file cannot change without a redeploy. */
function loadBundle(): { body: string; etag: string } | null {
  if (cached) return cached;
  try {
    // utf8, not a Buffer: Buffer is not a valid BodyInit under this
    // lib.dom typing, and the bundle is UTF-8 JavaScript by construction.
    const body = readFileSync(join(process.cwd(), "build", "embed", "wiskr-embed.js"), "utf8");
    const etag = `"${createHash("sha256").update(body).digest("hex").slice(0, 32)}"`;
    cached = { body, etag };
    return cached;
  } catch {
    // Missing artifact = `npm run build:embed` did not run. Fail as a JS
    // comment, not an exception: this lands in a merchant's <script> tag, and
    // a 500 HTML body there is noise in their console either way.
    return null;
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const bundle = loadBundle();
  if (!bundle) {
    return new Response("// wiskr: embed bundle unavailable\n", {
      status: 500,
      headers: { "content-type": "application/javascript; charset=utf-8" },
    });
  }

  const headers: Record<string, string> = {
    "content-type": "application/javascript; charset=utf-8",
    "cache-control": CACHE_CONTROL,
    etag: bundle.etag,
    // A classic <script src> needs no CORS, but anything that fetch()es the
    // bundle (our own e2e leak check, a merchant's bundler) does.
    "access-control-allow-origin": "*",
  };

  if (request.headers.get("if-none-match") === bundle.etag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(bundle.body, { status: 200, headers });
};
