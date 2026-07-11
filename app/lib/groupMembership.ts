// P3 Edit 2 (§16) / §J1 — group membership: the mixed-source criteria for a
// Groups & Personas group, its optional persona layer, and the pure union-
// resolution used by BOTH the wizard's live preview (client) and the create
// action (server). Client-safe: no prisma / no node builtins.
//
// NOTE on the invariant: the ".optional() not .default()" rule guards the QUIZ
// doc (dual-model byte-pin). Membership lives on Category.membership (a DB Json
// column, NOT the quiz doc), so array defaults here are input-parsing sugar and
// never touch a legacy quiz doc.
import { z } from "zod";

// §C4/§J1 — optional persona layer (name / description / image).
export const PersonaSchema = z.object({
  name: z.string().trim().max(160).optional(),
  description: z.string().trim().max(2000).optional(),
  // A bad image URL should drop only the image, never the whole persona.
  image: z.string().url().max(2000).nullable().optional().catch(null),
});
export type Persona = z.infer<typeof PersonaSchema>;

// The four Shopify-native sources, mixed freely (§C4). Stored on
// Category.membership alongside the optional persona.
export const MembershipSchema = z.object({
  tags: z.array(z.string()).default([]),
  collections: z.array(z.string()).default([]),
  metafields: z.array(z.string()).default([]),
  manual: z.array(z.string()).default([]),
});
export type Membership = z.infer<typeof MembershipSchema>;

// What actually persists in Category.membership: the criteria + optional persona.
export const StoredMembershipSchema = MembershipSchema.extend({
  persona: PersonaSchema.nullable().optional(),
});
export type StoredMembership = z.infer<typeof StoredMembershipSchema>;

export type ResolvableProduct = {
  id: string;
  tags: string[];
  collectionIds: string[];
  metafieldValues: string[];
};

export function emptyMembership(): Membership {
  return { tags: [], collections: [], metafields: [], manual: [] };
}

export function membershipIsEmpty(m: Membership): boolean {
  return !m.tags.length && !m.collections.length && !m.metafields.length && !m.manual.length;
}

// Defensive parse of a form/JSON-supplied membership into the strict shape.
export function normalizeMembership(x: unknown): Membership {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
  return { tags: arr(o.tags), collections: arr(o.collections), metafields: arr(o.metafields), manual: arr(o.manual) };
}

// Union: a product is IN the group if it matches ANY selected tag / collection /
// metafield condition, OR is hand-picked.
export function resolveMembership(m: Membership, products: ResolvableProduct[]): string[] {
  const tagSet = new Set(m.tags);
  const colSet = new Set(m.collections);
  const metaSet = new Set(m.metafields);
  const manSet = new Set(m.manual);
  const out: string[] = [];
  for (const p of products) {
    if (
      manSet.has(p.id) ||
      p.tags.some((t) => tagSet.has(t)) ||
      p.collectionIds.some((c) => colSet.has(c)) ||
      p.metafieldValues.some((v) => metaSet.has(v))
    ) {
      out.push(p.id);
    }
  }
  return out;
}

// Dominant source (for the Category.source enum + the accent), by priority.
export function dominantSource(m: Membership): "tag" | "collection" | "metafield" | "manual" {
  if (m.tags.length) return "tag";
  if (m.collections.length) return "collection";
  if (m.metafields.length) return "metafield";
  return "manual";
}
