import { useEffect, useMemo, useState } from "react";
import { useFetcher } from "@remix-run/react";
import type { Quiz } from "../../lib/quizSchema";
import {
  extractTranslatableStrings,
  sourceHashOf,
  LOCALE_RE,
} from "../../lib/quizTranslate";
import { QzButton } from "../qz";

// ════════════════════════════════════════════════════════════════════════════
// TranslationsPanel (Phase K) — generate and manage per-locale overlays.
// Clone of the ReviewEnrichPanel shape: collapsible right-rail card, fetcher →
// intent, onApply(doc) adopts the returned draft. Staleness is computed
// CLIENT-SIDE: hash the live doc's extracted English and compare with each
// locale's source_hash — only real copy changes flag a locale as outdated.
// ════════════════════════════════════════════════════════════════════════════

type TranslateResponse =
  | { ok: true; action: "translate-quiz" | "remove-locale"; doc: Quiz; locale: string; translated?: number }
  | { ok: false; error?: string };

const COMMON_LOCALES = ["fr", "de", "es", "it", "nl", "pt", "pt-br", "ja", "sv", "da"];

export function TranslationsPanel({
  doc,
  onApply,
  previewUrl,
}: {
  doc: Quiz;
  onApply: (doc: Quiz) => void;
  previewUrl: string;
}) {
  const fetcher = useFetcher<TranslateResponse>();
  const [open, setOpen] = useState(false);
  const [locale, setLocale] = useState("");
  const busy = fetcher.state !== "idle";
  const result = fetcher.data;

  useEffect(() => {
    if (fetcher.state === "idle" && result?.ok && result.doc) onApply(result.doc);
  }, [fetcher.state, result, onApply]);

  // Current English fingerprint — compared against each locale's source_hash.
  const currentHash = useMemo(() => sourceHashOf(extractTranslatableStrings(doc)), [doc]);
  const locales = Object.entries(doc.translations ?? {});

  const submit = (intent: "translate-quiz" | "remove-locale", loc: string) => {
    const form = new FormData();
    form.set("intent", intent);
    form.set("locale", loc);
    fetcher.submit(form, { method: "POST" });
  };

  const valid = LOCALE_RE.test(locale.trim());

  return (
    <div className="qz-card" style={{ padding: 14, marginBottom: 16 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="qz-row qz-row-between"
        style={{ width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0 }}
      >
        <strong style={{ fontSize: 14 }}>🌐 Translations</strong>
        <span className="qz-dim" style={{ fontSize: 12 }}>
          {locales.length > 0 ? `${locales.map(([l]) => l).join(", ")} · ` : ""}
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open ? (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <p className="qz-dim" style={{ fontSize: 12, margin: 0 }}>
            AI-translate every question, answer, result, and interface string. Shoppers get the
            locale via <code>?locale=</code> on the quiz link (the theme embed passes the
            storefront language automatically once redeployed). Translate after your first publish
            for full coverage of AI-written bullets and tooltips.
          </p>

          {locales.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {locales.map(([loc, entry]) => {
                const stale = entry.source_hash !== undefined && entry.source_hash !== currentHash;
                return (
                  <div key={loc} className="qz-row qz-row-between" style={{ alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>
                      {loc}
                      {stale ? (
                        <span
                          className="qz-dim"
                          style={{ fontWeight: 400, fontSize: 11, marginLeft: 6 }}
                          title="The English copy changed since this translation was generated"
                        >
                          ⚠ outdated
                        </span>
                      ) : null}
                    </span>
                    <span className="qz-row" style={{ gap: 6 }}>
                      <a
                        href={`${previewUrl}?locale=${encodeURIComponent(loc)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="qz-btn qz-btn-ghost qz-btn-sm"
                        title="Opens the PUBLISHED quiz in this locale"
                      >
                        Preview ↗
                      </a>
                      <button
                        className="qz-btn qz-btn-ghost qz-btn-sm"
                        disabled={busy}
                        onClick={() => submit("translate-quiz", loc)}
                        title="Re-translate from the current English copy"
                      >
                        ↻
                      </button>
                      <button
                        className="qz-btn qz-btn-ghost qz-btn-sm"
                        disabled={busy}
                        onClick={() => submit("remove-locale", loc)}
                        title="Remove this locale"
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="qz-row" style={{ gap: 8, alignItems: "center" }}>
            <input
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              placeholder="fr, de, pt-br…"
              list="qz-locales"
              style={{
                flex: 1,
                font: "inherit",
                fontSize: 13,
                padding: "8px 10px",
                borderRadius: "var(--qz-radius)",
                border: "1px solid #00000022",
              }}
            />
            <datalist id="qz-locales">
              {COMMON_LOCALES.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
            <QzButton
              size="sm"
              variant="accent"
              disabled={busy || !valid}
              onClick={() => {
                submit("translate-quiz", locale.trim().toLowerCase());
                setLocale("");
              }}
            >
              {busy ? "Translating…" : "Generate"}
            </QzButton>
          </div>

          {result?.ok === false && result.error ? (
            <span className="qz-dim" style={{ fontSize: 12 }}>⚠ {result.error}</span>
          ) : result?.ok && result.action === "translate-quiz" ? (
            <span className="qz-dim" style={{ fontSize: 12 }}>
              ✓ {result.locale}: {result.translated} strings translated — publish to take it live.
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
