import prisma from "../db.server";
import { RichTemplateOption, type RichTemplateOption as RichTemplateOptionT } from "./quizSchema";

// Step 2 — persistence for merchant-saved "battle card" templates (a serialized
// RichTemplateOption reusable on a future quiz). Reads parse-gate through the Zod
// so a schema evolution never crashes the funnel — a bad row is simply skipped.

export async function saveTemplate(
  shopId: string,
  name: string,
  template: RichTemplateOptionT,
): Promise<string> {
  const row = await prisma.savedTemplate.create({
    data: {
      shopId,
      name: name.trim().slice(0, 120) || "Saved template",
      payload: template as never,
    },
    select: { id: true },
  });
  return row.id;
}

export interface SavedTemplateRow {
  id: string;
  name: string;
  createdAt: string;
  template: RichTemplateOptionT;
}

export async function listSavedTemplates(shopId: string): Promise<SavedTemplateRow[]> {
  const rows = await prisma.savedTemplate.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
  });
  const out: SavedTemplateRow[] = [];
  for (const r of rows) {
    const parsed = RichTemplateOption.safeParse(r.payload);
    if (parsed.success) {
      out.push({ id: r.id, name: r.name, createdAt: r.createdAt.toISOString(), template: parsed.data });
    }
  }
  return out;
}

export async function loadSavedTemplate(
  shopId: string,
  templateId: string,
): Promise<RichTemplateOptionT | null> {
  const row = await prisma.savedTemplate.findFirst({ where: { id: templateId, shopId } });
  if (!row) return null;
  const parsed = RichTemplateOption.safeParse(row.payload);
  return parsed.success ? parsed.data : null;
}

export async function deleteSavedTemplate(shopId: string, templateId: string): Promise<void> {
  await prisma.savedTemplate.deleteMany({ where: { id: templateId, shopId } });
}
