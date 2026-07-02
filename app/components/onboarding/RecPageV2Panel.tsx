import { useEffect, useMemo, useState } from "react";
import type { Quiz as QuizDoc } from "../../lib/quizSchema";
import type { BuilderCategory, BuilderCollection } from "../builder/stepProps";
import {
  setRecPageGlobal,
  setRecPageOverride,
  removeRecPageOverride,
} from "../../lib/quizMutations";
import {
  REC_PAGE_DEFAULTS,
  resolveRecPageGlobal,
  settingsForTarget,
} from "../../lib/recommendDecider";

// rec-page-spec-V2 §2/§3 — the decider-doc Step-4 config surface. ONE global
// config + sparse per-target overrides ("Give this its own page"). The
// selector edits either the global ("All results") or one target; overridden
// targets are flagged ●. Storage stays SPARSE: defaults live in
// REC_PAGE_DEFAULTS at read time, the mutations only persist merchant-set
// fields, and an override that empties out is removed (full inheritance).
// Grid max / OOS / fallbacks are GLOBAL-ONLY by spec (§2.1).

const HERO_SIGNALS = [
  { value: "collection_order", label: "Collection order (your Shopify sort)" },
  { value: "bestseller", label: "Best seller" },
  { value: "reviewed", label: "Highest rated" },
  { value: "newest", label: "Newest" },
] as const;

type Signal = (typeof HERO_SIGNALS)[number]["value"];

export type DiscountCheck =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "valid"; summary: string }
  | { state: "invalid"; reason: string }
  | { state: "unavailable"; reason: string };

export function RecPageV2Panel({
  doc,
  categories,
  collections,
  onCommit,
  selectedTargetId,
  onSelectTarget,
}: {
  doc: QuizDoc;
  categories: BuilderCategory[];
  collections: BuilderCollection[];
  onCommit: (doc: QuizDoc) => void;
  /** null = editing the global ("All results"). */
  selectedTargetId: string | null;
  onSelectTarget: (id: string | null) => void;
}) {
  const settings = doc.rec_page_settings;
  const global = useMemo(() => resolveRecPageGlobal(settings), [settings]);
  const overrides = settings?.overrides ?? {};

  const target = selectedTargetId
    ? categories.find((c) => c.id === selectedTargetId) ?? null
    : null;
  const isProductTarget = target?.source === "product";
  const hasOverride = target ? Boolean(overrides[target.id]) : false;
  // "Give this its own page" can be ON with zero stored fields (sparse storage
  // — nothing diverges yet). Track the open state locally; ● flags STORED ones.
  const [breakoutOpen, setBreakoutOpen] = useState<Record<string, boolean>>({});
  const editingOverride = target ? hasOverride || breakoutOpen[target.id] === true : false;
  const effective = target ? settingsForTarget(settings, target.id) : global;

  const [discount, setDiscount] = useState<DiscountCheck>({ state: "idle" });
  // A ✓/✕ earned by one scope's code must not linger next to another's.
  useEffect(() => setDiscount({ state: "idle" }), [selectedTargetId, editingOverride]);

  const patchGlobal = (patch: Parameters<typeof setRecPageGlobal>[1]) =>
    onCommit(setRecPageGlobal(doc, patch));
  const patchOverride = (patch: Parameters<typeof setRecPageOverride>[2]) => {
    if (target) onCommit(setRecPageOverride(doc, target.id, patch));
  };
  // The active writer: global scope or the selected target's override. TYPED
  // to the §3.2 OVERRIDE subset (review-caught: an untyped dispatcher let a
  // global-only field leak into an override, where Zod's strip-mode silently
  // destroyed it on the autosave round-trip). A non-overridable field is now a
  // compile error here — route it through patchGlobal explicitly.
  const patch = (p: Parameters<typeof setRecPageOverride>[2]) =>
    target && editingOverride ? patchOverride(p) : patchGlobal(p);
  // Text fields: "" is never stored — clearing a field returns it to the
  // read-time default (keeps rec_page_settings root-droppable, and the input's
  // ghosted placeholder then honestly matches what shoppers see).
  const text = (v: string) => v || undefined;

  // §9.3/§10.2 — validate an EXISTING merchant-created discount code on blur.
  const validateCode = async (code: string) => {
    if (!code.trim()) {
      setDiscount({ state: "idle" });
      return;
    }
    setDiscount({ state: "checking" });
    try {
      const res = await fetch("/api/validate-discount", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const body = (await res.json()) as {
        valid: boolean | null;
        active?: boolean;
        summary?: string;
        reason?: string;
      };
      if (body.valid === null) {
        setDiscount({ state: "unavailable", reason: body.reason ?? "Can't validate right now" });
      } else if (body.valid && body.active) {
        setDiscount({ state: "valid", summary: body.summary ?? "Code found and active" });
      } else {
        setDiscount({
          state: "invalid",
          reason: body.reason ?? (body.valid ? "Code exists but is not active" : "Code not found — create it in Shopify Admin first"),
        });
      }
    } catch {
      setDiscount({ state: "unavailable", reason: "Can't validate right now" });
    }
  };

  // A field row helper: shows the effective value; in override mode an
  // "inherits global" hint appears until the field is stored, with ↺ to clear.
  const overrideVal = target ? overrides[target.id] : undefined;
  const isStored = (key: string) =>
    target && editingOverride
      ? overrideVal != null && Object.prototype.hasOwnProperty.call(overrideVal, key)
      : true;

  const inheritHint = (key: string) =>
    target && editingOverride && !isStored(key) ? (
      <span className="qz-rp2-inherit" title="Inherits the global value until you change it">
        inherits global
      </span>
    ) : target && editingOverride ? (
      <button
        type="button"
        className="qz-rp2-clear"
        title="Clear this override — inherit the global value again"
        onClick={() => patchOverride({ [key]: undefined })}
      >
        ↺
      </button>
    ) : null;

  return (
    <div className="qz-rp2">
      {/* §2.2 — the target selector */}
      <label className="qz-rp2-editing">
        <span>Editing:</span>
        <select
          value={selectedTargetId ?? ""}
          onChange={(e) => onSelectTarget(e.target.value || null)}
          aria-label="Pick which result page to edit"
        >
          <option value="">All results (global)</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {overrides[c.id] ? "● " : ""}
              {c.name}
            </option>
          ))}
        </select>
      </label>

      {target ? (
        <label className="qz-rp2-breakout">
          <input
            type="checkbox"
            checked={editingOverride}
            onChange={(e) => {
              if (e.target.checked) {
                setBreakoutOpen((m) => ({ ...m, [target.id]: true }));
              } else {
                setBreakoutOpen((m) => ({ ...m, [target.id]: false }));
                onCommit(removeRecPageOverride(doc, target.id));
              }
            }}
          />
          <span>
            <strong>Give this result its own page</strong>
            <span className="qz-dim" style={{ display: "block", fontSize: 11.5 }}>
              Off = it inherits everything from “All results”. On = override headline, why-copy,
              hero logic, and incentive just for {target.name}.
            </span>
          </span>
        </label>
      ) : null}

      {target && !editingOverride ? (
        <p className="qz-dim" style={{ fontSize: 12.5 }}>
          {target.name} inherits the global page. Flip the toggle above to customise it.
        </p>
      ) : (
        <>
          {/* ── Page copy ── */}
          <div className="qz-rp2-section">Page copy</div>
          <label className="qz-rp2-field">
            <span>Headline {inheritHint("headline")}</span>
            <input
              value={effective.headline}
              placeholder={REC_PAGE_DEFAULTS.headline}
              onChange={(e) => patch({ headline: text(e.target.value) })}
            />
          </label>
          <label className="qz-rp2-field qz-rp2-check">
            <input
              type="checkbox"
              checked={effective.whyOn}
              onChange={(e) => patch({ whyOn: e.target.checked })}
            />
            <span>Show “why we recommend” {inheritHint("whyOn")}</span>
          </label>
          {effective.whyOn ? (
            <label className="qz-rp2-field">
              <span>Why-copy {inheritHint("whyCopy")}</span>
              <textarea
                rows={2}
                value={effective.whyCopy}
                onChange={(e) => patch({ whyCopy: text(e.target.value) })}
              />
            </label>
          ) : null}

          {/* ── Hero & grid ── */}
          <div className="qz-rp2-section">Hero &amp; grid</div>
          {isProductTarget ? (
            // §4.1 — an individual product IS the hero: nothing to rank.
            <p className="qz-dim" style={{ fontSize: 12.5 }}>
              This result is a single product — it renders as the hero with no grid, so there’s
              nothing to rank here.
            </p>
          ) : (
            <label className="qz-rp2-field">
              <span>Hero picked by {inheritHint("heroLogic")}</span>
              <select
                value={effective.heroLogic}
                onChange={(e) => patch({ heroLogic: e.target.value as Signal })}
              >
                {HERO_SIGNALS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              {effective.heroLogic === "collection_order" ? (
                <span className="qz-dim" style={{ fontSize: 11.5 }}>
                  Reorder the collection in Shopify to change the hero — that’s the lever.
                </span>
              ) : null}
            </label>
          )}
          {/* Global-only layout/safety controls (§2.1) — hidden on overrides.
              showDesc lives HERE (review-caught: it is NOT in the §3.2
              override subset — routing it through patch() in override mode
              stored a key the schema silently strips on autosave). */}
          {!target || !editingOverride ? (
            <>
              <label className="qz-rp2-field qz-rp2-check">
                <input
                  type="checkbox"
                  checked={effective.showDesc}
                  onChange={(e) => patchGlobal({ showDesc: e.target.checked })}
                />
                <span>Show product descriptions</span>
              </label>
              <label className="qz-rp2-field">
                <span>Grid size (products after the hero)</span>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={effective.gridMax}
                  onChange={(e) => {
                    const n = Math.max(1, Math.min(12, Number(e.target.value) || 1));
                    patchGlobal({ gridMax: n });
                  }}
                />
              </label>
              <label className="qz-rp2-field">
                <span>Grid ordered by</span>
                <select
                  value={effective.gridSort}
                  onChange={(e) => patchGlobal({ gridSort: e.target.value as Signal })}
                >
                  {HERO_SIGNALS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="qz-rp2-field">
                <span>If the best product is out of stock</span>
                <select
                  value={effective.heroOos}
                  onChange={(e) => patchGlobal({ heroOos: e.target.value as "next" | "grid" })}
                >
                  <option value="next">Show the next-best as hero (OOS badge)</option>
                  <option value="grid">Skip the hero — grid only</option>
                </select>
              </label>

              <div className="qz-rp2-section">Fallbacks (§6 — safety, global)</div>
              <label className="qz-rp2-field">
                <span>If a result comes up empty</span>
                <select
                  value={effective.emptyFallback}
                  onChange={(e) =>
                    patchGlobal({ emptyFallback: e.target.value as "collection" | "hide" })
                  }
                >
                  <option value="collection">Show a fallback collection</option>
                  <option value="hide">Hide gracefully with a message</option>
                </select>
              </label>
              {effective.emptyFallback === "collection" ? (
                <label className="qz-rp2-field">
                  <span>Fallback collection</span>
                  <select
                    value={effective.emptyFallbackCol ?? ""}
                    onChange={(e) => patchGlobal({ emptyFallbackCol: e.target.value || undefined })}
                  >
                    <option value="">— pick a collection</option>
                    {collections.map((c) => (
                      <option key={c.collectionId} value={c.collectionId}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="qz-rp2-field">
                <span>Safety-net collection (last resort — recommended)</span>
                <select
                  value={effective.safetyNetCol ?? ""}
                  onChange={(e) => patchGlobal({ safetyNetCol: e.target.value || undefined })}
                >
                  <option value="">— none</option>
                  {collections.map((c) => (
                    <option key={c.collectionId} value={c.collectionId}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}

          {/* ── Incentive (validate-only — the app never creates discounts) ── */}
          <div className="qz-rp2-section">Incentive</div>
          <label className="qz-rp2-field qz-rp2-check">
            <input
              type="checkbox"
              checked={effective.incentiveOn}
              onChange={(e) => patch({ incentiveOn: e.target.checked })}
            />
            <span>Show a discount incentive {inheritHint("incentiveOn")}</span>
          </label>
          {effective.incentiveOn ? (
            <>
              <label className="qz-rp2-field">
                <span>Shopify discount code {inheritHint("incentiveCode")}</span>
                <input
                  value={effective.incentiveCode ?? ""}
                  placeholder="Create the code in Shopify Admin first"
                  onChange={(e) => patch({ incentiveCode: text(e.target.value) })}
                  onBlur={(e) => {
                    const trimmed = e.target.value.trim();
                    if (trimmed !== e.target.value) patch({ incentiveCode: text(trimmed) });
                    void validateCode(trimmed);
                  }}
                />
                {discount.state === "checking" ? (
                  <span className="qz-dim" style={{ fontSize: 11.5 }}>Checking…</span>
                ) : discount.state === "valid" ? (
                  <span className="qz-rp2-code-ok">✓ {discount.summary}</span>
                ) : discount.state === "invalid" ? (
                  <span className="qz-rp2-code-bad" role="alert">✕ {discount.reason}</span>
                ) : discount.state === "unavailable" ? (
                  <span className="qz-dim" style={{ fontSize: 11.5 }}>ⓘ {discount.reason}</span>
                ) : null}
              </label>
              <label className="qz-rp2-field qz-rp2-check">
                <input
                  type="checkbox"
                  checked={effective.incentiveAutoApply}
                  onChange={(e) => patch({ incentiveAutoApply: e.target.checked })}
                />
                <span>Auto-apply at checkout {inheritHint("incentiveAutoApply")}</span>
              </label>
              <label className="qz-rp2-field">
                <span>Placement {inheritHint("incentivePos")}</span>
                <select
                  value={effective.incentivePos}
                  onChange={(e) =>
                    patch({ incentivePos: e.target.value as "banner" | "below-headline" | "bottom" })
                  }
                >
                  <option value="banner">Top banner</option>
                  <option value="below-headline">Below the headline</option>
                  <option value="bottom">Bottom of the page</option>
                </select>
              </label>
            </>
          ) : null}

          {/* ── Capture (existing quiz-level flag — §7.1 email default-on) ── */}
          {!target || !editingOverride ? (
            <>
              <div className="qz-rp2-section">Capture</div>
              <label className="qz-rp2-field qz-rp2-check">
                <input
                  type="checkbox"
                  checked={doc.collect_email_on_result ?? false}
                  onChange={(e) => onCommit({ ...doc, collect_email_on_result: e.target.checked })}
                />
                <span>
                  Ask for an email before the reveal
                  <span className="qz-dim" style={{ display: "block", fontSize: 11.5 }}>
                    The capture → loading → reveal sequence ships with the new runtime.
                  </span>
                </span>
              </label>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
