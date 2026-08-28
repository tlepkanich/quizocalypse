/* The wiskr fox — the brand mark (BRAND-3, the 2026-08 rebrand: one purple
   fox replaces both the rust fox tile and the Quartz cat). Inline fills only,
   no stylesheet dependency, so it renders identically in the admin chrome AND
   the shopper runtime badge (which loads only quiz-runtime.css). Decorative by
   default; the parent carries the accessible label.
   `detailed` renders the full faceted art (ear folds, head facets, six
   whiskers) — legible ≥36px. Below that the simplified cut (single-tone head,
   two bold whiskers a side) reads better; /favicon.svg and /wiskr-fox.svg
   carry the same simplified geometry. */

export const FOX_PURPLE = "#7C3AED"; // primary brand purple
export const FOX_INK = "#2E1065"; // eyes / nose / whiskers / logotype ink
const EAR = "#8B5CF6";
const EAR_SHADE = "#7443E0";
const EAR_INNER = "#4C1D95";
const HEAD_L = "#8657E8";
const HEAD_R = "#7A3BEC";
const CHEEK = "#E9E1FB";
const CHEEK_SHADE = "#DFD3F8";
const CREAM = "#F3EFFB";

export function FoxMark({
  size = 20,
  variant = "color",
  detailed = false,
  feature: featureOverride,
}: {
  size?: number;
  /** "color" = purple fox for light grounds; "cream" = pale fox for dark/colored tiles. */
  variant?: "color" | "cream";
  detailed?: boolean;
  /** Overrides the eye/nose/whisker color — pass the tile's own background
      (e.g. "var(--qz-accent)") for the punched-out one-color treatment. */
  feature?: string;
}) {
  const cream = variant === "cream";
  const feature = featureOverride ?? (cream ? FOX_PURPLE : FOX_INK);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      aria-hidden="true"
      focusable="false"
      style={{ display: "block", flex: "none" }}
    >
      {detailed ? (
        <>
          <g fill="none" stroke={feature} strokeWidth={9} strokeLinecap="round">
            <path d="M196 370 C142 350 84 342 26 350" />
            <path d="M192 398 C138 394 76 402 20 426" />
            <path d="M198 426 C152 436 108 458 74 492" />
            <path d="M316 370 C370 350 428 342 486 350" />
            <path d="M320 398 C374 394 436 402 492 426" />
            <path d="M314 426 C360 436 404 458 438 492" />
          </g>
          <path d="M92 236 L142 40 L252 152 L150 216 Z" fill={cream ? CREAM : EAR} />
          <path d="M420 236 L370 40 L260 152 L362 216 Z" fill={cream ? CREAM : EAR} />
          {cream ? null : (
            <>
              <path d="M142 40 L252 152 L192 126 Z" fill={EAR_SHADE} />
              <path d="M150 216 L224 162 L252 152 L182 224 Z" fill={EAR_INNER} />
              <path d="M370 40 L260 152 L320 126 Z" fill={EAR_SHADE} />
              <path d="M362 216 L288 162 L260 152 L330 224 Z" fill={EAR_INNER} />
            </>
          )}
          <path d="M256 146 L120 186 L76 290 L178 396 L256 462 Z" fill={cream ? CREAM : HEAD_L} />
          <path d="M256 146 L392 186 L436 290 L334 396 L256 462 Z" fill={cream ? CREAM : HEAD_R} />
          {cream ? null : (
            <>
              <path d="M83 306 L178 396 L256 462 L214 396 Z" fill={CHEEK} />
              <path d="M429 306 L334 396 L256 462 L298 396 Z" fill={CHEEK_SHADE} />
            </>
          )}
          <path
            d="M122 308 C138 268 196 264 228 296 C206 276 152 280 122 308 Z"
            fill={feature}
            stroke={feature}
            strokeWidth={7}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <path
            d="M390 308 C374 268 316 264 284 296 C306 276 360 280 390 308 Z"
            fill={feature}
            stroke={feature}
            strokeWidth={7}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <path
            d="M256 436 C241 422 228 407 228 396 C228 385 240 379 256 379 C272 379 284 385 284 396 C284 407 271 422 256 436 Z"
            fill={feature}
          />
        </>
      ) : (
        <>
          <g fill="none" stroke={feature} strokeWidth={24} strokeLinecap="round">
            <path d="M198 372 C148 354 92 346 34 354" />
            <path d="M200 420 C154 428 108 448 72 480" />
            <path d="M314 372 C364 354 420 346 478 354" />
            <path d="M312 420 C358 428 404 448 440 480" />
          </g>
          <path d="M80 238 L144 34 L266 150 Z" fill={cream ? CREAM : FOX_PURPLE} />
          <path d="M432 238 L368 34 L246 150 Z" fill={cream ? CREAM : FOX_PURPLE} />
          <path
            d="M256 142 L110 186 L70 296 L180 402 L256 468 L332 402 L442 296 L398 186 Z"
            fill={cream ? CREAM : FOX_PURPLE}
          />
          {cream ? null : (
            <>
              <path d="M70 296 L180 402 L256 468 L208 390 Z" fill={CHEEK} />
              <path d="M442 296 L332 402 L256 468 L304 390 Z" fill={CHEEK_SHADE} />
            </>
          )}
          <path
            d="M112 310 C130 262 198 258 234 296 C208 272 146 278 122 314 Z"
            fill={feature}
            stroke={feature}
            strokeWidth={16}
            strokeLinejoin="round"
          />
          <path
            d="M400 310 C382 262 314 258 278 296 C304 272 366 278 390 314 Z"
            fill={feature}
            stroke={feature}
            strokeWidth={16}
            strokeLinejoin="round"
          />
          <path
            d="M256 444 C238 428 224 410 224 397 C224 384 238 378 256 378 C274 378 288 384 288 397 C288 410 274 428 256 444 Z"
            fill={feature}
          />
        </>
      )}
    </svg>
  );
}
