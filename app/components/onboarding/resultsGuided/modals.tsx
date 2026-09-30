import { useState } from "react";
import type { Quiz } from "../../../lib/quizSchema";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import { QzModal } from "../../qz-overlays";
import {
  DEFAULT_PRIVACY_LABEL,
  DEFAULT_PRIVACY_PATH,
  DEFAULT_TERMS_LABEL,
  DEFAULT_TERMS_PATH,
  TERMS_BOX,
  TERMS_LINE,
  checkPolicyLink,
  unsubscribeLine,
  type LinkCheck,
  type WordingPart,
} from "../../../lib/consentWording";
import { resolveGuided, patchGuided, EXTRAS_FIRST_PICK } from "./state";

/* Results-guided handoff — the three small editors. Each edits a DRAFT and
   commits on Save (Cancel/✕ discard), in the lightweight QzModal idiom. */

/** Handoff §9 — "Email terms of service": the two links and nothing else.
 *  The sentences around them are fixed (consentWording.ts); both links are
 *  required, because the fixed line always shows both. Every link is checked
 *  as it is typed: a store path resolves on the STORE's domain, a custom link
 *  must be https://, everything else is refused and blocks Save. */
export function TermsModal({
  doc,
  shopDomain,
  storeName,
  onCommit,
  onClose,
}: {
  doc: Quiz;
  shopDomain?: string;
  storeName?: string;
  onCommit: (doc: Quiz) => void;
  onClose: () => void;
}) {
  const cfg = resolveGuided(doc);
  const [tLabel, setTLabel] = useState(cfg.termsLabel);
  const [tUrl, setTUrl] = useState(cfg.termsUrl);
  const [pLabel, setPLabel] = useState(cfg.privacyLabel);
  const [pUrl, setPUrl] = useState(cfg.privacyUrl);
  const terms = checkPolicyLink(tUrl, shopDomain);
  const privacy = checkPolicyLink(pUrl, shopDomain);
  const blocker =
    !tLabel.trim() || !pLabel.trim()
      ? "Give each link its text."
      : !terms.ok || !privacy.ok
        ? "Fix the link above to save."
        : null;
  const hrefs = { terms: terms.ok ? terms.href : undefined, privacy: privacy.ok ? privacy.href : undefined };
  const labels = { terms: tLabel.trim() || DEFAULT_TERMS_LABEL, privacy: pLabel.trim() || DEFAULT_PRIVACY_LABEL };
  const sentence = (parts: readonly WordingPart[]) =>
    parts.map((p, i) => {
      if (typeof p === "string") return p;
      const href = hrefs[p.link];
      return href ? (
        <a key={i} href={href} target="_blank" rel="noopener noreferrer">
          {labels[p.link]}
        </a>
      ) : (
        <u key={i}>{labels[p.link]}</u>
      );
    });
  const linkField = (
    which: "Terms" | "Privacy",
    label: string,
    setLabel: (v: string) => void,
    url: string,
    setUrl: (v: string) => void,
    check: LinkCheck,
    note?: string,
  ) => (
    <div className="qz-rg-fld">
      <div className="qz-rg-fl">{which === "Terms" ? "Terms" : "Privacy Policy"}</div>
      <input
        className="qz-input"
        value={label}
        placeholder="Link text"
        aria-label={`${which} link text`}
        onChange={(e) => setLabel(e.target.value)}
        style={{ marginBottom: 6 }}
      />
      <input
        className="qz-input"
        value={url}
        placeholder={which === "Terms" ? DEFAULT_TERMS_PATH : DEFAULT_PRIVACY_PATH}
        aria-label={`${which} link`}
        aria-invalid={!check.ok}
        onChange={(e) => setUrl(e.target.value)}
      />
      <div className={`qz-rg-linkstat${check.ok ? " is-ok" : " is-err"}`}>
        {check.ok ? (
          <>
            <span>{check.onStore ? "A page on your store" : "A page on another site"}</span>
            <a href={check.href} target="_blank" rel="noopener noreferrer">
              Open ↗
            </a>
          </>
        ) : (
          <span>{check.why}</span>
        )}
      </div>
      {note ? <div className="qz-rg-cap">{note}</div> : null}
    </div>
  );
  return (
    <QzModal
      open
      onClose={onClose}
      size="md"
      title="Email terms of service"
      footer={
        <>
          {blocker ? <span className="qz-rg-saveblock">{blocker}</span> : null}
          <button type="button" className="qz-btn qz-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="qz-btn qz-btn-accent"
            disabled={Boolean(blocker)}
            onClick={() => {
              if (blocker) return;
              onCommit(
                patchGuided(doc, {
                  termsLabel: tLabel.trim(),
                  termsUrl: tUrl.trim(),
                  privacyLabel: pLabel.trim(),
                  privacyUrl: pUrl.trim(),
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
      <p className="qz-rg-grpnote">
        Where each link points. The “By continuing…” line and the SMS wording are set.
      </p>
      {linkField("Terms", tLabel, setTLabel, tUrl, setTUrl, terms)}
      {linkField(
        "Privacy",
        pLabel,
        setPLabel,
        pUrl,
        setPUrl,
        privacy,
        "Must include your business address and how to reach you — the email sign-up relies on it.",
      )}
      <div className="qz-rg-fld">
        <div className="qz-rg-fl">
          What shoppers see <span className="qz-rg-lockt">🔒 The legal lines are fixed</span>
        </div>
        <div className="qz-rg-termspv">
          <p>{sentence(cfg.captureTermsMode === "checkbox" ? TERMS_BOX : TERMS_LINE)}</p>
          {cfg.consentOn ? <p>{unsubscribeLine(storeName)}</p> : null}
        </div>
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

/** Handoff §6 — the extra-picks picker. Picking IS the switch: saving
 *  writes the products and `extrasOn: picks > 0` together, and the first pick
 *  writes the shelf's heading and copy (the live quiz has no copy of its own).
 *  Products only in this release; collection and tag sources need the
 *  `extrasSource` key (handoff §6 schema gap). */
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
  const [picked, setPicked] = useState<string[]>(cfg.extrasOn ? [...cfg.extrasProductIds] : []);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const rows = (q ? productIndex.filter((p) => p.title.toLowerCase().includes(q)) : productIndex).slice(0, 60);
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const stored = doc.rec_page_settings?.global;
  return (
    <QzModal
      open
      onClose={onClose}
      size="md"
      title="Show these products after all results"
      footer={
        <>
          <button type="button" className="qz-btn qz-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="qz-btn qz-btn-accent"
            onClick={() => {
              const first = picked.length > 0 && !cfg.extrasOn;
              onCommit(
                patchGuided(doc, {
                  extrasProductIds: picked,
                  extrasOn: picked.length > 0,
                  ...(first && stored?.extrasHeading === undefined
                    ? { extrasHeading: EXTRAS_FIRST_PICK.extrasHeading }
                    : {}),
                  ...(first && stored?.extrasCopy === undefined
                    ? { extrasCopy: EXTRAS_FIRST_PICK.extrasCopy }
                    : {}),
                }),
              );
              onClose();
            }}
          >
            Save picks
          </button>
        </>
      }
    >
      <input
        className="qz-input"
        value={query}
        placeholder="Search products"
        aria-label="Search products"
        onChange={(e) => setQuery(e.target.value)}
        style={{ marginBottom: 10 }}
      />
      <div className="qz-rg-selbar">
        <b>{picked.length}</b>&nbsp;selected · shown under the matches
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
    </QzModal>
  );
}
