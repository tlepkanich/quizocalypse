import { useState } from "react";
import type { Quiz } from "../../../lib/quizSchema";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import { QzModal } from "../../qz-overlays";
import { resolveGuided, patchGuided } from "./state";

/* Results-guided handoff §4 — the three small editors. Each edits a DRAFT and
   commits on Save (Cancel/✕ discard), mirroring the mock's dirty-guard
   behavior in the lightweight QzModal idiom. */

/** §4 step 4 · Consent — the terms sentence and its two separately-pointed
 *  links. {terms}/{privacy} tokens become the links; dropping a token drops
 *  that link. Terms and privacy are different documents and often different
 *  URLs — one shared link field would guarantee a wrong one. */
export function TermsModal({
  doc,
  onCommit,
  onClose,
}: {
  doc: Quiz;
  onCommit: (doc: Quiz) => void;
  onClose: () => void;
}) {
  const cfg = resolveGuided(doc);
  const [copy, setCopy] = useState(
    cfg.captureTermsText || "By continuing you agree to our {terms} and {privacy}.",
  );
  const [tLabel, setTLabel] = useState(cfg.termsLabel);
  const [tUrl, setTUrl] = useState(cfg.termsUrl);
  const [pLabel, setPLabel] = useState(cfg.privacyLabel);
  const [pUrl, setPUrl] = useState(cfg.privacyUrl);

  const previewParts = copy.split(/(\{terms\}|\{privacy\})/);
  return (
    <QzModal
      open
      onClose={onClose}
      size="md"
      title="Terms & conditions"
      footer={
        <>
          <button type="button" className="qz-btn qz-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="qz-btn qz-btn-accent"
            onClick={() => {
              onCommit(
                patchGuided(doc, {
                  captureTermsText: copy,
                  captureTermsOn: true,
                  termsLabel: tLabel,
                  termsUrl: tUrl,
                  privacyLabel: pLabel,
                  privacyUrl: pUrl,
                }),
              );
              onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="qz-rg-fld">
        <div className="qz-rg-fl">Wording</div>
        <textarea
          className="qz-input"
          rows={2}
          value={copy}
          onChange={(e) => setCopy(e.target.value)}
          aria-label="Terms sentence"
        />
        <div className="qz-rg-cap">
          <b>{"{terms}"}</b> and <b>{"{privacy}"}</b> become the links. Drop either token to
          leave it out of the sentence.
        </div>
      </div>
      <div className="qz-rg-fld">
        <div className="qz-rg-fl">Terms link</div>
        <input
          className="qz-input"
          value={tLabel}
          placeholder="Link text"
          aria-label="Terms link text"
          onChange={(e) => setTLabel(e.target.value)}
          style={{ marginBottom: 6 }}
        />
        <input
          className="qz-input"
          value={tUrl}
          placeholder="/policies/terms-of-service"
          aria-label="Terms link URL"
          onChange={(e) => setTUrl(e.target.value)}
        />
      </div>
      <div className="qz-rg-fld">
        <div className="qz-rg-fl">Privacy link</div>
        <input
          className="qz-input"
          value={pLabel}
          placeholder="Link text"
          aria-label="Privacy link text"
          onChange={(e) => setPLabel(e.target.value)}
          style={{ marginBottom: 6 }}
        />
        <input
          className="qz-input"
          value={pUrl}
          placeholder="/policies/privacy-policy"
          aria-label="Privacy link URL"
          onChange={(e) => setPUrl(e.target.value)}
        />
      </div>
      <div className="qz-rg-fld">
        <div className="qz-rg-fl">Preview</div>
        <p className="qz-rg-termspv">
          {previewParts.map((p, i) =>
            p === "{terms}" ? <u key={i}>{tLabel}</u> : p === "{privacy}" ? <u key={i}>{pLabel}</u> : p,
          )}
        </p>
      </div>
    </QzModal>
  );
}

/** §4 step 2 — the per-product description LEDGER: one row per product,
 *  blank rows fall back to the product's own store description. */
export function DescriptionsModal({
  doc,
  productIndex,
  onCommit,
  onClose,
}: {
  doc: Quiz;
  productIndex: IndexedProduct[];
  onCommit: (doc: Quiz) => void;
  onClose: () => void;
}) {
  const cfg = resolveGuided(doc);
  const [texts, setTexts] = useState<Record<string, string>>({ ...(cfg.descOverrides ?? {}) });
  const rows = productIndex.slice(0, 24);
  return (
    <QzModal
      open
      onClose={onClose}
      size="md"
      width={620}
      title="Product descriptions"
      footer={
        <>
          <button type="button" className="qz-btn qz-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="qz-btn qz-btn-accent"
            onClick={() => {
              const clean: Record<string, string> = {};
              for (const [k, v] of Object.entries(texts)) if (v.trim()) clean[k] = v.trim();
              onCommit(
                patchGuided(doc, {
                  descOverrides: Object.keys(clean).length ? clean : undefined,
                }),
              );
              onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="qz-rg-ldg">
        <div className="qz-rg-ldghead">
          <span>Product</span>
          <span>Description</span>
        </div>
        {rows.map((p) => (
          <div key={p.product_id} className="qz-rg-ldgrow">
            <span className="qz-rg-ldgname">
              {p.image_url ? (
                <i style={{ backgroundImage: `url("${p.image_url}")` }} />
              ) : (
                <i className="is-ph" />
              )}
              <span>{p.title}</span>
            </span>
            <input
              className="qz-input"
              value={texts[p.product_id] ?? ""}
              placeholder="Uses the product's own store description"
              aria-label={`Description for ${p.title}`}
              onChange={(e) =>
                setTexts((t) => ({ ...t, [p.product_id]: e.target.value }))
              }
            />
          </div>
        ))}
      </div>
      <div className="qz-rg-noteok">✓ Blank rows fall back to each product’s own store description.</div>
    </QzModal>
  );
}

/** §4 step 5 — the extra-picks product picker. Products only in this pass:
 *  tags/collections resolve at runtime and that wiring is flagged. */
export function ExtrasPickerModal({
  doc,
  productIndex,
  onCommit,
  onClose,
}: {
  doc: Quiz;
  productIndex: IndexedProduct[];
  onCommit: (doc: Quiz) => void;
  onClose: () => void;
}) {
  const cfg = resolveGuided(doc);
  const [picked, setPicked] = useState<string[]>([...cfg.extrasProductIds]);
  const rows = productIndex.slice(0, 40);
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <QzModal
      open
      onClose={onClose}
      size="md"
      title="Extra-pick products"
      footer={
        <>
          <button type="button" className="qz-btn qz-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="qz-btn qz-btn-accent"
            onClick={() => {
              onCommit(patchGuided(doc, { extrasProductIds: picked }));
              onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="qz-rg-selbar">
        <b>{picked.length}</b>&nbsp;selected · the “you might also like” row
      </div>
      <div className="qz-rg-plist">
        {rows.map((p) => {
          const on = picked.includes(p.product_id);
          return (
            <div
              key={p.product_id}
              role="checkbox"
              aria-checked={on}
              tabIndex={0}
              className={`qz-rg-prow2${on ? " is-on" : ""}`}
              onClick={() => toggle(p.product_id)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                toggle(p.product_id);
              }}
            >
              <span
                className="qz-rg-pth"
                style={p.image_url ? { backgroundImage: `url("${p.image_url}")` } : undefined}
              />
              <span className="qz-rg-pi">
                <b>{p.title}</b>
                <span>{p.price ? `$${parseFloat(p.price).toFixed(2)}` : "—"}</span>
              </span>
              <span className="qz-rg-ck2" aria-hidden>
                ✓
              </span>
            </div>
          );
        })}
      </div>
      <div className="qz-rg-noteok">
        ✓ Inherits everything from the results page. You only pick the products.
      </div>
    </QzModal>
  );
}
