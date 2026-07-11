import { useState } from "react";
import type { ResolvedEngagement } from "../../../lib/engagementSchema";

// §M3/§L L3 — the shopper-facing reward reveal. Renders only when the merchant
// enabled a reward (gated at the call site). Claims a SINGLE-USE code from
// /reward (the server picks the value + mints the Shopify discount). When the
// reward is the capture incentive (emailGated), the reveal collects the email.
// Degrades silently to nothing when no reward is available (disabled server-side
// or a standalone workspace with no Shopify) so the result never shows a dead UI.

type Reward = { code: string; type?: string; value?: number; expires_at?: string | null };

function rewardLabel(r: Reward): string {
  if (r.type === "free_shipping") return "Free shipping";
  if (r.type === "fixed") return `${r.value ?? ""} off your order`;
  return `${r.value ?? ""}% off`;
}

export function RewardReveal({
  config,
  quizId,
  sessionId,
  presetEmail,
}: {
  config: ResolvedEngagement["reward"];
  quizId: string;
  sessionId: string;
  presetEmail?: string;
}) {
  const emailGated = config.emailGated !== false;
  const [state, setState] = useState<"idle" | "loading" | "revealed" | "hidden" | "exhausted">("idle");
  const [email, setEmail] = useState(presetEmail ?? "");
  const [reward, setReward] = useState<Reward | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const emailValid = /^\S+@\S+\.\S+$/.test(email);

  const claim = async () => {
    setState("loading");
    setErr(null);
    try {
      const res = await fetch("/reward", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quiz_id: quizId, session_id: sessionId, ...(email ? { email } : {}) }),
      });
      const data = (await res.json()) as { reward?: Reward | null; error?: string; reason?: string };
      if (data.reward) {
        setReward(data.reward);
        setState("revealed");
      } else if (data.error === "email required") {
        setState("idle");
        setErr("Enter your email to unlock your reward.");
      } else if (data.reason === "exhausted") {
        // Build-tab §10 — the reward is fully claimed. Show a message instead of
        // a blank/vanishing block so the shopper isn't left with a dead button.
        setState("exhausted");
      } else {
        // reward:null (disabled / no_shopify) or an error — hide silently.
        setState("hidden");
      }
    } catch {
      setState("idle");
      setErr("Couldn't load your reward — please try again.");
    }
  };

  if (state === "hidden") return null;

  if (state === "exhausted") {
    return (
      <div className="qz-reward qz-reward-done" role="status">
        <p className="qz-reward-note">
          {config.fallbackText?.trim() || "This reward has been fully claimed — thanks for playing!"}
        </p>
      </div>
    );
  }

  if (state === "revealed" && reward) {
    return (
      <div className="qz-reward qz-reward-done" role="status">
        <div className="qz-reward-label">🎉 {rewardLabel(reward)}</div>
        <div className="qz-reward-code">{reward.code}</div>
        <p className="qz-reward-note">
          Use this code at checkout.
          {reward.expires_at ? " Expires soon." : ""}
        </p>
      </div>
    );
  }

  const revealText = config.reveal === "spin" ? "Spin to win" : "Reveal my reward";
  return (
    <div className="qz-reward">
      <div className="qz-reward-head">🎁 You&rsquo;ve unlocked a reward</div>
      {emailGated ? (
        <input
          className="qz-reward-email"
          type="email"
          placeholder="you@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="Email to unlock your reward"
        />
      ) : null}
      {err ? <span className="qz-reward-err">{err}</span> : null}
      <button
        type="button"
        className="qz-reward-btn"
        disabled={state === "loading" || (emailGated && !emailValid)}
        onClick={claim}
      >
        {state === "loading" ? "Unlocking…" : revealText}
      </button>
    </div>
  );
}
