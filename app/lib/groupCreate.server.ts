import prisma from "../db.server";
import {
  MembershipSchema,
  PersonaSchema,
  dominantSource,
  metafieldValuesOf,
  resolveMembership,
  type Membership,
  type Persona,
  type ResolvableProduct,
  type StoredMembership,
} from "./groupMembership";

// ════════════════════════════════════════════════════════════════════════════
// Step-1 tweaks (§03 Custom tab) — the ONE create action for a shop-global
// group. The /studio/groups page and the funnel's "New group" wizard both call
// this, so a group made in either place shows up in the other immediately.
// Membership is resolved server-side from the live catalog (the client only
// ever sends WHICH criteria — the persistConfirmedGroups trust boundary).
// ════════════════════════════════════════════════════════════════════════════

export interface CreateGroupInput {
  name: string;
  description: string;
  /** The raw (JSON-parsed) membership + persona from the wizard form. */
  membership: unknown;
  persona: unknown;
}

function parseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** The wizard's form fields → CreateGroupInput (both entry points post the
 *  same field names: name, description, membership, persona). */
export function groupInputFromForm(form: FormData): CreateGroupInput {
  return {
    name: String(form.get("name") ?? "").trim() || "New group",
    description: String(form.get("description") ?? "").trim(),
    membership: parseJson(String(form.get("membership") ?? "{}")) ?? {},
    persona: (() => {
      const raw = String(form.get("persona") ?? "");
      return raw ? parseJson(raw) : null;
    })(),
  };
}

export async function createShopGroup(
  shopId: string,
  input: CreateGroupInput,
): Promise<{ id: string; name: string; tags: string[]; productIds: string[] }> {
  // Zod boundary: validate the submitted membership + persona (§ invariant).
  const memParsed = MembershipSchema.safeParse(input.membership);
  const membership: Membership = memParsed.success ? memParsed.data : MembershipSchema.parse({});
  const personaParsed = input.persona ? PersonaSchema.safeParse(input.persona) : null;
  const persona: Persona | null = personaParsed?.success ? personaParsed.data : null;

  const products = await prisma.product.findMany({
    where: { shopId },
    select: { productId: true, tags: true, collectionIds: true, metafields: true },
  });
  const resolvable: ResolvableProduct[] = products.map((p) => ({
    id: p.productId,
    tags: p.tags,
    collectionIds: p.collectionIds,
    metafieldValues: metafieldValuesOf(p.metafields),
  }));
  const productIds = resolveMembership(membership, resolvable);
  const stored: StoredMembership = { ...membership, persona };

  const created = await prisma.category.create({
    data: {
      shopId,
      quizId: null,
      name: input.name,
      description: input.description,
      tags: membership.tags,
      productIds,
      source: dominantSource(membership),
      sourceRef: null,
      manualProductIds: membership.manual,
      membership: stored as never,
      discoveryRunId: `manual-${Date.now().toString(36)}`,
      rationale: null,
    },
    select: { id: true, name: true, tags: true, productIds: true },
  });
  return created;
}
