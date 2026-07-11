import { useRef, useState } from "react";
import { Form } from "@remix-run/react";
import { resolveEngagement, type EngagementSettingsT } from "../../lib/engagementSchema";

// §L Layer 2 — the per-quiz Engagement control panel (matches
// quizocalypse-engagement-settings.html). Holds the full engagement object in
// state, edits it, and submits it as JSON. Tasteful sections default ON; loud
// ones (reward, urgency) carry the conversion/brand warning. Effective values
// shown = resolveEngagement(quiz, account); edits write per-quiz overrides.
type Section = keyof EngagementSettingsT;

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      className={`qz-eng-tg${on ? " is-on" : ""}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
    >
      <span className="qz-eng-knob" aria-hidden />
    </button>
  );
}

export function EngagementSettingsPanel({
  initial,
  accountDefaults,
}: {
  initial: EngagementSettingsT;
  accountDefaults?: EngagementSettingsT | null;
}) {
  const [eng, setEng] = useState<EngagementSettingsT>(initial);
  const formRef = useRef<HTMLFormElement>(null);
  const eff = resolveEngagement(eng, accountDefaults);

  // Patch one section (shallow) and re-render.
  const patch = <S extends Section>(section: S, fields: NonNullable<EngagementSettingsT[S]>) =>
    setEng((e) => ({ ...e, [section]: { ...(e[section] ?? {}), ...fields } }));

  const save = () => formRef.current?.requestSubmit();

  return (
    <>
      <Form method="post" ref={formRef} style={{ display: "none" }}>
        <input type="hidden" name="intent" value="save-engagement" />
        <input type="hidden" name="engagement" value={JSON.stringify(eng)} />
      </Form>

      <div className="qz-row" style={{ marginBottom: 18 }}>
        <div>
          <div className="qz-label">Quiz builder</div>
          <h1 className="qz-display" style={{ fontSize: 26, margin: "4px 0 4px" }}>Engagement</h1>
          <p className="qz-muted" style={{ margin: 0, fontSize: 14, maxWidth: 560 }}>
            Mechanics that lift completion, capture, and conversion. Tasteful defaults on; loud ones opt-in and
            measurable via Analytics.
          </p>
        </div>
        <span style={{ marginLeft: "auto" }} />
        <button type="button" className="qz-btn qz-btn-primary" onClick={save}>Save</button>
      </div>

      {/* Interstitial */}
      <Sec title="Results interstitial" tone="on" desc="“Calculating your results…” before the reveal"
        on={eff.interstitial.enabled} onToggle={(v) => patch("interstitial", { enabled: v })}>
        <Field label="Delay" hint={`${((eff.interstitial.delayMs ?? 2500) / 1000).toFixed(1)}s`}>
          <input type="range" min={1000} max={4000} step={100} value={eff.interstitial.delayMs}
            onChange={(e) => patch("interstitial", { delayMs: Number(e.target.value) })} />
        </Field>
        <Seg label="Style" options={["spinner", "progress", "stepped"]} value={eff.interstitial.style}
          onChange={(v) => patch("interstitial", { style: v as "spinner" | "progress" | "stepped" })} />
        <Field label="Headline">
          <input className="qz-input" value={eff.interstitial.headline}
            onChange={(e) => patch("interstitial", { headline: e.target.value })} />
        </Field>
      </Sec>

      {/* Feedback */}
      <Sec title="Feedback" tone="on" desc="“Was this helpful?” on the result"
        on={eff.feedback.enabled} onToggle={(v) => patch("feedback", { enabled: v })}>
        <Seg label="Type" options={["thumbs", "stars"]} value={eff.feedback.type}
          onChange={(v) => patch("feedback", { type: v as "thumbs" | "stars" })} />
        <Subrow label="Ask for a written comment" on={eff.feedback.openText}
          onToggle={(v) => patch("feedback", { openText: v })} />
        <Field label="Prompt">
          <input className="qz-input" value={eff.feedback.prompt}
            onChange={(e) => patch("feedback", { prompt: e.target.value })} />
        </Field>
      </Sec>

      {/* Reward — loud */}
      <Sec title="Mystery / spin discount" tone="loud" desc="A reward unlocked at the end"
        on={eff.reward.enabled} onToggle={(v) => patch("reward", { enabled: v })}>
        <p className="qz-eng-warn">⚠ Loud effect — can lift or hurt conversion. Measure the impact in Analytics.</p>
        <Seg label="Reward type" options={["percentage", "fixed", "free_shipping"]} value={eff.reward.type}
          onChange={(v) => patch("reward", { type: v as "percentage" | "fixed" | "free_shipping" })} />
        <div className="qz-row" style={{ gap: 8, alignItems: "center" }}>
          <Field label="Value / range min">
            <input className="qz-input" type="number" value={eff.reward.value ?? ""} placeholder="10"
              onChange={(e) => patch("reward", { value: e.target.value ? Number(e.target.value) : undefined })} />
          </Field>
          <Field label="Range max (mystery)">
            <input className="qz-input" type="number" value={eng.reward?.rangeMax ?? ""} placeholder="20"
              onChange={(e) => patch("reward", { rangeMax: e.target.value ? Number(e.target.value) : undefined })} />
          </Field>
          <Field label="Expires (hours)">
            <input className="qz-input" type="number" value={eff.reward.expiryHours}
              onChange={(e) => patch("reward", { expiryHours: Number(e.target.value) || 24 })} />
          </Field>
          <Field label="Total code cap (optional)">
            <input className="qz-input" type="number" min={1} value={eng.reward?.usageCap ?? ""} placeholder="∞"
              onChange={(e) => patch("reward", { usageCap: e.target.value ? Math.max(1, Math.floor(Number(e.target.value))) : undefined })} />
          </Field>
        </div>
        <Field label="When fully claimed, show (optional)">
          <input className="qz-input" maxLength={200} value={eng.reward?.fallbackText ?? ""}
            placeholder="This reward has been fully claimed — thanks for playing!"
            onChange={(e) => patch("reward", { fallbackText: e.target.value || undefined })} />
        </Field>
        <Subrow label="Email-gated (the reward is the capture incentive)" on={eff.reward.emailGated ?? true}
          onToggle={(v) => patch("reward", { emailGated: v })} />
      </Sec>

      {/* Social proof */}
      <Sec title="Social proof" tone="on" desc="“N shoppers matched” · popularity · stars"
        on={eff.socialProof.matchedCount || eff.socialProof.popularMatch || eff.socialProof.reviewStars}
        onToggle={(v) => patch("socialProof", { matchedCount: v })}>
        <Subrow label={`“N shoppers matched here” · hide below ${eff.socialProof.threshold ?? 50}`}
          on={eff.socialProof.matchedCount} onToggle={(v) => patch("socialProof", { matchedCount: v })} />
        <Subrow label="“Most popular match” badge" on={eff.socialProof.popularMatch}
          onToggle={(v) => patch("socialProof", { popularMatch: v })} />
        <Subrow label="Review stars ★ (needs a reviews app)" on={eff.socialProof.reviewStars}
          disabled={!eff.socialProof.reviewSource} onToggle={(v) => patch("socialProof", { reviewStars: v })} />
      </Sec>

      {/* Share */}
      <Sec title="Share result" tone="on" desc="virality + social proof"
        on={eff.share.enabled} onToggle={(v) => patch("share", { enabled: v })}>
        <Chipset label="Channels" options={["copy", "x", "facebook", "ig_story"]} value={eff.share.channels ?? []}
          onChange={(chs) => patch("share", { channels: chs as Array<"copy" | "x" | "facebook" | "ig_story"> })} />
      </Sec>

      {/* Urgency — loud/real-only */}
      <Sec title="Urgency" tone="loud" desc="low-stock · expiring discount (real only)"
        on={eff.urgency.lowStock || eff.urgency.countdown} onToggle={(v) => patch("urgency", { lowStock: v })}>
        <Subrow label={`“Only X left” from live inventory · show when ≤ ${eff.urgency.lowStockThreshold ?? 5}`}
          on={eff.urgency.lowStock} onToggle={(v) => patch("urgency", { lowStock: v })} />
        <Subrow label="Expiring-discount countdown (uses the reward's real expiry)" on={eff.urgency.countdown}
          onToggle={(v) => patch("urgency", { countdown: v })} />
      </Sec>

      {/* Email flows */}
      <Sec title="Email flows" tone="on" desc="recap · reminder · abandoned-quiz"
        on={eff.emailFlows.recap || eff.emailFlows.reminder || eff.emailFlows.abandoned}
        onToggle={(v) => patch("emailFlows", { recap: v })}>
        <Subrow label="Result recap" on={eff.emailFlows.recap} onToggle={(v) => patch("emailFlows", { recap: v })} />
        <Subrow label={`Discount reminder · T+${eff.emailFlows.reminderHours ?? 24}h`} on={eff.emailFlows.reminder}
          onToggle={(v) => patch("emailFlows", { reminder: v })} />
        <Subrow label={`Abandoned quiz · T+${eff.emailFlows.abandonedHours ?? 1}h (needs email captured)`}
          on={eff.emailFlows.abandoned} onToggle={(v) => patch("emailFlows", { abandoned: v })} />
      </Sec>

      <p className="qz-muted" style={{ fontSize: 12.5, marginTop: 20 }}>
        Settings bake into the quiz at publish — <strong>republish</strong> for changes to reach shoppers.
      </p>
    </>
  );

  // Local UI atoms (co-located to keep the panel one file).
  function Sec({ title, desc, tone, on, onToggle, children }: {
    title: string; desc: string; tone: "on" | "loud"; on: boolean; onToggle: (v: boolean) => void; children: React.ReactNode;
  }) {
    return (
      <div className={`qz-eng-sec${tone === "loud" ? " is-loud" : ""}`}>
        <div className="qz-eng-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="qz-eng-name">
              {title}{" "}
              <span className={`qz-eng-chip${tone === "loud" ? " is-opt" : ""}`}>{tone === "loud" ? "Opt-in" : "Default on"}</span>
            </div>
            <div className="qz-dim" style={{ fontSize: 12.5 }}>{desc}</div>
          </div>
          <Toggle on={on} onChange={onToggle} label={title} />
        </div>
        {on ? <div className="qz-eng-body">{children}</div> : null}
      </div>
    );
  }
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="qz-eng-fld">
      <div className="qz-eng-lab"><span>{label}</span>{hint ? <span className="qz-dim">{hint}</span> : null}</div>
      {children}
    </div>
  );
}

function Seg<T extends string>({ label, options, value, onChange }: { label: string; options: T[]; value: T; onChange: (v: T) => void }) {
  return (
    <Field label={label}>
      <div className="qz-segmented" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o} type="button" aria-pressed={o === value} onClick={() => onChange(o)}>
            {o.replace(/_/g, " ")}
          </button>
        ))}
      </div>
    </Field>
  );
}

function Chipset({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (o: string) => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
  return (
    <Field label={label}>
      <div className="qz-row" style={{ gap: 6, flexWrap: "wrap" }}>
        {options.map((o) => (
          <button key={o} type="button" className={`qz-eng-chipbtn${value.includes(o) ? " is-on" : ""}`} onClick={() => toggle(o)}>
            {o.replace(/_/g, " ")}
          </button>
        ))}
      </div>
    </Field>
  );
}

function Subrow({ label, on, onToggle, disabled }: { label: string; on: boolean; onToggle: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="qz-eng-subrow" style={disabled ? { opacity: 0.5 } : undefined}>
      <span style={{ fontSize: 13 }}>{label}</span>
      <span style={{ marginLeft: "auto" }} />
      <Toggle on={on && !disabled} onChange={(v) => !disabled && onToggle(v)} label={label} />
    </div>
  );
}
