import prisma from "../db.server";

// HOME-3 — the teal signal (first-run handoff §7.5): captured emails with
// nowhere to go. ONE source for both places it shows — Home's "Send your
// captured emails somewhere" row and the dot on Integrations in the studio
// rail — so the two can never disagree.
//
// "Somewhere" = any quiz of the shop has an integration node with at least
// one action. One EXISTS query over the stored docs (no per-quiz parse), so
// the rail can afford it on every studio page.

export interface EmailSignal {
  /** Every captured email for the shop. */
  captured: number;
  /** Captured emails with no destination wired (0 when one is). */
  waiting: number;
}

export function emailSignalFrom(captured: number, hasDestination: boolean): EmailSignal {
  return { captured, waiting: hasDestination ? 0 : captured };
}

async function hasEmailDestination(shopId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ has: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM "Quiz" q
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(q."draftJson"->'nodes') = 'array'
             THEN q."draftJson"->'nodes' ELSE '[]'::jsonb END
      ) AS n
      WHERE q."shopId" = ${shopId}
        AND n->>'type' = 'integration'
        AND jsonb_typeof(n->'data'->'actions') = 'array'
        AND jsonb_array_length(n->'data'->'actions') > 0
    ) AS "has"`;
  return rows[0]?.has === true;
}

export async function emailSignalForShop(shopId: string): Promise<EmailSignal> {
  const captured = await prisma.emailCapture.count({ where: { quiz: { shopId } } });
  // No captures → nothing can be waiting; skip the doc scan.
  if (captured === 0) return emailSignalFrom(0, false);
  return emailSignalFrom(captured, await hasEmailDestination(shopId));
}
