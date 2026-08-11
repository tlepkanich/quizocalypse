/* ── The states the screens never show at rest ─────────────────────────
   Found by auditing the product, not by imagining what might exist. Each
   one has code behind it today and no design:

     Autosave      app/components/studio/useQuizDraft.ts exposes isSaving,
                   savedAt, saveError and retrySave, plus a pause seam
                   (beginAiEdit / applyAiResult / endAiEdit). Every mock
                   shows only the "Saved" case.
     Generation    app/lib/funnelLoader.server.ts:213 — genStalled fires
                   after 200s with no write during typing/templating, and
                   the retry-gen intent is the escape. Never drawn.
     Publish       app/lib/quizPublish.ts:103 — PublishError carries
                   issues: Array<{path, message}> and BLOCKS. Never drawn.
     Empty         Zero quizzes, and a filter that matches nothing. Only
                   the first-run home empty state existed.
   ──────────────────────────────────────────────────────────────────── */

const ico = (d) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

const I = {
  spin: `<path d="M12 3a9 9 0 1 0 9 9"/>`,
  check: `<path d="m4.5 12.5 5 5 10-11"/>`,
  warn: `<path d="M12 8v5"/><circle cx="12" cy="16.5" r=".9" fill="currentColor" stroke="none"/><path d="M10.3 3.9 2.7 17.2A2 2 0 0 0 4.4 20.2h15.2a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>`,
  pause: `<path d="M9 5v14M15 5v14"/>`,
  clock: `<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>`,
  empty: `<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M3.5 10h17"/>`,
  search: `<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>`,
};

export const STATE_GALLERY_CSS = String.raw`
/* The gallery: each real state, drawn, with what triggers it underneath. */
.sg { display: grid; gap: 18px; }
.sg-group > h3 {
  font-size: 11px; font-weight: var(--fw-bold); letter-spacing: .1em; text-transform: uppercase;
  color: var(--ink-3); margin: 26px 0 10px;
}
.sg-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(268px, 1fr)); gap: 14px; }
.sg-card { border: 1px solid var(--line); border-radius: var(--r-lg); overflow: hidden; background: var(--surface); }
.sg-demo { padding: 20px 18px; background: var(--surface-2); border-bottom: 1px solid var(--line);
  display: grid; place-items: center; min-height: 106px; }
.sg-meta { padding: 11px 14px; }
.sg-meta b { display: block; font-size: 13.5px; font-weight: var(--fw-semi); }
.sg-meta p { margin-top: 3px; font-size: 12.5px; line-height: 1.5; color: var(--ink-3); }
.sg-meta code { font-family: var(--font-ui); font-weight: var(--fw-semi); color: var(--accent-ink); font-size: 12px; }

/* ── Autosave chip — four states on one component ─────────────────── */
.sv { display: inline-flex; align-items: center; gap: 7px; font-size: 13px;
  font-weight: var(--fw-med); color: var(--ink-3); }
.sv svg { width: 14px; height: 14px; flex: none; }
.sv.is-saved { color: var(--ok); }
.sv.is-saving .sv-spin { animation: sv-rot 900ms linear infinite; transform-origin: 12px 12px; }
@keyframes sv-rot { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .sv.is-saving .sv-spin { animation: none; } }
.sv.is-error { color: var(--crit); }
.sv-retry {
  margin-left: 2px; padding: 3px 9px; border-radius: var(--r-sm);
  border: 1px solid var(--crit); background: var(--surface); color: var(--crit);
  font-size: 12px; font-weight: var(--fw-semi); cursor: pointer;
}
.sv-retry:hover { background: var(--crit-wash); }
.sv.is-paused { color: var(--accent-ink); }

/* ── Generation stalled ──────────────────────────────────────────── */
.gs { width: 100%; max-width: 340px; padding: 16px; border-radius: var(--r-lg);
  border: 1px solid var(--warn-line); background: var(--warn-wash); }
.gs-top { display: flex; align-items: center; gap: 9px; font-size: 13.5px;
  font-weight: var(--fw-semi); color: var(--warn-ink); }
.gs-top svg { width: 16px; height: 16px; flex: none; }
.gs p { margin-top: 7px; font-size: 12.5px; line-height: 1.55; color: var(--ink-2); }
.gs-acts { display: flex; gap: 7px; margin-top: 12px; }
.gs-acts button {
  padding: 7px 13px; border-radius: var(--btn-r); font-size: 13px; font-weight: var(--fw-semi);
  border: 1px solid var(--line-strong); background: var(--surface); color: var(--ink); cursor: pointer;
}
.gs-acts button.is-primary { background: var(--ink); border-color: var(--ink); color: var(--page); }

/* ── Publish blocked ─────────────────────────────────────────────── */
.pb { width: 100%; max-width: 360px; border-radius: var(--r-lg);
  border: 1px solid var(--crit); background: var(--surface); overflow: hidden; }
.pb-top { display: flex; align-items: center; gap: 9px; padding: 11px 14px;
  background: var(--crit-wash); border-bottom: 1px solid var(--crit);
  font-size: 13.5px; font-weight: var(--fw-semi); color: var(--crit); }
.pb-top svg { width: 16px; height: 16px; flex: none; }
.pb ul { list-style: none; margin: 0; padding: 4px 0; }
.pb li { display: grid; grid-template-columns: auto 1fr; gap: 9px; align-items: baseline;
  padding: 8px 14px; font-size: 12.5px; line-height: 1.5; color: var(--ink-2); }
.pb li + li { border-top: 1px solid var(--line); }
.pb li b { font-size: 11px; font-weight: var(--fw-bold); letter-spacing: .05em;
  text-transform: uppercase; color: var(--ink-3); white-space: nowrap; }
.pb-foot { padding: 10px 14px; border-top: 1px solid var(--line); font-size: 12.5px; color: var(--ink-3); }

/* ── Empty ───────────────────────────────────────────────────────── */
.mt { display: grid; justify-items: center; gap: 9px; text-align: center; padding: 6px 10px; }
.mt-ico { width: 34px; height: 34px; display: grid; place-items: center; border-radius: var(--r-md);
  background: var(--surface); border: 1px solid var(--line); color: var(--ink-3); }
.mt-ico svg { width: 17px; height: 17px; }
.mt b { font-size: 13.5px; font-weight: var(--fw-semi); }
.mt p { font-size: 12.5px; line-height: 1.5; color: var(--ink-3); max-width: 30ch; }
.mt button { margin-top: 3px; padding: 7px 13px; border-radius: var(--btn-r);
  border: 1px solid var(--line-strong); background: var(--surface);
  font-size: 13px; font-weight: var(--fw-semi); color: var(--ink); cursor: pointer; }
`;

const card = (demo, title, trigger) => `
      <article class="sg-card">
        <div class="sg-demo">${demo}</div>
        <div class="sg-meta"><b>${title}</b><p>${trigger}</p></div>
      </article>`;

export const stateGallery = () => `
  <div class="sg">

    <div class="sg-group">
      <h3>Autosave &mdash; four states, one chip</h3>
      <div class="sg-grid">
        ${card(
          `<span class="sv is-saving"><svg class="sv-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">${I.spin}</svg>Saving&hellip;</span>`,
          "Saving",
          `<code>isSaving</code>. Appears only after the 700ms debounce fires, so typing never flickers the chip.`)}
        ${card(
          `<span class="sv is-saved">${ico(I.check)}Saved</span>`,
          "Saved",
          `<code>savedAt</code> set. The only state any mock showed before this audit.`)}
        ${card(
          `<span class="sv is-error">${ico(I.warn)}Not saved<button class="sv-retry" type="button">Retry</button></span>`,
          "Save failed",
          `<code>saveError</code>. Never auto-dismiss and never fade &mdash; it persists until a retry succeeds, because the merchant's work is only in the tab.`)}
        ${card(
          `<span class="sv is-paused">${ico(I.pause)}Paused while AI edits</span>`,
          "Paused",
          `<code>beginAiEdit()</code>. Autosave is deliberately suspended so a debounced PUT cannot land a stale doc mid-call.`)}
      </div>
    </div>

    <div class="sg-group">
      <h3>Generation &mdash; when it does not come back</h3>
      <div class="sg-grid">
        ${card(
          `<div class="gs">
            <div class="gs-top">${ico(I.clock)}This is taking longer than usual</div>
            <p>Still working, but it has been over three minutes. You can wait, start again, or pick a template instead.</p>
            <div class="gs-acts"><button class="is-primary" type="button">Start again</button><button type="button">Use a template</button></div>
          </div>`,
          "Generation stalled",
          `<code>genStalled</code> &mdash; 200s with no write during <code>typing</code>/<code>templating</code>. The escape is the <code>retry-gen</code> intent. Offer it; do not poll forever.`)}
        ${card(
          `<div class="mt">
            <span class="mt-ico">${ico(I.warn)}</span>
            <b>We could not draft this one</b>
            <p>Nothing was lost &mdash; your goal is still here. Try again, or build it yourself.</p>
            <button type="button">Try again</button>
          </div>`,
          "Generation failed",
          `Distinct from stalled: the job came back empty or errored. In production this is usually depleted AI credits, so the copy must not blame the merchant's input.`)}
      </div>
    </div>

    <div class="sg-group">
      <h3>Publish &mdash; the gate that blocks</h3>
      <div class="sg-grid">
        ${card(
          `<div class="pb">
            <div class="pb-top">${ico(I.warn)}Two things to fix before publishing</div>
            <ul>
              <li><b>Q4</b><span>Every answer needs somewhere to go. Two are unconnected.</span></li>
              <li><b>Results</b><span>Referenced bucket was deleted.</span></li>
            </ul>
            <p class="pb-foot">Publishing stays disabled until both are resolved.</p>
          </div>`,
          "Publish blocked",
          `<code>PublishError</code> carries <code>issues: {path, message}[]</code>. Each row is one issue and each <b>path is a node id</b> &mdash; make it a link that scrolls to and selects that node.`)}
        ${card(
          `<span class="sv is-saving"><svg class="sv-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">${I.spin}</svg>Publishing&hellip;</span>`,
          "Publishing",
          `The button holds its width and its label; only the leading glyph becomes a ring. A button that resizes mid-action moves everything beside it.`)}
      </div>
    </div>

    <div class="sg-group">
      <h3>Empty &mdash; nothing here, and nothing wrong</h3>
      <div class="sg-grid">
        ${card(
          `<div class="mt">
            <span class="mt-ico">${ico(I.empty)}</span>
            <b>No quizzes yet</b>
            <p>Describe a decision your shoppers have to make and we will draft one.</p>
            <button type="button">Start a quiz</button>
          </div>`,
          "Zero quizzes",
          `The list's own empty state, separate from the first-run home. It appears any time the filter is cleared and there is genuinely nothing.`)}
        ${card(
          `<div class="mt">
            <span class="mt-ico">${ico(I.search)}</span>
            <b>No collections match &ldquo;winter&rdquo;</b>
            <p>Try a shorter word, or switch to Tags.</p>
            <button type="button">Clear search</button>
          </div>`,
          "No results",
          `A filter matching nothing is NOT the same as having nothing &mdash; it names the query, and its action clears the filter rather than creating anything.`)}
      </div>
    </div>

  </div>`;
