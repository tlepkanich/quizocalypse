import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { buildRuntimePayload } from "../lib/runtimePayload.server";
import { corsPreflight, withCors } from "../lib/publicCors";

// /q/:id.embed.json — the DOM embed's data source.
//
// Serves the SAME 19 props the /q/:id loader feeds <QuizRuntime>, via the
// shared seam in runtimePayload.server.ts. `?locale=` is applied server-side
// exactly as it is for /q, so the embed never ships the translation maps and
// the two surfaces cannot drift.
//
// Deliberately NOT /q/:id.json. That route serves stripPublicJsonPayload()
// (a different, smaller shape) and its bytes are pinned at c02ccaec98a0fe9e
// as the dual-model invariant's checkable form. This is a sibling so that pin
// stays untouched.
//
// CORS-open + 60s cache, matching /q/:id.json and the launcher.

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") return corsPreflight();

  const { id } = params;
  if (!id) return withCors(json({ error: "Missing id" }, { status: 400 }));

  // buildRuntimePayload THROWS a bare Response for not-found / invalid-JSON.
  // Uncaught, that reply would reach the browser without CORS headers, so a
  // cross-origin embed could not read why it failed — it would surface as an
  // opaque network error instead of "quiz not published". Catch and re-dress.
  try {
    const { payload } = await buildRuntimePayload(id, request);
    return withCors(
      json(payload, {
        headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
      }),
    );
  } catch (err) {
    if (err instanceof Response) {
      return withCors(
        json({ error: await err.clone().text() }, { status: err.status }),
      );
    }
    throw err;
  }
};
