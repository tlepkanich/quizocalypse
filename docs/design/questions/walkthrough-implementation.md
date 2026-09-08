# WIS-025 — Questions walkthrough (8 September 2026)

The active decider Questions stage is a single-screen walkthrough: cover,
questions and message screens, Email, then Overview. Legacy quizzes still use
QuestionsLogicLayout. Step3Shell's phone content branch and its dependencies
are retained, inactive, for the owner's future A/B test; no experiment runs yet.

Owner request: Slack functionality-requests, 1788858519.460109. Inline capture
was explicitly included by owner reply 1788859307.260399. References:
[walkthrough mock](https://claude.ai/code/artifact/f8f0bca3-7d03-4d9c-984a-f80b966a40d2)
and [handoff](https://claude.ai/code/artifact/3219ac4d-5010-4815-b6fc-a1fe91270465).
The handoff's older claims about loading, custom CTA, optional capture and
marketing consent had already been fixed in August; those paths are preserved.

## Behavior and ownership

- Question text, answers, type, ordering, composer and delete use existing pure
  document mutations. Regenerate uses the existing server/undo bracket with a
  confirmation and retry. Review coverage is mount-local state, never autosaved.
- Early Overview is read-only. At the terminus its Open actions return to each
  editor. The Email chip stays present when collection is off.
- Questions and Results placement controls share global settings and mutation
  invariants. Results retains wording, policy links, discounts and loading detail.
  Changing placement preserves previously authored copy. Existing marketing
  consent remains separate from terms and SMS evidence.
- Before/inline/none selection explicitly synchronizes email and placement.
  Choosing inline writes optional `captureInlineOn: true`; historical inline
  values keep their previous gate behavior until the merchant chooses inline.
- New checkbox and notice modes are optional schema fields. Absent terms mode
  preserves the old checkbox DOM; absent SMS mode preserves the old phone input.
  New mode/text fields clear when their collection switch turns off; the screen
  remembers the mode within the current mount. Old terms wording is retained.
- Notice placeholders render safe React text/links; relative policy links resolve
  against the shop domain with an http(s) allowlist. No chrome token was added.
- Captures record the displayed terms/SMS sentence, mode and affirmative checkbox
  state with a server timestamp. Notice is recorded as `checked: false`, not an
  affirmative opt-in. The migration adds nullable evidence/time columns; no
  existing capture rows are rewritten. Evidence is submitted client state, not
  independent proof of identity.
- Inline submission leaves results visible and reports save failure with retry.
  Its defaults describe saving details. Outbound email/webhook delivery remains
  deferred in the pre-existing /captures implementation.
- Inherited email_gate nodes are excluded from the walk and block decider
  publication with a removal instruction. Existing published documents are
  not rewritten or runtime-migrated.

## Adversarial review

**Runtime/compatibility lens:** an old inline-plus-email document must not lose a
pre-results gate merely on deployment. The explicit opt-in and shared
`captureMode` predicate protect both rendering and the AI-copy eligibility gate.
No defaults were added to the schema or runtime config. Before-change deployed
legacy and decider fixtures were rendered locally with the same public payload:
normalized outerHTML matched at both intros, all four question screens, and both
capture screens (8 states). Five additional capture configurations matched the
capture DOM from deployed revision a0264b7. Existing CTA, skip, loading and
marketing-consent behavior was retained.

**Persistence/failure lens:** raw settings writers could bypass phone-requires-email;
both now use setRecPageGlobal. Consent payload validation matches the schema's
500-character SMS bound; notice never claims a checked box. Server timestamps
are generated only after validation. Inline failures show retry instead of false
success. Real route/DB probes verify terms and SMS separately across all four
placement/mode combinations and restore their fixture/shop state afterward.

## Verification

- Unit/schema checks cover optional-field round trips, consent cascades, sparse
  edits, legacy gate predicates, editor coverage, destructive confirmations,
  safe links, independent SMS opt-in and inline save failure.
- `e2e/q3-questions-verify.mjs`: 20 real autosave, composer, deletion and stage checks.
- `e2e/q3-logic-verify.mjs`: 31 preserved Logic checks, independently entered with
  the to-logic HTTP intent. The old phone probe's Logic coverage was not deleted.
- `e2e/q3-capture-verify.mjs`: original Results wiring/negative controls plus
  before/inline × checkbox/notice capture evidence, mobile overflow and AI-copy
  eligibility. AI copy is stubbed in this local probe to avoid spending credits.
- Screenshots reviewed for desktop Questions/Email, 22-question strip, mobile
  Questions/Email, regeneration confirmation and published inline notice capture.
- The standard live smoke uncovered a stale analytics assertion reading
  `topProducts`; the current loader returns `data.products`. The test now checks
  that existing response contract and seeds the engagement event required by the
  current session cohort, without changing application analytics.
- Release requires the full unpiped gate chain, successful CI/deploy smoke, and
  the legacy published JSON pin `c02ccaec98a0fe9e`.
