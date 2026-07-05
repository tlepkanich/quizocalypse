import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Quiz } from "../../lib/quizSchema";
import { appendBankQuestion } from "../../lib/quizMutations";
import {
  QUESTION_BANK,
  bankCategories,
  filterBank,
  type BankQuestion,
  type BankQuestionType,
} from "../../lib/questionBank";

type QuizDoc = Quiz;

// Question-Builder spec (Question Bank) — a right-side drawer of pre-built library
// questions. Search + type-filter; industry sections first (priorityCategory from
// brand identity), Universal last. "+ Add to quiz" appends the question (default
// answers, fresh ids) via appendBankQuestion; the merchant edits + maps from there.
// Hand-rolled overlay (scrim + Esc) — the project's modal convention.
export function QuestionBankDrawer({
  doc,
  onCommit,
  onClose,
  priorityCategory,
}: {
  doc: QuizDoc;
  onCommit: (doc: QuizDoc) => void;
  onClose: () => void;
  priorityCategory?: string;
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<BankQuestionType | "all">("all");
  // Live local doc so "✓ Added" updates as questions are added without closing.
  const [working, setWorking] = useState<QuizDoc>(doc);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const existingTexts = useMemo(() => {
    const set = new Set<string>();
    for (const n of working.nodes) {
      if (n.type === "question") set.add(n.data.text.trim().toLowerCase());
    }
    return set;
  }, [working]);

  const filtered = useMemo(() => filterBank(query, type), [query, type]);
  const categories = useMemo(() => bankCategories(priorityCategory), [priorityCategory]);

  const add = (entry: BankQuestion) => {
    const next = appendBankQuestion(working, {
      text: entry.text,
      question_type: entry.question_type,
      answers: entry.answers,
    });
    setWorking(next);
    onCommit(next);
  };

  const TYPE_LABEL: Record<BankQuestionType | "all", string> = {
    all: "All",
    single_select: "Single",
    multi_select: "Multi",
    rating: "Rating",
  };

  const overlay = (
    <>
      <div
        onClick={onClose}
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(17,17,17,.32)",
          zIndex: 1000,
        }}
      />
      <aside
        role="dialog"
        aria-label="Question bank"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(420px, 92vw)",
          background: "var(--qz-bg, #fff)",
          borderLeft: "1px solid var(--qz-rule, #e5e5e5)",
          boxShadow: "-12px 0 34px rgba(17,17,17,.12)",
          zIndex: 1001,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header
          className="qz-row qz-row-between"
          style={{ padding: "14px 16px", borderBottom: "1px solid var(--qz-rule, #e5e5e5)" }}
        >
          <strong style={{ fontSize: 15 }}>Question library</strong>
          <button type="button" className="qz-btn qz-btn-ghost qz-btn-sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
          <input
            className="qz-input"
            placeholder="Search questions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ fontSize: 13 }}
            autoFocus
          />
          <div className="qz-row" style={{ gap: 4, flexWrap: "wrap" }}>
            {(["all", "single_select", "multi_select", "rating"] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={`qz-btn qz-btn-sm ${type === t ? "qz-btn-accent" : "qz-btn-ghost"}`}
                style={{ fontSize: 11, padding: "2px 8px" }}
                aria-pressed={type === t}
                onClick={() => setType(t)}
              >
                {TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 20px" }}>
          {filtered.length === 0 ? (
            <p className="qz-dim" style={{ fontSize: 13 }}>No questions match “{query}”.</p>
          ) : (
            categories
              .map((cat) => ({ cat, items: filtered.filter((q) => q.category === cat) }))
              .filter(({ items }) => items.length > 0)
              .map(({ cat, items }) => (
                <section key={cat} style={{ marginTop: 14 }}>
                  <div className="qz-label" style={{ fontSize: 11, marginBottom: 6 }}>
                    {cat}
                    {priorityCategory === cat ? " · matched to your store" : ""}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {items.map((entry) => {
                      const added = existingTexts.has(entry.text.trim().toLowerCase());
                      return (
                        <div
                          key={entry.id}
                          className="qz-card"
                          style={{ padding: 10, display: "flex", flexDirection: "column", gap: 6 }}
                        >
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{entry.text}</div>
                          <div className="qz-dim" style={{ fontSize: 11.5 }}>
                            {entry.question_type === "single_select"
                              ? "Single select"
                              : entry.question_type === "multi_select"
                                ? "Multi-select"
                                : "Rating"}{" "}
                            · {entry.answers.length} option{entry.answers.length === 1 ? "" : "s"}
                          </div>
                          <button
                            type="button"
                            className={`qz-btn qz-btn-sm ${added ? "qz-btn-ghost" : "qz-btn-accent"}`}
                            style={{ alignSelf: "flex-start", fontSize: 12 }}
                            onClick={() => add(entry)}
                          >
                            {added ? "✓ Added (add again)" : "+ Add to quiz"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))
          )}
          <p className="qz-dim" style={{ fontSize: 11, marginTop: 16 }}>
            {QUESTION_BANK.length} library questions · added questions land at the end of your
            quiz, ready to edit + map.
          </p>
        </div>
      </aside>
    </>
  );

  // Portal to <body> so the drawer escapes the builder's stacking contexts — the
  // preview pane uses container-type/zoom-transform, which trap an in-flow
  // position:fixed overlay and let the canvas intercept clicks on the drawer.
  return typeof document === "undefined" ? overlay : createPortal(overlay, document.body);
}
