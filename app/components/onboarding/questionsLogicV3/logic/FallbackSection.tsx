import { useMemo, useState } from "react";
import type { z } from "zod";
import type { Quiz } from "../../../../lib/quizSchema";
import type { IndexedProduct } from "../../../../lib/recommendationEngine";
import type { BuilderCollection } from "../../../builder/stepProps";

type QuizDoc = z.infer<typeof Quiz>;
type Mode = "best_sellers" | "collection" | "featured";

/* QZY-2 (quiz-logic dev-handoff v1.2 §9) — the empty-case fallback chooser:
   what shows when a shopper's answers resolve to ZERO products. Deliberately
   small — exactly three options, set once. Collapsed shows the choice as a
   pill. Boundaries (spec): OOS handling lives in Settings; results
   PRESENTATION lives in step 04 — neither is configurable here. Writes
   doc.global_fallback (QZY-1 mode chooser; the engine's zero-match path
   resolves it). */

const MODE_LABEL: Record<Mode, string> = {
  best_sellers: "Best sellers",
  collection: "A specific collection",
  featured: "Featured picks",
};

export function FallbackSection({
  doc,
  collections,
  productIndex,
  onCommit,
}: {
  doc: QuizDoc;
  collections: BuilderCollection[];
  productIndex: IndexedProduct[];
  onCommit: (doc: QuizDoc) => void;
}) {
  const gf = doc.global_fallback;
  // Absent mode reads as the legacy inference for display purposes.
  const mode: Mode =
    gf.mode ?? (gf.collection_id ? "collection" : gf.product_ids.length ? "featured" : "best_sellers");
  const enabled = gf.enabled;
  const [open, setOpen] = useState(false);
  const [productQuery, setProductQuery] = useState("");

  const patch = (p: Partial<QuizDoc["global_fallback"]>) =>
    onCommit({ ...doc, global_fallback: { ...gf, ...p } });

  const pickMode = (m: Mode) => patch({ enabled: true, mode: m });

  const picked = new Set(gf.product_ids);
  const productMatches = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    if (!q) return [];
    return productIndex.filter((p) => p.title.toLowerCase().includes(q)).slice(0, 6);
  }, [productQuery, productIndex]);

  const pillLabel = enabled ? MODE_LABEL[mode] : "Off";

  return (
    <section className="qz-s3-fallback" aria-label="Fallback">
      <button
        type="button"
        className="qz-s3-fb-head"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="qz-s3-fb-title">Fallback</span>
        <span className="qz-s3-fb-pill">{pillLabel}</span>
        <span className="qz-s3-fb-caret" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open ? (
        <div className="qz-s3-fb-body">
          <p className="qz-s3-fb-note">
            When a shopper&rsquo;s answers match <strong>zero</strong> products, show:
          </p>
          <label className="qz-s3-fb-opt">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => patch({ enabled: e.target.checked })}
            />
            <span>Show a fallback (recommended)</span>
          </label>
          {(["best_sellers", "collection", "featured"] as Mode[]).map((m) => (
            <label key={m} className={`qz-s3-fb-opt is-radio${!enabled ? " is-dim" : ""}`}>
              <input
                type="radio"
                name="qz-fallback-mode"
                disabled={!enabled}
                checked={mode === m}
                onChange={() => pickMode(m)}
              />
              <span>
                {MODE_LABEL[m]}
                {m === "best_sellers" ? (
                  <em className="qz-s3-fb-hint"> — always populated, the safe default</em>
                ) : null}
              </span>
            </label>
          ))}

          {enabled && mode === "collection" ? (
            <select
              className="qz-s3-fb-select"
              value={gf.collection_id ?? ""}
              onChange={(e) => patch({ collection_id: e.target.value || undefined })}
              aria-label="Fallback collection"
            >
              <option value="">Pick a collection…</option>
              {collections.map((c) => (
                <option key={c.collectionId} value={c.collectionId}>
                  {c.title}
                </option>
              ))}
            </select>
          ) : null}

          {enabled && mode === "featured" ? (
            <div className="qz-s3-fb-featured">
              {gf.product_ids.length ? (
                <ul className="qz-s3-fb-picked">
                  {gf.product_ids.map((id) => {
                    const p = productIndex.find((x) => x.product_id === id);
                    return (
                      <li key={id}>
                        <span>{p?.title ?? id}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${p?.title ?? id}`}
                          onClick={() =>
                            patch({ product_ids: gf.product_ids.filter((x) => x !== id) })
                          }
                        >
                          ✕
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="qz-s3-fb-hint">Hand-pick a few products below.</p>
              )}
              <input
                className="qz-input"
                placeholder="Search products…"
                aria-label="Search products for the fallback"
                value={productQuery}
                onChange={(e) => setProductQuery(e.target.value)}
              />
              {productMatches.length ? (
                <ul className="qz-s3-fb-results">
                  {productMatches.map((p) => (
                    <li key={p.product_id}>
                      <button
                        type="button"
                        disabled={picked.has(p.product_id)}
                        onClick={() => {
                          patch({ product_ids: [...gf.product_ids, p.product_id] });
                          setProductQuery("");
                        }}
                      >
                        + {p.title}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <p className="qz-s3-fb-bound">
            Out-of-stock handling is a global Settings default; how results LOOK is Step 4.
            This only picks what shows when nothing matches.
          </p>
        </div>
      ) : null}
    </section>
  );
}
