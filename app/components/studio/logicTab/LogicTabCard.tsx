import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { Quiz, Answer } from "../../../lib/quizSchema";
import type { BuilderCategory, BuilderCollection } from "../../builder/stepProps";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import type { OrderedQuestion } from "../../../lib/questionOrder";
import { answerNextNode } from "../../../lib/pathAnalyzer";
import { moveDecisionRule, removeDecisionRule } from "../../../lib/quizMutations";
import { answerFilterValues, filterAnswerMatchCount } from "../../../lib/filterMatching";
import { ruleTargets } from "../../../lib/recommendDecider";
import { ProductCountButton, QuestionRoleControl, RouteMenuButton } from "./LogicTabMenus";
import { useQzToast } from "../../qz-toast";
import { CreateRuleModal } from "./CreateRuleModal";
import { QuestionWindow } from "./QuestionWindow";
import { ExplainerSheet, type ExplainerKind } from "./Explainers";
import { derivedNarrowLabel, narrowFieldOptions } from "./logicTabFields";

// ════════════════════════════════════════════════════════════════════════════
// Logic tab (docs/design/logic-tab/HANDOFF.md §2/§3/§5 + DECISIONS.md) — the
// Rules-then-Questions view. QRTZ-G3 (owner feedback on the Quartz artifact,
// shared.mjs screenLogic): TWO stacked cards — a Rules card above a Questions
// card, exactly as the artifact draws them — replacing the earlier one-card
// form with its internal divider. QRTZ-H3 (owner order 2026-08-13): the whole
// screen is mock-EXACT — per-card explain buttons, "Add rule", the mock's
// rule-row anatomy, the FIVE-column table (key inside Answer), the mock's
// .tag mapcell treatment, .count-btn counts, .goto-val routes. The wrapper
// keeps the historical
// `data-testid="logic-tab-card"` so health/publish deep links and probes
// (`[data-testid="logic-tab-card"] [data-node-id]`) resolve unchanged.
// Decider docs only — legacy docs never reach this component
// (BuilderLogicView dispatch).
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;

// Vocabulary (QRTZ-OB1, GAPS §A item 7 — the mock's set replaced HANDOFF §1's):
// Picks the result / Narrows / Asked only; Show / Highlight / Exclude.
// Never: decider, bucket, boost, weight, score. Role names live in
// logicTabFields.ROLE_JOBS — every surface reads them from there.
// G4 wiring: action absent = Show (replace) · "show" = Highlight · "hide" =
// Exclude. "prioritize" has no verb in this design (unexposed; render plainly
// if an old doc carries it).
function ruleVerb(action: "show" | "hide" | "prioritize" | undefined): string {
  if (!action) return "show";
  if (action === "show") return "highlight";
  if (action === "hide") return "exclude";
  return "prioritize";
}

// §3.3 — a target that is not a product gets a trailing muted kind.
function targetKind(cat: BuilderCategory | undefined): string | null {
  if (!cat) return null;
  if (cat.source === "collection") return "collection";
  if (cat.source === "tag") return "tag";
  if (cat.source === "metafield") return "metafield";
  return null;
}

export function LogicTabCard({
  doc,
  questions,
  categories,
  collections,
  productIndex,
  commit,
  quizId,
  lastSyncAt,
  shopifyAdminDomain,
}: {
  doc: QuizDoc;
  questions: OrderedQuestion[];
  categories: BuilderCategory[];
  collections: BuilderCollection[];
  productIndex: IndexedProduct[];
  /** P3+ — the editing seam. Absent = read-only (previews, tests). */
  commit?: (doc: QuizDoc) => void;
  /** P5 — enables + Create rule (the ensure-targets endpoint needs it). */
  quizId?: string;
  /** QRTZ-B2 — Shop.lastSyncAt (ISO) for the products popover's sync line. */
  lastSyncAt?: string | null;
  /** QRTZ-B2 — the Shopify ADMIN domain for the popover's Open-in-Shopify
   *  link (null on an unconnected standalone workspace → no link). */
  shopifyAdminDomain?: string | null;
}) {
  const toast = useQzToast();
  // P5 — categories materialized by the create-rule modal, merged until the
  // route loader's next pass returns them (autosave revalidation).
  const [extraCats, setExtraCats] = useState<BuilderCategory[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  // UNIFIED one-window — the question window: ONE window element, two
  // contents (unified/_v.js render): opening one closes the other.
  const [qwin, setQwin] = useState<{ nodeId: string; answerId: string | null } | null>(null);
  // Latest-doc seam for the modal's post-await commit (review L2-5).
  const docRef = useRef(doc);
  docRef.current = doc;
  // §7 — the stepped explainer sheets; null = closed.
  const [explainer, setExplainer] = useState<ExplainerKind | null>(null);
  const allCategories = useMemo(() => {
    const seen = new Set(categories.map((c) => c.id));
    return [...categories, ...extraCats.filter((c) => !seen.has(c.id))];
  }, [categories, extraCats]);
  const catById = useMemo(
    () => new Map(allCategories.map((c) => [c.id, c])),
    [allCategories],
  );
  const colTitleById = useMemo(
    () => new Map(collections.map((c) => [c.collectionId, c.title])),
    [collections],
  );
  const qIndexByNodeId = useMemo(
    () => new Map(questions.map((q) => [q.node.id, q.qIndex])),
    [questions],
  );
  const rules = useMemo(() => doc.decision_rules ?? [], [doc.decision_rules]);
  // §3.3 — a freshly created rule gets a brief highlight for 1800 ms.
  const [freshRuleId, setFreshRuleId] = useState<string | null>(null);
  const knownRuleIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(rules.map((r) => r.id));
    const prev = knownRuleIds.current;
    knownRuleIds.current = ids;
    if (!prev) return;
    const added = rules.find((r) => !prev.has(r.id));
    if (!added) return;
    setFreshRuleId(added.id);
    const t = setTimeout(() => setFreshRuleId(null), 1800);
    return () => clearTimeout(t);
  }, [rules]);
  // §3.2 — "switched on" = role is not Asked only (Picks-the-result counts).
  const switchedOn = questions.filter(
    (q) => q.node.data.role === "decides" || q.node.data.role === "filter",
  ).length;
  // QRTZ-H5 — one inventory sweep for the whole table (the role control only
  // needs the boolean; the dialog recomputes rows itself, and only while
  // open) + the decider's question number for the role menu's "now on QN".
  const hasNarrowFields = useMemo(
    () => narrowFieldOptions(productIndex).length > 0,
    [productIndex],
  );
  const deciderQIndex =
    questions.find((q) => q.node.data.role === "decides")?.qIndex ?? null;
  // QRTZ-S6 — rule drag-reorder (mock s14 "Drag a rule up"; Layers-tab BT4
  // pattern: dragId + hover index, drop-line class). The ↑/↓ buttons stay as
  // the keyboard/a11y path; both routes end in the same moveDecisionRule.
  const [dragRuleId, setDragRuleId] = useState<string | null>(null);
  const [overRuleIx, setOverRuleIx] = useState<number | null>(null);

  return (
    // QRTZ-G3 — the artifact's two cards, stacked, and nothing else (the
    // role-flip teaching note is retired; the card meta sentences teach now).
    <div className="qz-ltab-stack" data-testid="logic-tab-card">
    <section className="qz-ltab">
      <header className="qz-ltab-hd">
        <h2>Rules</h2>
        {/* QRTZ-S6 — mock s14 .card-meta, verbatim (no vocabulary clash). */}
        <p className="qz-ltab-hdmeta">
          Run first, in order. A rule that matches overrides the questions below.
        </p>
        {/* QRTZ-H3 — mock .explain-btn per card (shared.mjs 357/375): the
            owner's exact-match order overrules §3.1's equal-width ruling. */}
        <button
          type="button"
          className="qz-ltab-how"
          onClick={() => setExplainer("rules")}
        >
          <span className="qz-ltab-how-ico" aria-hidden>
            ✦
          </span>
          How rules work
        </button>
        {commit && quizId ? (
          <button
            type="button"
            className="qz-btn qz-btn-primary qz-btn-sm qz-ltab-create"
            onClick={() => {
              setQwin(null);
              setCreateOpen(true);
            }}
          >
            Add rule
          </button>
        ) : null}
      </header>
      {commit && quizId ? (
        <CreateRuleModal
          doc={doc}
          questions={questions}
          categories={allCategories}
          collections={collections}
          productIndex={productIndex}
          quizId={quizId}
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          commit={commit}
          onCategoriesCreated={(cats) => setExtraCats((prev) => [...prev, ...cats])}
          getLatestDoc={() => docRef.current}
        />
      ) : null}
      {commit && qwin
        ? (() => {
            const wq = questions.find((x) => x.node.id === qwin.nodeId);
            return wq ? (
              <QuestionWindow
                key={`${qwin.nodeId}:${qwin.answerId ?? ""}`}
                doc={doc}
                q={wq}
                questions={questions}
                categories={allCategories}
                collections={collections}
                productIndex={productIndex}
                initialAnswerId={qwin.answerId}
                onClose={() => setQwin(null)}
                commit={commit}
              />
            ) : null;
          })()
        : null}
      {rules.length === 0 ? (
        <p className="qz-ltab-empty">
          <span className="qz-ltab-muted">—</span>{" "}
          {switchedOn === 0 ? (
            <>
              No rules yet. And no question is switched on — so every shopper
              sees the same products.
            </>
          ) : (
            <>
              No rules yet. Your <b>{switchedOn}</b> switched-on{" "}
              {switchedOn === 1 ? "question is" : "questions are"} below deciding
              everything.
            </>
          )}
        </p>
      ) : (
        <ol className="qz-ltab-rules">
          {rules.map((rule, i) => (
            <li
              key={rule.id}
              className={`qz-ltab-rrow${rule.id === freshRuleId ? " is-fresh" : ""}${
                dragRuleId === rule.id ? " is-dragging" : ""
              }${
                overRuleIx === i && dragRuleId && dragRuleId !== rule.id
                  ? " is-drop-target"
                  : ""
              }`}
              draggable={commit ? true : undefined}
              onDragStart={
                commit
                  ? (e) => {
                      setDragRuleId(rule.id);
                      e.dataTransfer.effectAllowed = "move";
                    }
                  : undefined
              }
              onDragOver={
                commit
                  ? (e) => {
                      if (!dragRuleId) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (overRuleIx !== i) setOverRuleIx(i);
                    }
                  : undefined
              }
              onDrop={
                commit
                  ? (e) => {
                      e.preventDefault();
                      if (dragRuleId && dragRuleId !== rule.id)
                        commit(moveDecisionRule(doc, dragRuleId, i));
                      setDragRuleId(null);
                      setOverRuleIx(null);
                    }
                  : undefined
              }
              onDragEnd={
                commit
                  ? () => {
                      setDragRuleId(null);
                      setOverRuleIx(null);
                    }
                  : undefined
              }
            >
              {/* QRTZ-H3 — the mock's row anatomy (shared.mjs 362–366):
                  number · sentence · delete. The mock draws NO grip and no
                  ↑/↓; drag rides the row itself (the number is the natural
                  handle), and the keyboard reorder path stays in the tree as
                  visually-hidden buttons (a11y — hidden visually only). */}
              <span
                className="qz-ltab-rnum"
                title={commit ? "Drag to reorder" : undefined}
              >
                {i + 1}
              </span>
              <p className="qz-ltab-sentence">
                <RuleSentence
                  rule={rule}
                  questions={questions}
                  catById={catById}
                />
              </p>
              {commit ? (
                <span className="qz-ltab-ractions">
                  {/* §3.3 — order IS priority; keyboard reorder (DECISIONS). */}
                  <button
                    type="button"
                    className="qz-ltab-rmove"
                    aria-label="Move rule up"
                    disabled={i === 0}
                    onClick={() => commit(moveDecisionRule(doc, rule.id, i - 1))}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="qz-ltab-rmove"
                    aria-label="Move rule down"
                    disabled={i === rules.length - 1}
                    onClick={() => commit(moveDecisionRule(doc, rule.id, i + 1))}
                  >
                    ↓
                  </button>
                  {/* Delete looks the rule up BY ID, never by row index.
                      Mock .icon-btn × (215), revealed on row hover. */}
                  <button
                    type="button"
                    className="qz-ltab-ricon"
                    aria-label={`Delete rule ${i + 1}`}
                    onClick={() => {
                      commit(removeDecisionRule(doc, rule.id));
                      // UNIFIED (unified/_v.js data-del) — deletion toasts.
                      toast("Rule deleted");
                    }}
                  >
                    ×
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}

    </section>

    <section className="qz-ltab">
      <header className="qz-ltab-hd">
        <h2>Questions</h2>
        {/* QRTZ-OB1 — mock s14 .card-meta verbatim (shared.mjs line 374;
            GAPS §A item 7 reversed owner call 8c). */}
        <p className="qz-ltab-hdmeta">
          Each question either picks the result or narrows on one product
          attribute.
        </p>
        <button
          type="button"
          className="qz-ltab-how"
          onClick={() => setExplainer("questions")}
        >
          <span className="qz-ltab-how-ico" aria-hidden>
            ✦
          </span>
          How questions work
        </button>
      </header>
      <ExplainerSheet
        kind={explainer ?? "rules"}
        open={explainer !== null}
        onClose={() => setExplainer(null)}
        onSwap={setExplainer}
      />
      {/* QRTZ-H3 — the mock's FIVE-column .ltable (shared.mjs 379–414): the
          A/B/C key renders INSIDE the Answer cell (.akey), widths ride the
          mock's own cells (qcell 210px · Maps-to 34% · goto 158px), one
          tbody per question (mock .qgroup — its rules draw the group rule
          and zero the group-last hairline). */}
      <div className="qz-ltab-tblwrap">
        <table className="qz-ltab-tbl">
          <thead>
            <tr>
              <th scope="col">Question</th>
              <th scope="col">Answer</th>
              {/* QRTZ-OB1 — mock ltable head, verbatim (shared.mjs 384). */}
              <th scope="col">Maps to</th>
              <th scope="col" className="qz-ltab-num">
                Products
              </th>
              <th scope="col">Then go to</th>
            </tr>
          </thead>
          {questions.map((q) => (
            <QuestionRows
              key={q.node.id}
              doc={doc}
              q={q}
              questions={questions}
              catById={catById}
              colTitleById={colTitleById}
              productIndex={productIndex}
              qIndexByNodeId={qIndexByNodeId}
              commit={commit}
              deciderQIndex={deciderQIndex}
              hasNarrowFields={hasNarrowFields}
              lastSyncAt={lastSyncAt}
              shopifyAdminDomain={shopifyAdminDomain}
              onOpenWindow={
                commit
                  ? (nodeId, answerId) => {
                      setCreateOpen(false);
                      setQwin({ nodeId, answerId });
                    }
                  : undefined
              }
            />
          ))}
        </table>
      </div>
    </section>
    </div>
  );
}

// QRTZ-H3 sentence grammar — the mock's row copy, exactly (shared.mjs 350,
// 364): "When they pick" (muted) · answer CHIPS (.ans) joined by the small-
// caps AND (.op) · the → arrow · the coloured verb · plain comma-joined
// targets · one trailing muted kind. AND-only v1 (DECISIONS G2); is_not
// renders in the .op form ("not" — no mock drawing; kept from the product).
function RuleSentence({
  rule,
  questions,
  catById,
}: {
  rule: NonNullable<QuizDoc["decision_rules"]>[number];
  questions: OrderedQuestion[];
  catById: Map<string, BuilderCategory>;
}) {
  const answerLabel = (questionId: string, answerId: string) => {
    const q = questions.find((x) => x.node.id === questionId);
    const a = q?.node.data.answers.find((x) => x.id === answerId);
    return a?.text ?? null;
  };
  const targets = ruleTargets(rule);
  const verb = ruleVerb(rule.action);
  // Mock rules carry ONE trailing kind (rule 1 "collection", rule 4 "tag");
  // mixed-kind target lists have no drawing — the kind is shown only when
  // every target agrees on it.
  const kinds = targets.map((tid) => targetKind(catById.get(tid)));
  const kind =
    kinds.length > 0 && kinds[0] !== null && kinds.every((k) => k === kinds[0])
      ? kinds[0]
      : null;
  return (
    <>
      <span className="qz-ltab-rwhen">When they pick</span>{" "}
      {rule.conditions.map((c, i) => {
        const label = answerLabel(c.question_id, c.answer_id);
        return (
          <Fragment key={`${c.question_id}:${c.answer_id}:${i}`}>
            {i > 0 ? (
              <>
                {" "}
                <span className="qz-ltab-op">and</span>{" "}
              </>
            ) : null}
            {c.op === "is_not" ? (
              <>
                <span className="qz-ltab-op">not</span>{" "}
              </>
            ) : null}
            {label ? (
              <b className="qz-ltab-ans">{label}</b>
            ) : (
              // Dangling reference (DECISIONS "additions") — flagged, never
              // silently dropped.
              <b className="qz-ltab-bad">(deleted answer)</b>
            )}
          </Fragment>
        );
      })}{" "}
      <span className="qz-ltab-arrow" aria-hidden>
        →
      </span>{" "}
      <span className={`qz-ltab-verb is-${verb}`}>{verb}</span>{" "}
      {targets.map((tid, i) => {
        const cat = catById.get(tid);
        return (
          <Fragment key={tid}>
            {i > 0 ? ", " : ""}
            {cat ? (
              cat.name
            ) : (
              <b className="qz-ltab-bad">(deleted target)</b>
            )}
          </Fragment>
        );
      })}
      {kind ? (
        <>
          {" "}
          <span className="qz-ltab-rkind">{kind}</span>
        </>
      ) : null}
    </>
  );
}

function QuestionRows({
  doc,
  q,
  questions,
  catById,
  colTitleById,
  productIndex,
  qIndexByNodeId,
  commit,
  deciderQIndex,
  hasNarrowFields,
  lastSyncAt,
  shopifyAdminDomain,
  onOpenWindow,
}: {
  doc: QuizDoc;
  q: OrderedQuestion;
  questions: OrderedQuestion[];
  catById: Map<string, BuilderCategory>;
  colTitleById: Map<string, string>;
  productIndex: IndexedProduct[];
  qIndexByNodeId: Map<string, number>;
  commit?: (doc: QuizDoc) => void;
  /** QRTZ-H5 — the role menu's "now on QN" hint + dialog gating. */
  deciderQIndex: number | null;
  hasNarrowFields: boolean;
  /** QRTZ-B2 — threaded to the products popover (sync line + admin link). */
  lastSyncAt?: string | null;
  shopifyAdminDomain?: string | null;
  /** UNIFIED — opens the question window (every mapping cell). */
  onOpenWindow?: (nodeId: string, answerId: string | null) => void;
}) {
  const role = q.node.data.role;
  const answers = q.node.data.answers;
  const total = productIndex.length;
  const keys = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  // QRTZ-OB1 (GAPS §A item 7) — the mock's role vocabulary: "Picks the
  // result" (◆ gone, shared.mjs line 316) · "Narrows" with the DERIVED
  // attribute in the mock's .attr-slot beneath (role-stack, lines 398–401)
  // · "Asked only" (line 1034). QRTZ-H5 (owner unification): the pill opens
  // the SHARED role menu (the mock's role popover — QuestionRoleControl,
  // identical to the Overview's) and the attr-slot opens the SHARED
  // attribute dialog, never the QuestionWindow. The window stays the Logic
  // page's one answer-MAPPING editor, reached through the mapping cells.
  const pillLabel =
    role === "decides" ? (
      <>Picks the result</>
    ) : role === "filter" ? (
      <>Narrows</>
    ) : (
      <>Asked only</>
    );
  const pillClass = role === "decides" ? " is-start" : "";
  const narrowLabel = role === "filter" ? derivedNarrowLabel(answers) : null;
  const roleStack = commit ? (
    <QuestionRoleControl
      variant="table"
      doc={doc}
      node={q.node}
      qIndex={q.qIndex}
      deciderQIndex={deciderQIndex}
      productIndex={productIndex}
      hasNarrowFields={hasNarrowFields}
      onCommit={commit}
    />
  ) : (
    // Read-only (previews, tests) — the same stack as static spans.
    <div className="qz-ltab-rolestack">
      <span className={`qz-ltab-pill${pillClass}`}>{pillLabel}</span>
      {narrowLabel === null ? null : (
        <span className="qz-ap-slot" title={`narrows on ${narrowLabel}`}>
          <span>
            narrows on <b>{narrowLabel}</b>
          </span>
        </span>
      )}
    </div>
  );
  const qcell = (rowSpan: number) => (
    <th scope="rowgroup" rowSpan={rowSpan} className="qz-ltab-qcell">
      <span className="qz-ltab-qtext" title={q.node.data.text}>
        {q.node.data.text}
      </span>
      {roleStack}
    </th>
  );

  // A question with no answers (freeform types) still needs its row — the
  // role pill must stay reachable from this tab (review L2-8).
  if (answers.length === 0) {
    return (
      <tbody className="qz-ltab-qgroup">
        <tr className="qz-ltab-qstart" data-node-id={q.node.id}>
          {qcell(1)}
          <td className="qz-ltab-muted" colSpan={4}>
            no answer options
          </td>
        </tr>
      </tbody>
    );
  }

  return (
    <tbody className="qz-ltab-qgroup">
      {answers.map((a, i) => {
        const mapping = (
          <MappingCell role={role} answer={a} catById={catById} colTitleById={colTitleById} />
        );
        const count = (
          <ProductsCell
            role={role}
            answer={a}
            catById={catById}
            count={filterAnswerMatchCount(a, productIndex)}
            total={total}
          />
        );
        const route = <RouteCell doc={doc} q={q} answer={a} qIndexByNodeId={qIndexByNodeId} />;
        return (
          <tr
            key={a.id}
            className={i === 0 ? "qz-ltab-qstart" : undefined}
            data-node-id={i === 0 ? q.node.id : undefined}
          >
            {i === 0 ? qcell(answers.length) : null}
            {/* QRTZ-H3 — the mock folds the key INTO the answer cell
                (.akey span, shared.mjs 405). */}
            <td className="qz-ltab-answer" title={a.text}>
              <span className="qz-ltab-akey">{keys[i] ?? i + 1}</span>
              <span className="qz-ltab-atext">{a.text}</span>
            </td>
            <td className="qz-ltab-acts">
              {/* UNIFIED — every Maps-to cell is the same door: it opens
                  the question window focused on this answer. Asked-only cells
                  are buttons too, at reduced opacity. */}
              {onOpenWindow ? (
                <button
                  type="button"
                  className={`qz-ltab-cellbtn qz-qwin-mapcell${
                    role !== "decides" && role !== "filter" ? " qz-qwin-dimcell" : ""
                  }`}
                  onClick={() => onOpenWindow(q.node.id, a.id)}
                >
                  {mapping}
                </button>
              ) : (
                mapping
              )}
            </td>
            <td className="qz-ltab-count qz-ltab-num">
              {commit && (role === "decides" || role === "filter") ? (
                <ProductCountButton
                  answer={a}
                  role={role}
                  catById={catById}
                  productIndex={productIndex}
                  label={count}
                  answerKey={keys[i] ?? String(i + 1)}
                  lastSyncAt={lastSyncAt}
                  shopifyAdminDomain={shopifyAdminDomain}
                />
              ) : (
                <span className="qz-ltab-countval">{count}</span>
              )}
            </td>
            <td className="qz-ltab-goto">
              {commit ? (
                <RouteMenuButton
                  doc={doc}
                  q={q}
                  answer={a}
                  questions={questions}
                  commit={commit}
                  label={route}
                />
              ) : (
                route
              )}
            </td>
          </tr>
        );
      })}
    </tbody>
  );
}

// QRTZ-H3 — the "Maps to" cell is the mock's .acts treatment and no more
// (owner's exact-match order, shared.mjs 406 + base.mjs .tag): value tags in
// the ONE quartz tag tone, collections in the accent is-col tone, and the
// mock's only empty-state form — the bordered "No filter" is-none tag
// (quartz --tag-none-style: normal). Every tag renders (the 3+"+N" overflow
// cap is gone), space-separated as the mock joins them. The per-field hue
// system is retired on this surface. States the mock never draws keep the
// product's flags: a deciding answer with no target ("pick what it opens")
// and a deleted target stay crit-coloured.
function MappingCell({
  role,
  answer,
  catById,
  colTitleById,
}: {
  role: "decides" | "qualifier" | "filter" | undefined;
  answer: Answer;
  catById: Map<string, BuilderCategory>;
  colTitleById: Map<string, string>;
}) {
  if (role === "decides") {
    if (!answer.target_id)
      return <span className="qz-ltab-bad">pick what it opens</span>;
    const cat = catById.get(answer.target_id);
    return cat ? (
      <span className="qz-ltab-tag is-col">{cat.name}</span>
    ) : (
      <span className="qz-ltab-bad">(deleted target)</span>
    );
  }
  if (role === "filter") {
    const v = answerFilterValues(answer);
    // No preference AND not-yet-mapped both apply no filter — the mock's
    // is-none form covers both; the Products column keeps the "not set"
    // flag on the unmapped case.
    if (answer.no_preference || !v)
      return <span className="qz-ltab-tag is-none">No filter</span>;
    const chips: Array<{ key: string; tone: "a" | "col"; label: string }> = [];
    for (const t of answer.tags) {
      const i = t.indexOf(":");
      chips.push({
        key: `t:${t}`,
        tone: "a",
        label: i > 0 && i < t.length - 1 ? t.slice(i + 1) : t,
      });
    }
    for (const cid of v.collectionIds)
      chips.push({ key: `c:${cid}`, tone: "col", label: colTitleById.get(cid) ?? cid });
    for (const m of answer.metafield_filters ?? [])
      chips.push({ key: `m:${m.key}:${m.value}`, tone: "a", label: m.value });
    for (const vf of answer.variant_filters ?? [])
      chips.push({ key: `v:${vf.name}:${vf.value}`, tone: "a", label: vf.value });
    for (const pt of answer.product_type_filters ?? [])
      chips.push({ key: `p:${pt}`, tone: "a", label: pt });
    return (
      <>
        {chips.map((c, i) => (
          <Fragment key={c.key}>
            {i > 0 ? " " : ""}
            <span className={`qz-ltab-tag is-${c.tone}`}>{c.label}</span>
          </Fragment>
        ))}
      </>
    );
  }
  // Asked-only — no products ride it, so the truthful mock form is the same
  // "No filter" is-none tag (the cell stays dimmed by qz-qwin-dimcell).
  return <span className="qz-ltab-tag is-none">No filter</span>;
}

// QRTZ-H3 — the Products cell is the mock's .count-btn content (shared.mjs
// 407): the MATCH count, then "products" as the small muted word. The "N /
// total" fraction is retired — the mock's own margin note argues it claims a
// narrowing that has not happened. No-preference answers match everything →
// the full total. States the mock never draws keep the product's flags:
// unmapped narrows read "not set" (crit), zero-match numbers go crit.
function ProductsCell({
  role,
  answer,
  catById,
  count,
  total,
}: {
  role: "decides" | "qualifier" | "filter" | undefined;
  answer: Answer;
  catById: Map<string, BuilderCategory>;
  count: number | null;
  total: number;
}) {
  const word = (n: number) => (n === 1 ? "product" : "products");
  if (role === "decides") {
    const cat = answer.target_id ? catById.get(answer.target_id) : undefined;
    if (!cat) return <span className="qz-ltab-muted">·</span>;
    const n = cat.productIds.length;
    return (
      <>
        {n === 0 ? <span className="qz-ltab-bad">0</span> : n}
        <span className="qz-ltab-countword">{word(n)}</span>
      </>
    );
  }
  if (role === "filter") {
    if (answer.no_preference)
      return (
        <>
          {total}
          <span className="qz-ltab-countword">{word(total)}</span>
        </>
      );
    if (count === null) return <span className="qz-ltab-bad">not set</span>;
    return (
      <>
        {count === 0 ? <span className="qz-ltab-bad">0</span> : count}
        <span className="qz-ltab-countword">{word(count)}</span>
      </>
    );
  }
  return <span className="qz-ltab-muted">·</span>;
}

// §5.4 — "Then go to": next question (muted) · → Q4 · → results. Content
// steps (message / product-cards / …) between questions are walked through —
// the merchant routes between QUESTIONS; the logic surfaces never number
// content steps (questionOrder's rule).
function RouteCell({
  doc,
  q,
  answer,
  qIndexByNodeId,
}: {
  doc: QuizDoc;
  q: OrderedQuestion;
  answer: Answer;
  qIndexByNodeId: Map<string, number>;
}) {
  let nextId = answerNextNode(doc, q.node.id, answer.edge_handle_id);
  // Bounded walk past non-question, non-terminal steps (a cycle can't recurse
  // forever — routing is forward-only, but stay defensive on malformed docs).
  for (let hops = 0; nextId && hops < 24; hops++) {
    const cur = nextId;
    if (qIndexByNodeId.has(cur)) break;
    const node = doc.nodes.find((n) => n.id === cur);
    if (!node || node.type === "result" || node.type === "end") break;
    nextId = doc.edges.find((e) => e.source === cur)?.target ?? null;
  }
  if (!nextId) return <span className="qz-ltab-muted">—</span>;
  const nextQ = qIndexByNodeId.get(nextId);
  // QRTZ-H3 — the mock's .goto-val form (shared.mjs 408, base.mjs 700): the
  // → prefix rides the CSS ::before; labels are "Next question" / "Results".
  // A skip route ("Q4") has no mock drawing — it keeps the product's Q-number
  // in the same goto-val dress.
  if (nextQ === undefined) return <span className="qz-ltab-gotoval">Results</span>;
  if (nextQ === q.qIndex + 1)
    return <span className="qz-ltab-gotoval">Next question</span>;
  return <span className="qz-ltab-gotoval">Q{nextQ}</span>;
}
