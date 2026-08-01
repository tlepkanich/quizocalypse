import { useState, type ReactNode } from "react";
import type { Quiz, DiscountConfig } from "../../../lib/quizSchema";
import { QzModal } from "../../qz-overlays";
import {
  resolveDiscount,
  writeDiscount,
  DISCOUNT_DEFAULTS,
  type GuidedDiscount,
} from "./state";

/* Results-guided handoff §4 step 3 — the full discount editor: a BASICS pane
   (the 5 things 95% of merchants set) and an ADVANCED group (code source,
   rules & limits, per-class combinations, delivery & purchase type), with the
   live plain-English summary rail reading back what is being built plus the
   warnings that bite in production. §9: when the email UNLOCKS the offer, the
   code mode is FORCED to per-shopper dynamic — the published doc is public,
   so a static/existing code cannot gate anything; those options are refused
   outright, not warned about. */

function Row3({ children }: { children: ReactNode }) {
  return <div className="qz-rg-row3">{children}</div>;
}

export function DiscountEditor({
  doc,
  lockedToDynamic,
  onCommit,
  onSaved,
  onClose,
}: {
  doc: Quiz;
  /** True while the unlock placement is active (§9 — dynamic only). */
  lockedToDynamic: boolean;
  onCommit: (doc: Quiz) => void;
  /** Fired after a successful save (the ask step's set-up flow returns). */
  onSaved?: () => void;
  onClose: () => void;
}) {
  const initial = resolveDiscount(doc);
  const [d, setD] = useState<GuidedDiscount>({
    ...initial,
    code_mode: lockedToDynamic ? "dynamic" : initial.code_mode,
    combines: initial.combines ?? { product: false, order: false, shipping: false },
  });
  const [grp, setGrp] = useState<"basic" | "adv">("basic");
  const patch = (p: Partial<GuidedDiscount>) => setD((x) => ({ ...x, ...p }));

  const code =
    d.code_mode === "existing"
      ? d.existing_code || "SPRING10"
      : d.code_mode === "static"
        ? d.static_code || `${d.code_prefix}SPRING`
        : `${d.code_prefix}7F3K2Q`;
  const valueLabel =
    d.kind === "free_shipping" ? "Free shipping" : d.kind === "amount" ? `$${d.value} off` : `${d.value}% off`;

  // ── the live plain-English summary + production warnings (mock summarise) ──
  const combines = d.combines ?? {};
  const yes = (["product", "order", "shipping"] as const).filter((k) => combines[k] === true);
  const who =
    d.eligibility === "first"
      ? "first-time buyers only"
      : d.eligibility === "segment"
        ? `the “${d.segment}” segment only`
        : "everyone";
  const exp =
    d.expiry_mode === "hours"
      ? `expires ${d.expiry_hours}h after the quiz`
      : d.expiry_mode === "date"
        ? d.ends_at
          ? `expires ${d.ends_at.slice(0, 10)}`
          : "expires on a set date"
        : "never expires";
  const warnings: Array<["err" | "warn" | "ok", string]> = [];
  if (d.value < 1 && d.kind !== "free_shipping")
    warnings.push(["err", "0% / $0 breaks checkout. Use at least 1% or $0.01."]);
  if (lockedToDynamic)
    warnings.push([
      "ok",
      "Locked to unique-per-shopper. The email ask unlocks this offer, and only a code minted on submit can actually be withheld.",
    ]);
  if (d.code_mode === "dynamic")
    warnings.push(["warn", "One Shopify discount object per quiz-taker. Watch the limit at volume."]);
  if (d.code_mode === "static") warnings.push(["warn", "A shared code will leak to coupon sites."]);
  if (d.eligibility === "segment")
    warnings.push(["err", "Segment targeting needs email capture on. An anonymous shopper has no segment."]);

  return (
    <QzModal
      open
      onClose={onClose}
      size="lg"
      width={880}
      title="Discount"
      footer={
        <>
          <button type="button" className="qz-btn qz-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="qz-btn qz-btn-accent"
            onClick={() => {
              const next: Partial<DiscountConfig> = {
                ...d,
                enabled: true,
                value: Math.max(d.kind === "free_shipping" ? 0 : 1, d.value),
                code_mode: lockedToDynamic ? "dynamic" : d.code_mode,
              };
              // sparse: drop keys equal to the read-time defaults
              for (const [k, v] of Object.entries(DISCOUNT_DEFAULTS)) {
                if ((next as Record<string, unknown>)[k] === v)
                  delete (next as Record<string, unknown>)[k];
              }
              onCommit(writeDiscount(doc, next));
              onSaved?.();
              onClose();
            }}
          >
            Save discount
          </button>
        </>
      }
    >
      <div className="qz-rg-editor">
        <div className="qz-rg-editorm">
          <div className="qz-rg-mtabs">
            <button
              type="button"
              className={`qz-rg-mtab${grp === "basic" ? " is-on" : ""}`}
              onClick={() => setGrp("basic")}
            >
              Basics
            </button>
            <button
              type="button"
              className={`qz-rg-mtab${grp === "adv" ? " is-on" : ""}`}
              onClick={() => setGrp("adv")}
            >
              Advanced
            </button>
          </div>

          {grp === "basic" ? (
            <>
              <p className="qz-rg-grpnote">
                Set the type and amount. Everything else has a sensible default in Advanced.
              </p>
              <div className="qz-rg-grid2">
                <div>
                  <div className="qz-rg-fl">Type</div>
                  <select
                    className="qz-select"
                    value={d.kind}
                    aria-label="Discount type"
                    onChange={(e) => patch({ kind: e.target.value as GuidedDiscount["kind"] })}
                  >
                    <option value="percentage">Variable (% off)</option>
                    <option value="amount">Flat ($ off)</option>
                    <option value="free_shipping">Free shipping</option>
                  </select>
                </div>
                {d.kind !== "free_shipping" ? (
                  <div>
                    <div className="qz-rg-fl">
                      {d.kind === "amount" ? "Amount off ($)" : "Percent off (%)"}
                    </div>
                    <input
                      className="qz-input"
                      type="number"
                      min={1}
                      value={d.value}
                      aria-label="Discount value"
                      onChange={(e) => patch({ value: Math.max(0, +e.target.value || 0) })}
                    />
                  </div>
                ) : (
                  <div />
                )}
              </div>
              <div className="qz-rg-grid2" style={{ marginTop: 12 }}>
                <div>
                  <div className="qz-rg-fl">Minimum cart value</div>
                  <input
                    className="qz-input"
                    type="number"
                    value={d.minimum_subtotal ?? ""}
                    placeholder="None"
                    aria-label="Minimum cart value"
                    onChange={(e) =>
                      patch({ minimum_subtotal: +e.target.value > 0 ? +e.target.value : undefined })
                    }
                  />
                </div>
                <div>
                  <div className="qz-rg-fl">Expires</div>
                  <div className="qz-rg-exprow">
                    <input
                      className="qz-input"
                      type="number"
                      min={1}
                      value={d.expiry_hours}
                      aria-label="Expiry hours"
                      onChange={(e) =>
                        patch({ expiry_mode: "hours", expiry_hours: Math.max(1, +e.target.value || 24) })
                      }
                    />
                    <span className="qz-rg-exunit">hrs after quiz</span>
                  </div>
                </div>
              </div>
              <label className="qz-rg-ck">
                <input
                  type="checkbox"
                  checked={combines.product === true}
                  onChange={(e) => {
                    const c = e.target.checked;
                    patch({ combines: { product: c, order: c, shipping: c } });
                  }}
                />
                <span>
                  Can stack with other discounts
                  <em>
                    Off = applies alone (Shopify's safe default). On = combines with product &amp;
                    order codes.
                  </em>
                </span>
              </label>
              <div className="qz-rg-codeline">
                Code <b>{code}</b>
                {d.code_mode === "dynamic" ? " · unique per shopper" : ""} ·{" "}
                <button type="button" className="qz-rg-advlink" onClick={() => setGrp("adv")}>
                  edit in Advanced →
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="qz-rg-grpdiv">Code</div>
              <div className="qz-rg-fl">Where the code comes from</div>
              <Row3>
                <button
                  type="button"
                  className={`qz-rg-opt${d.code_mode === "dynamic" ? " is-on" : ""}`}
                  onClick={() => patch({ code_mode: "dynamic" })}
                >
                  <b>Unique per shopper</b>
                  <span>Can't leak. Full attribution. One Shopify object per taker.</span>
                </button>
                <button
                  type="button"
                  className={`qz-rg-opt${d.code_mode === "static" ? " is-on" : ""}${lockedToDynamic ? " is-nope" : ""}`}
                  onClick={() => {
                    if (!lockedToDynamic) patch({ code_mode: "static" });
                  }}
                >
                  <b>One shared code</b>
                  <span>
                    {lockedToDynamic
                      ? "Unavailable while the email unlocks the offer. One shared string can’t be locked."
                      : "Simple. Will end up on coupon sites."}
                  </span>
                </button>
                <button
                  type="button"
                  className={`qz-rg-opt${d.code_mode === "existing" ? " is-on" : ""}${lockedToDynamic ? " is-nope" : ""}`}
                  onClick={() => {
                    if (!lockedToDynamic) patch({ code_mode: "existing" });
                  }}
                >
                  <b>Use an existing</b>
                  <span>
                    {lockedToDynamic
                      ? "Unavailable while the email unlocks the offer. The code already exists and can leak."
                      : "Pick a discount you already made."}
                  </span>
                </button>
              </Row3>
              <div className="qz-rg-grid2" style={{ marginTop: 10 }}>
                {d.code_mode !== "existing" ? (
                  <div>
                    <div className="qz-rg-fl">Code prefix</div>
                    <input
                      className="qz-input"
                      value={d.code_prefix}
                      aria-label="Code prefix"
                      onChange={(e) => patch({ code_prefix: e.target.value || "QUIZ-" })}
                    />
                    <div className="qz-rg-cap">
                      Every quiz discount starts with this, so you can filter them all in Shopify
                      admin.
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="qz-rg-fl">Existing Shopify discount code</div>
                    <input
                      className="qz-input"
                      value={d.existing_code}
                      placeholder="SPRING10"
                      aria-label="Existing discount code"
                      onChange={(e) => patch({ existing_code: e.target.value })}
                    />
                  </div>
                )}
                {d.code_mode === "static" ? (
                  <div>
                    <div className="qz-rg-fl">Code</div>
                    <input
                      className="qz-input"
                      value={d.static_code || `${d.code_prefix}SPRING`}
                      aria-label="Shared code"
                      onChange={(e) => patch({ static_code: e.target.value })}
                    />
                  </div>
                ) : (
                  <div />
                )}
              </div>
              <label className="qz-rg-ck" style={{ marginTop: 14 }}>
                <input
                  type="checkbox"
                  checked={d.auto_apply}
                  onChange={(e) => patch({ auto_apply: e.target.checked })}
                />
                <span>
                  Auto-apply at checkout
                  <em>
                    Uses the /discount/CODE link to seed the cart. It does not change the price
                    shown on the product page.
                  </em>
                </span>
              </label>

              <div className="qz-rg-grpdiv">Rules &amp; limits</div>
              <div className="qz-rg-fl">Who can use it</div>
              <Row3>
                {(
                  [
                    ["all", "Everyone", ""],
                    ["first", "First-time buyers", "Never discounts a repeat customer."],
                    ["segment", "A customer segment", ""],
                  ] as const
                ).map(([v, b, s]) => (
                  <button
                    key={v}
                    type="button"
                    className={`qz-rg-opt${d.eligibility === v ? " is-on" : ""}`}
                    onClick={() => patch({ eligibility: v })}
                  >
                    <b>{b}</b>
                    {s ? <span>{s}</span> : null}
                  </button>
                ))}
              </Row3>
              {d.eligibility === "segment" ? (
                <div style={{ margin: "8px 0 14px" }}>
                  <input
                    className="qz-input"
                    value={d.segment}
                    placeholder="Segment name"
                    aria-label="Segment name"
                    onChange={(e) => patch({ segment: e.target.value })}
                  />
                  <div className="qz-rg-cap">
                    Needs email capture. An anonymous shopper has no segment.
                  </div>
                </div>
              ) : null}
              <div className="qz-rg-fl" style={{ marginTop: 12 }}>
                Usage limits
              </div>
              <div className="qz-rg-grid2">
                <input
                  className="qz-input"
                  type="number"
                  value={d.usage_limit ?? ""}
                  placeholder="Total uses (blank = unlimited)"
                  aria-label="Total usage limit"
                  onChange={(e) =>
                    patch({ usage_limit: +e.target.value > 0 ? +e.target.value : undefined })
                  }
                />
                <label className="qz-rg-ck" style={{ margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={d.once_per_customer}
                    onChange={(e) => patch({ once_per_customer: e.target.checked })}
                  />
                  <span>One use per customer</span>
                </label>
              </div>
              <div className="qz-rg-fl" style={{ marginTop: 16 }}>
                What it applies to
              </div>
              <Row3>
                {(
                  [
                    ["all", "All matches"],
                    ["top", "Top pick only"],
                    ["collections", "Specific collections"],
                  ] as const
                ).map(([v, b]) => (
                  <button
                    key={v}
                    type="button"
                    className={`qz-rg-opt${d.scope === v ? " is-on" : ""}`}
                    onClick={() => patch({ scope: v })}
                  >
                    <b>{b}</b>
                  </button>
                ))}
              </Row3>
              <label className="qz-rg-ck">
                <input
                  type="checkbox"
                  checked={d.exclude_sale}
                  onChange={(e) => patch({ exclude_sale: e.target.checked })}
                />
                <span>
                  Exclude items already on sale
                  <em>Protects margin. Shopify won't do this for you.</em>
                </span>
              </label>

              <div className="qz-rg-grpdiv">Combinations, per class</div>
              <div className="qz-rg-noteerr">
                ⚠ <b>Shopify never combines discounts by default.</b> You must say yes or no to
                each class — otherwise, when a shopper has another code, Shopify silently applies
                whichever is better and your quiz discount may just vanish.
              </div>
              {(
                [
                  ["product", "Other product discounts", "Off specific items. e.g. a sale code."],
                  ["order", "Order discounts", "Off the cart subtotal. e.g. WELCOME10."],
                  ["shipping", "Shipping discounts", "Free / discounted delivery."],
                ] as const
              ).map(([k, n, s]) => (
                <div key={k} className="qz-rg-yn">
                  <span className="qz-rg-ynt">
                    {n}
                    <em>{s}</em>
                  </span>
                  <span className="qz-rg-ynbtns">
                    <button
                      type="button"
                      className={`qz-rg-ynb${combines[k] === true ? " is-on" : ""}`}
                      onClick={() => patch({ combines: { ...combines, [k]: true } })}
                    >
                      Combines
                    </button>
                    <button
                      type="button"
                      className={`qz-rg-ynb is-no${combines[k] === false ? " is-on" : ""}`}
                      onClick={() => patch({ combines: { ...combines, [k]: false } })}
                    >
                      Doesn't
                    </button>
                  </span>
                </div>
              ))}

              <div className="qz-rg-grpdiv">Delivery &amp; purchase type</div>
              <div className="qz-rg-notewarn">
                ⚑ <b>You can finish this later.</b> The code shows on the results page by default —
                that works on its own. Email delivery and loyalty-point integrations are flagged as
                a to-do until their connections land.
              </div>
              <Row3>
                {(
                  [
                    ["onetime", "One-time only"],
                    ["sub", "Subscriptions only"],
                    ["both", "Both"],
                  ] as const
                ).map(([v, b]) => (
                  <button
                    key={v}
                    type="button"
                    className={`qz-rg-opt${d.purchase === v ? " is-on" : ""}`}
                    onClick={() => patch({ purchase: v })}
                  >
                    <b>{b}</b>
                  </button>
                ))}
              </Row3>
              {d.purchase !== "onetime" ? (
                <div style={{ marginTop: 8 }}>
                  <div className="qz-rg-fl">Applies to how many subscription orders</div>
                  <input
                    className="qz-input"
                    type="number"
                    min={1}
                    value={d.recurring_limit}
                    aria-label="Recurring order limit"
                    onChange={(e) => patch({ recurring_limit: Math.max(1, +e.target.value || 1) })}
                  />
                  <div className="qz-rg-cap">
                    Recharge and Ordergroove bill renewals themselves — orders past the first need a
                    matching discount inside that app.
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* live summary rail — what you're building, read back */}
        <aside className="qz-rg-sumrail">
          <div className="qz-rg-sumh">What you're building</div>
          <div className="qz-rg-sumsent">
            <b>{valueLabel}</b>{" "}
            {d.scope === "top"
              ? "the top pick only"
              : d.scope === "collections"
                ? "selected collections"
                : "the recommended products"}
            . {d.code_mode === "dynamic" ? "A unique code per shopper" : d.code_mode === "static" ? "One shared code" : "An existing Shopify discount"}
            . <span className="qz-rg-sumcode">{code}</span>
            {d.auto_apply ? ", auto-applied at checkout" : ""}. Available to <b>{who}</b>, {exp}.{" "}
            {d.minimum_subtotal ? `Minimum spend $${d.minimum_subtotal}. ` : ""}
            {d.once_per_customer ? "One use per customer. " : ""}
            {d.exclude_sale ? "Excludes sale items. " : ""}
            {yes.length ? (
              <>
                Combines with <b>{yes.join(" + ")}</b> discounts.
              </>
            ) : (
              <b>Combines with nothing.</b>
            )}
          </div>
          {warnings.length ? (
            <div className="qz-rg-sumwarn">
              {warnings.map(([k, t], i) => (
                <div key={i} className={`qz-rg-sw2 is-${k}`}>
                  <span>{k === "err" ? "⚠" : k === "warn" ? "!" : "✓"}</span>
                  <span>{t}</span>
                </div>
              ))}
            </div>
          ) : null}
        </aside>
      </div>
    </QzModal>
  );
}
