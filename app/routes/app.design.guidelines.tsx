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
import { withAiSpendRecording } from "../lib/aiBudget.server";
import { reportError } from "../lib/log.server";
import { getPreset, BRAND_VOICE_PRESETS } from "../lib/brandVoicePresets";
import type { BrandGuidelines } from "../lib/brandGuidelines";
import {
  BrandTokens,
  resolveDesignTokens,
  type DesignTokensT,
} from "../lib/designTokens";

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
  // and future AI generations fall back to default tone. We deliberately
  // leave shop.brandTokens untouched — removing the voice shouldn't ambush
  // the merchant's visual setup. They can reset the palette themselves.
  if (request.method === "DELETE") {
    await prisma.shop.update({
      where: { id: shop.id },
      data: { brandGuidelines: null as never },
    });
    return json({ ok: true, guidelines: null });
  }

  // Reusable: every persistence path merges the existing brand tokens with
  // the guidelines' visual_suggestions.tokens (if present) so picking a
  // preset / uploading a brand book also flips the theme to match. Read
  // the existing tokens once so a partial preset (e.g. colors only)
  // doesn't clobber a hand-tuned font.
  const existingTokensParse = BrandTokens.safeParse(shop.brandTokens ?? {});
  const existingTokens: DesignTokensT = existingTokensParse.success
    ? existingTokensParse.data
    : {};

  const contentType = request.headers.get("content-type") ?? "";

  // Branch: multipart upload → extraction. URL-encoded form (or plain JSON)
  // with presetId → preset persistence.
  if (contentType.includes("multipart/form-data")) {
    return handleUpload(request, shop.id, existingTokens);
  }
  return handlePreset(request, shop.id, existingTokens);
}

// Compose the Prisma update payload — always writes brandGuidelines; also
// writes brandTokens when the guidelines carry a visual suggestion. The
// merge uses resolveDesignTokens so partial overrides layer cleanly onto
// the existing brand setup.
function buildShopUpdate(
  guidelines: BrandGuidelines,
  existingTokens: DesignTokensT,
): {
  brandGuidelines: BrandGuidelines;
  brandTokens?: DesignTokensT;
} {
  const sug = guidelines.visual_suggestions.tokens;
  if (!sug) return { brandGuidelines: guidelines };
  return {
    brandGuidelines: guidelines,
    brandTokens: resolveDesignTokens(existingTokens, sug),
  };
}

async function handleUpload(
  request: Request,
  shopId: string,
  existingTokens: DesignTokensT,
) {
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
    // ai-fallbacks Gap 8 — thread the shopId so the extraction's token usage
    // lands in the budget ledger (brandExtract now calls the shared client).
    const guidelines = await withAiSpendRecording(shopId, () =>
      extractBrandGuidelines({
        file: buf,
        mediaType: file.type || "text/plain",
        fileName: file.name || "upload",
      }),
    );
    const updateData = buildShopUpdate(guidelines, existingTokens);
    await prisma.shop.update({
      where: { id: shopId },
      data: updateData as never,
    });
    return json({
      ok: true,
      guidelines,
      brandTokens: updateData.brandTokens ?? existingTokens,
    });
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
    // ai-fallbacks Gap 2 — never render a raw provider error to the merchant
    // (this path once surfaced billing text verbatim). Log the detail, return
    // our copy.
    reportError(err, { scope: "brandExtract", msg: "guidelines upload failed", shopId });
    return json(
      { ok: false, error: "AI is temporarily unavailable — try again in a moment." },
      { status: 500 },
    );
  }
}

async function handlePreset(
  request: Request,
  shopId: string,
  existingTokens: DesignTokensT,
) {
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
  const updateData = buildShopUpdate(stamped, existingTokens);
  await prisma.shop.update({
    where: { id: shopId },
    data: updateData as never,
  });
  return json({
    ok: true,
    guidelines: stamped,
    brandTokens: updateData.brandTokens ?? existingTokens,
  });
}
