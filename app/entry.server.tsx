import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { RemixServer } from "@remix-run/react";
import {
  createReadableStreamFromReadable,
  type EntryContext,
  type HandleErrorFunction,
} from "@remix-run/node";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";
import { reportError } from "./lib/log.server";

export const streamTimeout = 5000;

// BIC-2 A1 — the Remix v2 server-side error seam: every unexpected loader/
// action/render error lands here (thrown Responses don't). Structured log +
// dormant Sentry forward via reportError. Aborted requests (client bailed)
// are noise, not errors — the documented Remix pattern skips them. Only the
// PATHNAME is logged: query strings can carry session capability tokens.
export const handleError: HandleErrorFunction = (error, { request }) => {
  if (request.signal.aborted) return;
  let pathname: string | undefined;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    pathname = undefined;
  }
  reportError(error, {
    scope: "remix",
    msg: "unhandled route error",
    pathname,
    method: request.method,
  });
};

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext
) {
  addDocumentResponseHeaders(request, responseHeaders);
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? '')
    ? "onAllReady"
    : "onShellReady";

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <RemixServer
        context={remixContext}
        url={request.url}
      />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          reportError(error, { scope: "remix", msg: "stream render error" });
        },
      }
    );

    // Automatically timeout the React renderer after 6 seconds, which ensures
    // React has enough time to flush down the rejected boundary contents
    setTimeout(abort, streamTimeout + 1000);
  });
}
