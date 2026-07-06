import { useMemo, useRef, useState } from "react";
import type { Quiz as QuizDoc } from "../../../lib/quizSchema";
import { pathReportHash, isPathReportStale } from "../../../lib/pathReportMeta";

// LOGIC v2 §7 / L2-12c — the Tier-2 advisory AI-review flow, extracted from
// PathReportPanel so the Step-3 health popover can reuse it without the
// overlay shell. Semantics preserved exactly (adversarially reviewed):
// synchronous single-flight ref guard, flush-before-read, staleness hash
// computed CLIENT-side over the request-time doc, one sparse commit against
// the LATEST doc.
export function usePathQuality({
  doc,
  quizId,
  onCommit,
  onFlush,
}: {
  doc: QuizDoc;
  quizId: string;
  /** Persists the advisory result into the draft (funnel useQuizDraft autosave). */
  onCommit: (doc: QuizDoc) => void;
  /** Flush the pending autosave so the server reviews the LIVE draft, not stale. */
  onFlush: () => void;
}) {
  // Race guard (the useQuizDraft beginAiEdit class): the fetch takes seconds and
  // the merchant may keep editing; compose the commit against the LATEST doc.
  const docRef = useRef(doc);
  docRef.current = doc;
  const [aiState, setAiState] = useState<
    { state: "idle" | "busy" } | { state: "error"; message: string }
  >({ state: "idle" });
  // Synchronous single-flight (a React-state check can double-fire on a rapid
  // double-click before the "busy" state commits — a wasted paid AI call).
  const inFlight = useRef(false);
  const report = doc.path_report_ai;
  const currentHash = useMemo(() => pathReportHash(doc), [doc]);
  const isStale = isPathReportStale(report, currentHash);

  const runReview = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setAiState({ state: "busy" });
    // Flush the pending autosave so the server reviews the merchant's LIVE draft,
    // not a debounced-stale one; snapshot the reviewed structure NOW so the
    // stored staleness hash is anchored to exactly what the rows describe (a
    // during-fetch edit then correctly re-flags stale).
    onFlush();
    const reviewedHash = pathReportHash(docRef.current);
    try {
      const res = await fetch("/api/path-quality", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quizId }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        review?: { outcome_id: string; verdict: string; note: string }[];
        meta?: { at: string; hash: string };
        error?: string;
      };
      if (!body.ok || !body.review || !body.meta) {
        setAiState({ state: "error", message: body.error ?? "Quality review failed — try again." });
        return;
      }
      // One sparse commit against the CURRENT doc (nothing else touched). The
      // hash is CLIENT-computed over the reviewed structure — NOT the server's
      // meta.hash, which could be a debounced-stale snapshot → a spurious "stale"
      // banner the instant the review lands.
      onCommit({
        ...docRef.current,
        path_report_ai: { at: body.meta.at, hash: reviewedHash, rows: body.review },
      });
      setAiState({ state: "idle" });
    } catch {
      setAiState({ state: "error", message: "Quality review failed — try again." });
    } finally {
      inFlight.current = false;
    }
  };

  return {
    /** The stored advisory review (doc.path_report_ai), if any. */
    report,
    busy: aiState.state === "busy",
    error: aiState.state === "error" ? aiState.message : null,
    isStale,
    runReview,
  };
}
