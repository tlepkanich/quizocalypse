// app/routes/app.design.guidelines.tsx
// Action-only route. Persists brand guidelines from one of three sources:
//   1. Multipart upload (file field)  → calls extractBrandGuidelines via Claude
//   2. Preset selection (presetId)    → looks up BRAND_VOICE_PRESETS
//   3. DELETE                          → clears shop.brandGuidelines

import type { ActionFunctionArgs } from "@remix-run/node";
import {
  json,
  unstable_createMemoryUploadHandler,
  unstable_parseMultipartFormData,
} from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  extractBrandGuidelines,
  BrandExtractionError,
} from "../lib/brandExtract";
import { getPreset, BRAND_VOICE_PRESETS } from "../lib/brandVoicePresets";
import type { BrandGuidelines } from "../lib/brandGuidelines";

// 10MB cap on uploaded files — generous enough for a brand book PDF but
// keeps the server-side base64 + Claude payload bounded.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });
  if (!shop) return json({ ok: false, error: "Shop not found" }, { status: 400 });

  // DELETE clears guidelines back to null. The wizard pill disappears,
  // and future AI generations fall back to default tone.
  if (request.method === "DELETE") {
    await prisma.shop.update({
      where: { id: shop.id },
      data: { brandGuidelines: null as never },
    });
    return json({ ok: true, guidelines: null });
  }

  const contentType = request.headers.get("content-type") ?? "";

  // Branch: multipart upload → extraction. URL-encoded form (or plain JSON)
  // with presetId → preset persistence.
  if (contentType.includes("multipart/form-data")) {
    return handleUpload(request, shop.id);
  }
  return handlePreset(request, shop.id);
}

async function handleUpload(request: Request, shopId: string) {
  let form: FormData;
  try {
    form = await unstable_parseMultipartFormData(
      request,
      unstable_createMemoryUploadHandler({
        maxPartSize: MAX_UPLOAD_BYTES,
      }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Upload failed";
    return json({ ok: false, error: msg }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return json(
      { ok: false, error: "No file provided. Attach a PDF, image, or text file." },
      { status: 400 },
    );
  }
  if (file.size === 0) {
    return json({ ok: false, error: "Empty file." }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  try {
    const guidelines = await extractBrandGuidelines({
      file: buf,
      mediaType: file.type || "text/plain",
      fileName: file.name || "upload",
    });
    await prisma.shop.update({
      where: { id: shopId },
      data: { brandGuidelines: guidelines as never },
    });
    return json({ ok: true, guidelines });
  } catch (err) {
    if (err instanceof BrandExtractionError) {
      return json(
        {
          ok: false,
          error: `${err.message}${err.lastValidationIssue ? ` (${err.lastValidationIssue})` : ""}`,
        },
        { status: 502 },
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: msg }, { status: 500 });
  }
}

async function handlePreset(request: Request, shopId: string) {
  let presetId: string | null = null;
  try {
    const form = await request.formData();
    const raw = form.get("presetId");
    if (typeof raw === "string" && raw.length > 0) presetId = raw;
  } catch {
    // Not multipart — fall through to JSON body parse below.
  }

  if (!presetId) {
    return json(
      {
        ok: false,
        error: "Expected a `file` (multipart upload), `presetId` (form field), or DELETE method.",
        available_presets: BRAND_VOICE_PRESETS.map((p) => p.id),
      },
      { status: 400 },
    );
  }

  const preset = getPreset(presetId);
  if (!preset) {
    return json(
      {
        ok: false,
        error: `Unknown preset id: ${presetId}`,
        available_presets: BRAND_VOICE_PRESETS.map((p) => p.id),
      },
      { status: 404 },
    );
  }

  // Stamp uploaded_at to "now" so the design page renders the merchant's
  // recent selection rather than the module-load epoch.
  const stamped: BrandGuidelines = {
    ...preset.guidelines,
    source: {
      ...preset.guidelines.source,
      uploaded_at: new Date().toISOString(),
    },
  };
  await prisma.shop.update({
    where: { id: shopId },
    data: { brandGuidelines: stamped as never },
  });
  return json({ ok: true, guidelines: stamped });
}
