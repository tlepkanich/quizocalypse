import type { Quiz } from "../../../lib/quizSchema";
import { orderedFlowSteps } from "../../../lib/questionOrder";
export const EMAIL_SCREEN = "__email";
export const OVERVIEW_SCREEN = "__overview";
export const COVER_SCREEN = "__cover";
export const walkSteps = (doc: Quiz) => orderedFlowSteps(doc);
export function unreadCopy(labels: string[]): string {
  const shown = labels.slice(0, 4);
  const more = labels.length - shown.length;
  if (more) return `${shown.join(", ")} and ${more} more`;
  if (shown.length < 2) return shown[0] ?? "";
  return `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
}
