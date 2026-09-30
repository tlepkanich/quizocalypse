import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

/* D24 — the RecTray measure (LogicQuestionWidget.tsx RecTray: ResizeObserver
   + document.fonts.ready) as a reusable hook, in the two shapes the mock
   draws:

   "one" (mock fitRow) — ONE row, never more: trailing items collapse into
     "+N more". Items flagged armed never collapse (B52: what is armed from
     "+N more" is always one of the trailing chips, and hiding it again the
     moment it was picked left nothing saying what was waiting).
   "two" (mock fitTwoRows) — at most TWO rows. Unpicked items go behind
     "See N more" first; only picks that still don't fit follow, counted as
     "See N more · P picked".

   DOM contract (works with React-rendered children):
     • the container's items carry  data-fit-id="<stable id>"
       plus  data-fit-armed  (one-row) / data-fit-picked (two-row) when set;
     • one "more" control inside the container carries  data-fit-more  and
       renders its label as a SINGLE text child: {fit.moreLabel};
     • render  hidden={fit.hidden.has(id)}  on items and
       hidden={!fit.showMore}  on the more control.
   The hook measures by toggling `hidden` and the more label's text node in
   place, ends with the DOM in exactly the state it then returns, and React
   re-renders to the same values — so React and the DOM never disagree.
   One-row containers must not wrap (flex-wrap: nowrap; overflow: hidden). */

export type RowFitMode = "one" | "two";

export type RowFitResult = {
  hidden: ReadonlySet<string>;
  /** Items collapsed behind the more control (unpicked + picked). */
  moreCount: number;
  /** Two-row mode: picked items among the collapsed ones. */
  pickedHidden: number;
  moreLabel: string;
  showMore: boolean;
};

export type FitOneItem = { id: string; armed: boolean };
export type FitTwoItem = { id: string; picked: boolean };

export const oneRowLabel = (n: number): string => `+${n} more`;
export const twoRowLabel = (n: number, picked: number): string =>
  `See ${n + picked} more` + (picked ? ` · ${picked} picked` : "");

/** Nothing collapsed. The label is never empty, so the more control always
    keeps the one text node the measure writes into. */
const emptyFit = (mode: RowFitMode): RowFitResult => ({
  hidden: new Set(),
  moreCount: 0,
  pickedHidden: 0,
  moreLabel: mode === "one" ? oneRowLabel(0) : twoRowLabel(0, 0),
  showMore: false,
});

/** Pure one-row fit. `overflows(hidden, moreLabel)` measures the row with
    those items hidden and the more control showing `moreLabel` (null =
    more control hidden). */
export function fitOneRow(
  items: readonly FitOneItem[],
  overflows: (hidden: ReadonlySet<string>, moreLabel: string | null) => boolean,
): RowFitResult {
  const hidden = new Set<string>();
  if (!overflows(hidden, null)) return emptyFit("one");
  let n = 0;
  let label = oneRowLabel(1);
  for (let i = items.length - 1; i >= 0 && overflows(hidden, label); i--) {
    const it = items[i]!;
    if (it.armed) continue;
    hidden.add(it.id);
    n++;
    label = oneRowLabel(n);
  }
  if (n === 0) return emptyFit("one");
  return { hidden, moreCount: n, pickedHidden: 0, moreLabel: label, showMore: true };
}

/** Pure two-row fit. `rows(hidden, moreLabel)` counts the rows the wrapped
    container takes with those items hidden (null = more control hidden). */
export function fitTwoRows(
  items: readonly FitTwoItem[],
  rows: (hidden: ReadonlySet<string>, moreLabel: string | null) => number,
): RowFitResult {
  const hidden = new Set<string>();
  if (rows(hidden, null) <= 2) return emptyFit("two");
  let n = 0;
  let p = 0;
  let label = twoRowLabel(0, 0);
  for (const pass of [false, true]) {
    for (let i = items.length - 1; i >= 0 && rows(hidden, label) > 2; i--) {
      const it = items[i]!;
      if (hidden.has(it.id) || it.picked !== pass) continue;
      hidden.add(it.id);
      if (pass) p++;
      else n++;
      label = twoRowLabel(n, p);
    }
  }
  if (!n && !p) return emptyFit("two");
  return { hidden, moreCount: n + p, pickedHidden: p, moreLabel: label, showMore: true };
}

function sameResult(a: RowFitResult, b: RowFitResult): boolean {
  if (a.moreLabel !== b.moreLabel || a.showMore !== b.showMore || a.hidden.size !== b.hidden.size) return false;
  for (const id of a.hidden) if (!b.hidden.has(id)) return false;
  return true;
}

/** Put the container in the measured state: items hidden per `hidden`, the
    more control shown with `label` (or hidden when null). */
function applyFit(
  itemEls: readonly HTMLElement[],
  more: HTMLElement | null,
  hidden: ReadonlySet<string>,
  label: string | null,
) {
  for (const el of itemEls) el.hidden = hidden.has(el.dataset.fitId ?? "");
  if (!more) return;
  more.hidden = label === null;
  if (label === null) return;
  const text = more.firstChild;
  // Mutate the existing text node (never replace it) so React's reference
  // to it stays valid.
  if (more.childNodes.length === 1 && text && text.nodeType === Node.TEXT_NODE) {
    if (text.nodeValue !== label) text.nodeValue = label;
  }
}

function distinctRowCount(container: HTMLElement): number {
  const tops = new Set<number>();
  for (const child of Array.from(container.children)) {
    if (child instanceof HTMLElement && !child.hidden) tops.add(child.offsetTop);
  }
  return tops.size;
}

/** Measure `containerRef` and report which items to hide. Re-measures on
    container resize, when web fonts finish loading, and when `deps` change
    (pass the list of ids/flags you render). */
export function useRowFit(
  containerRef: RefObject<HTMLElement | null>,
  { mode, deps = [] }: { mode: RowFitMode; deps?: readonly unknown[] },
): RowFitResult {
  const [result, setResult] = useState<RowFitResult>(() => emptyFit(mode));
  const resultRef = useRef(result);
  resultRef.current = result;

  const measure = useCallback(() => {
    const box = containerRef.current;
    if (!box) return;
    const itemEls = Array.from(box.querySelectorAll<HTMLElement>("[data-fit-id]"));
    const more = box.querySelector<HTMLElement>("[data-fit-more]");
    let next: RowFitResult;
    if (!more) {
      next = emptyFit(mode);
      applyFit(itemEls, null, next.hidden, null);
    } else if (mode === "one") {
      const items = itemEls.map((el) => ({ id: el.dataset.fitId ?? "", armed: el.hasAttribute("data-fit-armed") }));
      next = fitOneRow(items, (hidden, label) => {
        applyFit(itemEls, more, hidden, label);
        return box.scrollWidth > box.clientWidth + 1;
      });
    } else {
      const items = itemEls.map((el) => ({ id: el.dataset.fitId ?? "", picked: el.hasAttribute("data-fit-picked") }));
      next = fitTwoRows(items, (hidden, label) => {
        applyFit(itemEls, more, hidden, label);
        return distinctRowCount(box);
      });
    }
    // End in exactly the state we report.
    applyFit(itemEls, more, next.hidden, next.showMore ? next.moreLabel : null);
    if (!sameResult(resultRef.current, next)) {
      resultRef.current = next;
      setResult(next);
    }
  }, [containerRef, mode]);

  useLayoutEffect(() => {
    measure();
    const box = containerRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(box);
    let live = true;
    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    fonts?.ready
      ?.then(() => {
        if (live) measure();
      })
      .catch(() => {
        // fonts.ready never rejects in practice; measure anyway so a font
        // failure can't leave a stale fit.
        if (live) measure();
      });
    return () => {
      live = false;
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps is the caller's render signature
  }, [measure, containerRef, ...deps]);

  return result;
}
