import { z } from "zod";

// Wire shape for one auto-discovered category — Claude's tool output and
// the row written to prisma.category (minus the relational/timestamp
// columns Prisma manages).

export const DiscoveredCategory = z.object({
  name: z.string().min(1).max(60),
  description: z.string().min(1).max(280),
  // Embodying tags pulled from the catalog vocabulary. Used by
  // categoryAssign to bucket every product via tag overlap. Cap at 10
  // so the prompt stays focused and the assignment step doesn't blow up.
  tags: z.array(z.string().min(1)).min(2).max(10),
  rationale: z.string().min(1).max(200),
});
export type DiscoveredCategory = z.infer<typeof DiscoveredCategory>;

export const DiscoveryResult = z.object({
  categories: z.array(DiscoveredCategory).min(3).max(12),
});
export type DiscoveryResult = z.infer<typeof DiscoveryResult>;
