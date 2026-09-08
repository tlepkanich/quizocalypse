import type { ResolvedRecPageConfig } from "./recommendDecider";
export function captureMode(
  config: ResolvedRecPageConfig,
): "gate" | "inline" | "none" {
  if (
    config.captureInlineOn === true &&
    config.capturePlacement === "inline" &&
    config.captureEmail
  )
    return "inline";
  return config.captureEmail || config.captureName || config.capturePhone
    ? "gate"
    : "none";
}
