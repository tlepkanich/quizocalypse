import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useNavigation } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { buildSeedQuiz } from "../lib/seedQuiz";
import { parseBrandIdentitySafe } from "../lib/brandIdentity";
import { brandSeedTokens } from "../lib/brandSeed";
import { QzPage, QzPageHeader, QzCard, QzButton, QzField, QzInput } from "../components/qz";

// Minimal "New quiz" — seeds a draft and drops the merchant straight into the
// Studio builder (Step 1, Products). Everything else (AI generation, page
// model, design) now lives inside Studio.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return json({});
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim().slice(0, 120) || "Untitled quiz";

  // DGN-1 — a brand-new manual quiz gets the shop's brand look too (no
  // byte-identity concern on a fresh doc). Absent identity → null → house theme.
  const brandTokens = brandSeedTokens(parseBrandIdentitySafe(shop.brandIdentity));
  const seed = buildSeedQuiz(name);

  const quiz = await prisma.quiz.create({
    data: {
      shopId: shop.id,
      name,
      status: "draft",
      draftJson: {
        ...seed,
        ...(brandTokens ? { design_tokens: brandTokens } : {}),
      } as never,
    },
  });

  return redirect(`/app/quizzes/${quiz.id}/studio?step=1`);
};

export default function NewQuiz() {
  const nav = useNavigation();
  const creating = nav.state !== "idle";
  return (
    <QzPage>
      <TitleBar title="New quiz" />
      <QzPageHeader
        eyebrow="New quiz"
        title="Create a quiz"
        subtitle="Name it to get started — you'll group products, pick a layout, and build (manually or with AI) inside the builder."
      />
      <QzCard style={{ maxWidth: 520, padding: 24 }}>
        <Form method="post" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <QzField label="Quiz name" hint="You can rename it any time in the builder.">
            <QzInput name="name" placeholder="e.g. Find your skincare routine" autoFocus />
          </QzField>
          <div>
            <QzButton type="submit" variant="primary" disabled={creating}>
              {creating ? "Creating…" : "Create quiz →"}
            </QzButton>
          </div>
        </Form>
      </QzCard>
    </QzPage>
  );
}
