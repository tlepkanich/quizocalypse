// §L L3 / §M3/M6 — server-side reward VALUE selection. Deterministic by seed
// (the sessionId) so a shopper gets ONE stable reward (anti-abuse, E1) and the
// value is NEVER client-trusted (§L3 "the value is decided server-side"). For a
// mystery range, "equal" odds = uniform; "weighted" biases toward the low
// (merchant-favorable) end. Pure + client-safe (also used by the settings
// preview). The actual single-use Shopify discount is created by the /reward
// endpoint using this value.

export interface RewardOdds {
  value?: number; // fixed value / range min
  rangeMax?: number; // present → mystery range
  odds?: "equal" | "weighted";
}

// FNV-1a → [0,1). Stable across runs for a given seed (no Math.random).
function hashUnit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0x100000000;
}

export function pickRewardValue(reward: RewardOdds, seed: string): number {
  const min = reward.value ?? 0;
  const max = reward.rangeMax ?? min;
  if (max <= min) return min; // fixed reward
  let r = hashUnit(seed);
  if (reward.odds === "weighted") r = r * r; // bias toward min
  return Math.round(min + r * (max - min));
}
