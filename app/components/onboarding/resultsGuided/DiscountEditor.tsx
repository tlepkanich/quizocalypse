import { useEffect, useState, type ReactNode } from "react";
import { useFetcher } from "@remix-run/react";
import type { Quiz, DiscountConfig } from "../../../lib/quizSchema";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import type { BuilderCollection } from "../../builder/stepProps";
import { offerCodeDisplay, offerType } from "../../../lib/offerCopy";
import { QzModal } from "../../qz-overlays";
import { resolveDiscount, writeDiscount, type GuidedDiscount } from "./state";
import {
  RETIRED_DISCOUNT_KEYS,
  readbackRows,
  saveBlocker,
  withCodeMode,
  withExistingDiscount,
  withOfferType,
  type PickedDiscount,
} from "./discountRules";

/* Results handoff §8 — the discount editor. The rule: every control writes
   ONE documented Shopify Admin GraphQL field; a control that cannot be
   mapped is cut, not explained. One 680px column: Basics, then Advanced in
   Shopify's own section order with Shopify's own labels, then the read-back
   of what this creates in Shopify, then Save — disabled, with the reason,
   while the discount would be rejected or useless. While the email unlocks
   the offer, only a per-shopper code is allowed (the published quiz is
   public; a shared code behind the ask is one curl away). */

function Seg<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<[T, string, boolean?]>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="qz-segmented qz-rg-seg" role="group" aria-label={label}>
      {options.map(([v, text, disabled]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          disabled={disabled}
          onClick={() => onChange(v)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

type StoreDiscountRow = PickedDiscount & { title: string; summary: string };
type DiscountListResult = { intent?: string; ok?: boolean; error?: string; discounts?: StoreDiscountRow[] };

/** The store's own active code discounts, read from Shopify when the picker
 *  opens. Picking one saves its id and code and copies its facts. */
function ExistingDiscountPicker({
  pickedId,
  pickedCode,
  onPick,
}: {
  pickedId: string | undefined;
  pickedCode: string;
  onPick: (discount: StoreDiscountRow) => void;
}) {
  const fetcher = useFetcher<DiscountListResult>();
  const load = () => fetcher.submit({ intent: "list-discounts" }, { method: "post" });
  useEffect(() => {
    load();
    // Once, when the picker opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const result = fetcher.data?.intent === "list-discounts" ? fetcher.data : null;
  const loading = fetcher.state !== "idle" || !result;
  const discounts = result?.discounts ?? [];
  return (
    <div className="qz-rg-fld" data-rg-existing>
      <div className="qz-rg-fl">Existing discount</div>
      {loading ? (
        <div className="qz-rg-cap">Reading your Shopify discounts…</div>
      ) : result.ok !== true ? (
        <div className="qz-rg-cap" role="alert">
          {result.error ?? "Couldn't read your Shopify discounts."}{" "}
          <button type="button" className="qz-rg-later" onClick={load}>
            Try again
          </button>
        </div>
      ) : discounts.length === 0 ? (
        <div className="qz-rg-cap">
          No active code discounts in your store yet. Create one in Shopify, or use a code per shopper.
        </div>
      ) : (
        <div className="qz-rg-plist qz-rg-dpick" role="radiogroup" aria-label="Existing discount">
          {discounts.map((x) => (
            <label key={x.id} className="qz-rg-ck">
              <input
                type="radio"
                name="rg-existing-discount"
                checked={pickedId ? pickedId === x.id : pickedCode === x.code}
                onChange={() => onPick(x)}
              />
              <span>
                <b>{x.code}</b> · {x.title}
                {x.summary ? <span className="qz-rg-cap"> — {x.summary}</span> : null}
              </span>
            </label>
          ))}
        </div>
      )}
      {pickedCode && !loading && result.ok === true && !discounts.some((x) => x.code === pickedCode) ? (
        <div className="qz-rg-cap" role="alert">
          {pickedCode} is no longer an active discount in your store. Pick another.
        </div>
      ) : null}
      <div className="qz-rg-cap">The type, value and limits are read from the discount you pick.</div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="qz-rg-dgroup">
      <h4 className="qz-rg-grpdiv">{title}</h4>
      {children}
    </section>
  );
}

const num = (v: string) => (v.trim() === "" ? undefined : Math.max(0, Number(v) || 0));

export function DiscountEditor({
  doc,
  lockedToDynamic,
  collections,
  productIndex,
  onCommit,
  onClose,
}: {
  doc: Quiz;
  /** True while the email unlocks the offer — per-shopper codes only. */
  lockedToDynamic: boolean;
  collections: BuilderCollection[];
  productIndex: IndexedProduct[];
  onCommit: (doc: Quiz) => void;
  onClose: () => void;
}) {
  const initial = resolveDiscount(doc);
  const start: GuidedDiscount = lockedToDynamic ? withCodeMode(initial, "dynamic") : initial;
  const [d, setD] = useState<GuidedDiscount>(start);
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const set = (next: GuidedDiscount) => {
    setD(next);
    setDirty(true);
  };
  const patch = (p: Partial<GuidedDiscount>) => set({ ...d, ...p });

  const t = offerType(d);
  const blocker = saveBlocker(d);
  const pickedLabel =
    d.applies_to === "collections"
      ? collections.filter((c) => d.applies_collection_ids.includes(c.collectionId)).map((c) => c.title).join(", ")
      : undefined;
  const rows = readbackRows(d, { now: new Date(), pickedLabel });

  const save = () => {
    if (blocker) return;
    const next: Record<string, unknown> = {
      ...d,
      enabled: true,
      configured: true,
      title: d.title?.trim() || "Quiz reward",
    };
    // Stop writing the retired keys (writeDiscount drops undefined ones);
    // the schema keeps parsing them forever.
    for (const k of RETIRED_DISCOUNT_KEYS) next[k] = undefined;
    onCommit(writeDiscount(doc, next as Partial<DiscountConfig>));
    onClose();
  };
  const requestClose = () => (dirty ? setConfirmClose(true) : onClose());

  const toggleIn = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <QzModal
      open
      onClose={requestClose}
      size="lg"
      width={680}
      title="Discount"
      footer={
        confirmClose ? (
          <>
            <span className="qz-rg-saveblock">Discard your changes?</span>
            <button type="button" className="qz-btn qz-btn-ghost" onClick={() => setConfirmClose(false)}>
              Keep editing
            </button>
            <button type="button" className="qz-btn qz-btn-danger" onClick={onClose}>
              Discard
            </button>
          </>
        ) : (
          <>
            {blocker ? <span className="qz-rg-saveblock">{blocker}</span> : null}
            <button type="button" className="qz-btn qz-btn-ghost" onClick={requestClose}>
              Cancel
            </button>
            <button type="button" className="qz-btn qz-btn-accent" disabled={Boolean(blocker)} onClick={save}>
              Save discount
            </button>
          </>
        )
      }
    >
      <div className="qz-rg-deditor">
        {/* ── Basics ─────────────────────────────────────────────────────── */}
        <Group title="Basics">
          <div className="qz-rg-fl">Discount type</div>
          <Seg
            label="Discount type"
            value={t}
            onChange={(v) => set(withOfferType(d, v))}
            options={[
              ["order", "Amount off orders"],
              ["products", "Amount off products"],
              ["shipping", "Free shipping"],
            ]}
          />
          {t !== "shipping" ? (
            <div className="qz-rg-grid2" style={{ marginTop: 12 }}>
              <div>
                <div className="qz-rg-fl">Value</div>
                <Seg
                  label="Value type"
                  value={d.kind === "amount" ? "amount" : "percentage"}
                  onChange={(v) => patch({ kind: v })}
                  options={[
                    ["percentage", "Percentage"],
                    ["amount", "Fixed amount"],
                  ]}
                />
              </div>
              <div>
                <div className="qz-rg-fl">{d.kind === "amount" ? "Amount off ($)" : "Percent off (%)"}</div>
                <input
                  className="qz-input"
                  type="number"
                  min={0}
                  value={d.value}
                  aria-label="Discount value"
                  onChange={(e) => patch({ value: Math.max(0, Number(e.target.value) || 0) })}
                />
              </div>
            </div>
          ) : null}
          {t === "products" && d.kind === "amount" ? (
            <label className="qz-rg-ck">
              <input
                type="checkbox"
                checked={d.applies_on_each_item !== true}
                onChange={(e) => patch({ applies_on_each_item: e.target.checked ? undefined : true })}
              />
              <span>Only apply discount once per order</span>
            </label>
          ) : null}
          {t === "shipping" ? (
            <div className="qz-rg-fld">
              <label className="qz-rg-ck">
                <input
                  type="checkbox"
                  checked={d.max_shipping_price !== undefined}
                  onChange={(e) => patch({ max_shipping_price: e.target.checked ? 10 : undefined })}
                />
                <span>Exclude shipping rates over a certain amount</span>
              </label>
              {d.max_shipping_price !== undefined ? (
                <input
                  className="qz-input"
                  type="number"
                  min={0}
                  value={d.max_shipping_price}
                  aria-label="Maximum shipping rate"
                  onChange={(e) => patch({ max_shipping_price: num(e.target.value) ?? 0 })}
                />
              ) : null}
            </div>
          ) : null}
          <div className="qz-rg-fl" style={{ marginTop: 12 }}>
            Active dates
          </div>
          <Seg
            label="Active dates"
            value={d.expiry_mode}
            onChange={(v) => patch({ expiry_mode: v })}
            options={[
              ["none", "Doesn't expire"],
              ["hours", "Hours after the quiz", d.code_mode !== "dynamic"],
              ["date", "On a date"],
            ]}
          />
          {d.expiry_mode === "hours" ? (
            <div className="qz-rg-exprow">
              <input
                className="qz-input"
                type="number"
                min={1}
                value={d.expiry_hours}
                aria-label="Hours after the quiz"
                onChange={(e) => patch({ expiry_hours: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
              />
              <span className="qz-rg-exunit">hours after each shopper finishes</span>
            </div>
          ) : null}
          {d.expiry_mode === "date" ? (
            <input
              className="qz-input"
              type="date"
              value={d.ends_at?.slice(0, 10) ?? ""}
              aria-label="End date"
              onChange={(e) => patch({ ends_at: e.target.value ? `${e.target.value}T23:59:59Z` : undefined })}
            />
          ) : null}
          <div className="qz-rg-codeline">
            Code <b>{offerCodeDisplay(d)}</b>
          </div>
        </Group>

        {/* ── Advanced, in Shopify's own order ──────────────────────────── */}
        <Group title="Discount code">
          <div className="qz-rg-fl">Where the code comes from</div>
          <Seg
            label="Where the code comes from"
            value={d.code_mode}
            onChange={(v) => set(withCodeMode(d, v))}
            options={[
              ["dynamic", "A new code per shopper"],
              ["static", "One shared code", lockedToDynamic],
              ["existing", "An existing discount", lockedToDynamic],
            ]}
          />
          {lockedToDynamic ? (
            <div className="qz-rg-cap">The email unlocks this offer, so only a code made on submit can be held back.</div>
          ) : null}
          {d.code_mode === "dynamic" ? (
            <div className="qz-rg-fld">
              <div className="qz-rg-fl">Code prefix</div>
              <input
                className="qz-input"
                value={d.code_prefix}
                aria-label="Code prefix"
                onChange={(e) => patch({ code_prefix: e.target.value })}
              />
            </div>
          ) : null}
          {d.code_mode === "static" ? (
            <div className="qz-rg-fld">
              <div className="qz-rg-fl">Code</div>
              <input
                className="qz-input"
                value={d.static_code}
                placeholder="SAVE10"
                aria-label="Shared code"
                onChange={(e) => patch({ static_code: e.target.value.toUpperCase() })}
              />
            </div>
          ) : null}
          {d.code_mode === "existing" ? (
            <ExistingDiscountPicker
              pickedId={d.existing_discount_id}
              pickedCode={d.existing_code}
              onPick={(x) => set(withExistingDiscount(d, x))}
            />
          ) : (
            <div className="qz-rg-fld">
              <div className="qz-rg-fl">Discount name</div>
              <input
                className="qz-input"
                value={d.title}
                aria-label="Discount name"
                onChange={(e) => patch({ title: e.target.value })}
              />
              <div className="qz-rg-cap">Shoppers see this name too.</div>
            </div>
          )}
        </Group>

        {t === "products" ? (
          <Group title="Applies to">
            <Seg
              label="Applies to"
              value={d.applies_to as "recommended" | "collections" | "products"}
              onChange={(v) => patch({ applies_to: v })}
              options={[
                ["recommended", "What we recommend", d.code_mode !== "dynamic"],
                ["collections", "Specific collections"],
                ["products", "Specific products"],
              ]}
            />
            {d.applies_to === "collections" ? (
              <div className="qz-rg-plist qz-rg-dpick">
                {collections.map((c) => (
                  <label key={c.collectionId} className="qz-rg-ck">
                    <input
                      type="checkbox"
                      checked={d.applies_collection_ids.includes(c.collectionId)}
                      onChange={() => patch({ applies_collection_ids: toggleIn(d.applies_collection_ids, c.collectionId) })}
                    />
                    <span>{c.title}</span>
                  </label>
                ))}
              </div>
            ) : null}
            {d.applies_to === "products" ? (
              <div className="qz-rg-plist qz-rg-dpick">
                {productIndex.slice(0, 100).map((p) => (
                  <label key={p.product_id} className="qz-rg-ck">
                    <input
                      type="checkbox"
                      checked={d.applies_product_ids.includes(p.product_id)}
                      onChange={() => patch({ applies_product_ids: toggleIn(d.applies_product_ids, p.product_id) })}
                    />
                    <span>{p.title}</span>
                  </label>
                ))}
              </div>
            ) : null}
          </Group>
        ) : null}

        {t === "shipping" ? (
          <Group title="Countries">
            <Seg
              label="Countries"
              value={d.shipping_countries === undefined ? "all" : "selected"}
              onChange={(v) => patch({ shipping_countries: v === "all" ? undefined : [] })}
              options={[
                ["all", "All countries"],
                ["selected", "Selected countries"],
              ]}
            />
            {d.shipping_countries !== undefined ? (
              <input
                className="qz-input"
                value={d.shipping_countries.join(", ")}
                placeholder="US, CA, GB"
                aria-label="Country codes"
                onChange={(e) =>
                  patch({
                    shipping_countries: e.target.value
                      .split(/[\s,]+/)
                      .map((c) => c.trim().toUpperCase())
                      .filter((c) => /^[A-Z]{2}$/.test(c)),
                  })
                }
              />
            ) : null}
          </Group>
        ) : null}

        <Group title="Minimum purchase requirements">
          <Seg
            label="Minimum purchase requirements"
            value={d.minimum_subtotal !== undefined ? "amount" : d.minimum_quantity !== undefined ? "quantity" : "none"}
            onChange={(v) =>
              patch({
                minimum_subtotal: v === "amount" ? 50 : undefined,
                minimum_quantity: v === "quantity" ? 2 : undefined,
              })
            }
            options={[
              ["none", "No minimum"],
              ["amount", "Minimum purchase amount"],
              ["quantity", "Minimum quantity of items"],
            ]}
          />
          {d.minimum_subtotal !== undefined ? (
            <input
              className="qz-input"
              type="number"
              min={0}
              value={d.minimum_subtotal}
              aria-label="Minimum purchase amount"
              onChange={(e) => patch({ minimum_subtotal: num(e.target.value) ?? 0 })}
            />
          ) : null}
          {d.minimum_quantity !== undefined ? (
            <input
              className="qz-input"
              type="number"
              min={1}
              value={d.minimum_quantity}
              aria-label="Minimum quantity of items"
              onChange={(e) => patch({ minimum_quantity: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
            />
          ) : null}
        </Group>

        <Group title="Maximum discount uses">
          <label className="qz-rg-ck">
            <input
              type="checkbox"
              checked={d.usage_limit !== undefined}
              onChange={(e) => patch({ usage_limit: e.target.checked ? 100 : undefined })}
            />
            <span>
              {d.code_mode === "dynamic"
                ? "Limit the total codes this quiz can give out"
                : "Limit number of times this discount can be used in total"}
            </span>
          </label>
          {d.usage_limit !== undefined ? (
            <input
              className="qz-input"
              type="number"
              min={1}
              value={d.usage_limit}
              aria-label="Total uses"
              onChange={(e) => patch({ usage_limit: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
            />
          ) : null}
          <label className="qz-rg-ck">
            <input
              type="checkbox"
              checked={d.once_per_customer}
              onChange={(e) => patch({ once_per_customer: e.target.checked })}
            />
            <span>Limit to one use per customer</span>
          </label>
          {d.code_mode === "dynamic" && d.once_per_customer ? (
            <div className="qz-rg-cap">Shopify counts use per code, so the app enforces this by email.</div>
          ) : null}
        </Group>

        <Group title="Purchase type">
          <Seg
            label="Purchase type"
            value={d.purchase}
            onChange={(v) => patch({ purchase: v })}
            options={[
              ["onetime", "One-time purchase"],
              ["sub", "Subscription"],
              ["both", "Both"],
            ]}
          />
          {d.purchase !== "onetime" ? (
            <>
              <div className="qz-rg-fl" style={{ marginTop: 10 }}>
                Recurring payments for a subscription
              </div>
              <Seg
                label="Recurring payments"
                value={d.recurring_limit === 0 ? "all" : d.recurring_limit === 1 ? "first" : "set"}
                onChange={(v) => patch({ recurring_limit: v === "all" ? 0 : v === "first" ? 1 : 3 })}
                options={[
                  ["first", "First payment only"],
                  ["set", "A set number"],
                  ["all", "Every payment"],
                ]}
              />
              {d.recurring_limit > 1 ? (
                <input
                  className="qz-input"
                  type="number"
                  min={2}
                  value={d.recurring_limit}
                  aria-label="Number of payments"
                  onChange={(e) => patch({ recurring_limit: Math.max(2, Math.round(Number(e.target.value) || 2)) })}
                />
              ) : null}
            </>
          ) : null}
        </Group>

        <Group title="Combinations">
          {(
            [
              ["product", "Product discounts"],
              ["order", "Order discounts"],
              ["shipping", "Shipping discounts"],
            ] as const
          )
            .filter(([k]) => !(k === "shipping" && t === "shipping"))
            .map(([k, label]) => (
              <label key={k} className="qz-rg-ck">
                <input
                  type="checkbox"
                  checked={d.combines?.[k] === true}
                  onChange={(e) => patch({ combines: { ...(d.combines ?? {}), [k]: e.target.checked } })}
                />
                <span>{label}</span>
              </label>
            ))}
        </Group>

        {/* ── What this creates in Shopify ───────────────────────────────── */}
        <section className="qz-rg-dread" aria-label="Summary">
          <h4 className="qz-rg-grpdiv">
            {d.code_mode === "existing" ? "What this uses in Shopify" : "What this creates in Shopify"}
          </h4>
          <dl>
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </QzModal>
  );
}
