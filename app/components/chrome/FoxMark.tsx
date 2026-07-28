/* The wiskr fox — the brand mark (BRAND-2). Inline fills only, no stylesheet
   dependency, so it renders identically in the admin chrome AND the shopper
   runtime badge (which loads only quiz-runtime.css). Decorative by default;
   the parent carries the accessible label.
   `detailed` adds inner ears, whiskers and the w-mouth — legible ≥36px.
   Below that the simplified cut (ears + blaze + eyes + nose) reads better. */

const HEAD =
  "M18 6 L34 25 Q48 20 62 25 L78 6 Q87 19 86.5 33 Q86 49 77 61 " +
  "Q65 77 48 87 Q31 77 19 61 Q10 49 9.5 33 Q9 19 18 6 Z";
const BLAZE =
  "M48 50 Q62 50 63 63 Q63.5 74 48 85 Q32.5 74 33 63 Q34 50 48 50 Z";
const BLAZE_DETAILED =
  "M48 52 Q61 52 62 64 Q62.5 75 48 84.5 Q33.5 75 34 64 Q35 52 48 52 Z";
const NOSE =
  "M42.5 62 C44.5 60.5 51.5 60.5 53.5 62 C53 66.5 50.8 68.8 48 70 " +
  "C45.2 68.8 43 66.5 42.5 62 Z";

export function FoxMark({
  size = 20,
  variant = "color",
  detailed = false,
  feature: featureOverride,
}: {
  size?: number;
  /** "color" = rust fox for light grounds; "cream" = cream fox for dark/colored tiles. */
  variant?: "color" | "cream";
  detailed?: boolean;
  /** Overrides the eye/nose/whisker color — pass the tile's own background
      (e.g. "var(--qz-accent)") for the punched-out one-color treatment. */
  feature?: string;
}) {
  const head = variant === "cream" ? "#FFF8F0" : "#E8590C";
  const feature = featureOverride ?? (variant === "cream" ? "#E8590C" : "#2A1810");
  const blaze = variant === "cream" ? undefined : "#FFF8F0";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      aria-hidden="true"
      focusable="false"
      style={{ display: "block", flex: "none" }}
    >
      <path fill={head} d={HEAD} />
      {detailed ? (
        <>
          <path fill="#C2410C" d="M21.5 13 L31.5 25.5 Q25 28.5 19 27 Q19.5 19.5 21.5 13 Z" />
          <path fill="#C2410C" d="M74.5 13 L64.5 25.5 Q71 28.5 77 27 Q76.5 19.5 74.5 13 Z" />
        </>
      ) : null}
      {blaze ? <path fill={blaze} d={detailed ? BLAZE_DETAILED : BLAZE} /> : null}
      {detailed ? (
        <g stroke={feature} strokeWidth={2.3} strokeLinecap="round" fill="none" opacity={0.8}>
          <path d="M32 62 Q22 58.5 10 60" />
          <path d="M32.5 67 Q21 66 9 68" />
          <path d="M32 72 Q22 74 11 77" />
          <path d="M64 62 Q74 58.5 86 60" />
          <path d="M63.5 67 Q75 66 87 68" />
          <path d="M64 72 Q74 74 85 77" />
        </g>
      ) : null}
      <g fill={feature}>
        <circle cx={detailed ? 34.5 : 34} cy={detailed ? 43 : 42} r={detailed ? 4 : 5.2} />
        <circle cx={detailed ? 61.5 : 62} cy={detailed ? 43 : 42} r={detailed ? 4 : 5.2} />
      </g>
      <path fill={feature} d={NOSE} />
      {detailed ? (
        <path
          d="M43.5 74.5 Q45.75 77 48 74.5 Q50.25 77 52.5 74.5"
          stroke={feature}
          strokeWidth={2.1}
          strokeLinecap="round"
          fill="none"
        />
      ) : null}
    </svg>
  );
}
