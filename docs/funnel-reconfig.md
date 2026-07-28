# Funnel reconfig — three separate entry flows (owner spec, 2026-07-25)

Owner decision: resolve "what type of quiz" BEFORE the builder; the builder
pre-populates and the merchant mainly reviews/approves. Shape is REMOVED as a
funnel step in all flows and its generation machinery is repurposed (flow 3).

## Flow 1 — "Write Your Goal" (main homepage CTA)
- Pre-step on the homepage: merchant writes their goal.
- AI chooses best products from that goal; merchant refines/edits/changes the
  selection (the recs surface, pre-populated).
- On confirm: AI populates the REST of the quiz (type/template choice becomes
  an invisible AI auto-pick — the old Shape middle passes run headless) and
  lands the merchant directly on the Questions tab.
- REMOVE the recs→next-step pop-up ("generate with AI / write your goal /
  start from blank") from this flow.

## Flow 2 — Manual (/ upload later)
- The normal manual process, unchanged in shape: recs → the existing pop-up
  (AI generate / write your goal / start from blank) → Questions tab.
- Upload: when a document is uploaded, pre-populate the builder from it —
  DEFERRED until the rest works well. Do not build yet.

## Flow 3 — "Generate Quiz Templates" (separate homepage option)
- Homepage option generates 2–3 VERY DIFFERENT templates (the existing Shape
  template-generation mechanism, repurposed).
- Clicking a template enters the normal flow PRE-POPULATED, starting on the
  recs page.
- On product confirm: NO "how do you want to start" pop-up — straight to the
  Questions tab.

## Implementation notes / assumptions (flag if wrong)
- The funnel stage machine loses `shape`; `question_range`/scoring defaults
  the shape-continue intent used to set move into each flow's confirm path.
- The AUDIT-5 start-modal (start-modal-flow.html build) survives ONLY in
  flow 2.
- PORT-10's 8 starter-template rail (currently on Shape) relocates to the
  flow-3 homepage surface alongside the generated candidates.
- Legacy points-model docs and all published quizzes are untouched; this is
  create-flow only. Byte pin invariant applies as always.
- Phasing: FLOW-1 first (homepage goal CTA + AI product pre-pick + headless
  populate + land-on-questions), then FLOW-3 (template homepage option +
  shape retirement), then FLOW-2 cleanup (pop-up survives only there).
