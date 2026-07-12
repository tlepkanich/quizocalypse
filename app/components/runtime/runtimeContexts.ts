import { createContext } from "react";
import type { QuizPlatform } from "../../lib/productHref";

// ════════════════════════════════════════════════════════════════════════════
// Runtime contexts — the import seams between the QuizRuntime shell (which
// provides them) and the extracted views/bits (which consume them). Moved
// verbatim from QuizRuntime.tsx in the BIC-2 C1 decomposition; ONE definition
// each so provider/consumer pairing can never split across module copies.
// ════════════════════════════════════════════════════════════════════════════

// Preview mode flag shared with the deep leaf views (cart / email-capture /
// integration / ai-chat) so they can no-op their side-effects without threading
// a prop through every intermediate component. Default false = live.
export const RuntimePreviewContext = createContext(false);
// K2 — the resolved serving locale ("en" default). Consumed by the
// save-results link (locale-sticky URLs) and the AskAI POST (reply language).
export const RuntimeLocaleContext = createContext("en");
// The shop's ISO 4217 currency (baked into the published doc at publish time;
// "USD" default for pre-existing quizzes). Deep product-card leaves read it via
// context (same seam as locale) to format prices with the right symbol +
// decimals (¥886, not "$886") without threading a prop through every component.
export const RuntimeCurrencyContext = createContext("USD");
// QD-7 — the commerce platform ("shopify" default). The deep product-card
// leaves read this (same pattern as the preview/locale contexts) to decide
// PDP href + cart vs "Shop now", without threading a prop through every
// intermediate result/preview component. `productHref` (pure, lib) centralizes
// the link rule both platforms share.
export const RuntimePlatformContext = createContext<QuizPlatform>("shopify");
// MQ — the resolved shopper-runtime CHROME. "classic" = today's card + pill-trail
// + auto-advance; "minimal" = the Quizell-style top bar + card-less grey-chip
// question + Back/Next + vertical result. Resolved once at the root from the
// quiz's `chrome` token, defaulting by platform (standalone → minimal). Deep views
// read it via context (same seam as platform/preview/locale) — no prop drilling.
export type ChromeVariant = "classic" | "minimal";
export const RuntimeChromeContext = createContext<ChromeVariant>("classic");
// Generated campaign id. Null for every pre-art-direction document, keeping
// deep result views unaware of the feature unless a new build opts in.
export const RuntimeArtDirectionContext = createContext<string | null>(null);
// R6 (Rec-Page §2) — the quiz-level PERCENTAGE that ProductCard may render as a
// struck original + accent discounted price. Set only for an unconditional
// percentage discount (kind=percentage · applies_to=all · no minimums); null for
// fixed/free-shipping/conditional discounts (those keep the badge-only display).
// The PER-RESULT gate stays on the card's `discountLabel` prop (which is set iff
// that node's include_discount + the live code resolve), so the strikethrough
// only shows when BOTH the node opts in AND the discount is percentage-eligible.
export const RuntimeDiscountContext = createContext<number | null>(null);
