import { useEffect, useMemo, useRef, useState } from "react";
import type { Quiz, Answer } from "../../../lib/quizSchema";
import type { BuilderCategory, BuilderCollection } from "../../builder/stepProps";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import type { OrderedQuestion } from "../../../lib/questionOrder";
import { answerNextNode } from "../../../lib/pathAnalyzer";
import { moveDecisionRule, removeDecisionRule } from "../../../lib/quizMutations";
import { answerFilterValues, filterAnswerMatchCount } from "../../../lib/filterMatching";
import { ruleTargets } from "../../../lib/recommendDecider";
import { ProductCountButton, RouteMenuButton } from "./LogicTabMenus";
import { useQzToast } from "../../qz-toast";
import { CreateRuleModal } from "./CreateRuleModal";
import { QuestionWindow } from "./QuestionWindow";
import { ExplainerSheet, type ExplainerKind } from "./Explainers";
import { derivedNarrowLabel, fieldHue } from "./logicTabFields";

// ════════════════════════════════════════════════════════════════════════════
// Logic tab (docs/design/logic-tab/HANDOFF.md §2/§3/§5 + DECISIONS.md) — the
// ONE-card design: Rules above Questions (engine order), divided by a header
// row, sharing row metrics so the two halves read as one list. Decider docs
// only — legacy docs never reach this component (BuilderLogicView dispatch).
//
// Phase 2 = READ-ONLY (build order §13.1): every datum the tab needs — roles,
// mappings, counts, routing — rendered from the live draft. Editing arrives
// with the role/mapping menus (P3), rule delete/reorder (P4) and the
// create-rule modal (P5).
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;

// Locked vocabulary (HANDOFF §1): Starting set / Narrows / Info only;
// Show / Highlight / Exclude. Never: decider, bucket, boost, weight, score.
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
  // §3.2 — "switched on" = role is not Info only (Starting set counts).
  const switchedOn = questions.filter(
    (q) => q.node.data.role === "decides" || q.node.data.role === "filter",
  ).length;
  // QRTZ-S6 — rule drag-reorder (mock s14 "Drag a rule up"; Layers-tab BT4
  // pattern: dragId + hover index, drop-line class). The ↑/↓ buttons stay as
  // the keyboard/a11y path; both routes end in the same moveDecisionRule.
  const [dragRuleId, setDragRuleId] = useState<string | null>(null);
  const [overRuleIx, setOverRuleIx] = useState<number | null>(null);

  return (
    <>
      {/* UNIFIED (unified/_v.js NOTE, the banner above the card): role flips
          never delete a mapping — setQuestionRole leaves the answers' values
          in place, so flipping back restores them. */}
      <p className="qz-ltab-note">
        Each question below says what it does right now. Switch one on and it
        starts ruling products out; switch it off and it is still asked, it
        just stops deciding. <b>Nothing is ever deleted</b> — flip it back and
        the mapping is where you left it.
      </p>
    <section className="qz-ltab" data-testid="logic-tab-card">
      <header className="qz-ltab-hd">
        <h2>Rules</h2>
        {/* QRTZ-S6 — mock s14 .card-meta, verbatim (no vocabulary clash). */}
        <p className="qz-ltab-hdmeta">
          Run first, in order. A rule that matches overrides the questions below.
        </p>
        {/* §3.1 — the same label string on both headers (equal pill width). */}
        <button
          type="button"
          className="qz-ltab-how"
          onClick={() => setExplainer("rules")}
        >
          ✦ How it works
        </button>
        {commit && quizId ? (
          <button
            type="button"
            className="qz-btn qz-btn-primary qz-ltab-create"
            onClick={() => {
              setQwin(null);
              setCreateOpen(true);
            }}
          >
            + Create rule
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
              {commit ? (
                <span className="qz-ltab-rgrip" aria-hidden title="Drag to reorder">
                  ⠿
                </span>
              ) : null}
              <span className="qz-ltab-rnum">{i + 1}</span>
              <span className="qz-ltab-sentence">
                <RuleSentence
                  rule={rule}
                  questions={questions}
                  catById={catById}
                />
              </span>
              {commit ? (
                <span className="qz-ltab-ractions">
                  {/* §3.3 — order IS priority; explicit reorder (DECISIONS). */}
                  <button
                    type="button"
                    className="qz-ltab-rbtn"
                    aria-label="Move rule up"
                    disabled={i === 0}
                    onClick={() => commit(moveDecisionRule(doc, rule.id, i - 1))}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="qz-ltab-rbtn"
                    aria-label="Move rule down"
                    disabled={i === rules.length - 1}
                    onClick={() => commit(moveDecisionRule(doc, rule.id, i + 1))}
                  >
                    ↓
                  </button>
                  {/* Delete looks the rule up BY ID, never by row index. */}
                  <button
                    type="button"
                    className="qz-ltab-rbtn is-del"
                    aria-label="Delete rule"
                    onClick={() => {
                      commit(removeDecisionRule(doc, rule.id));
                      // UNIFIED (unified/_v.js data-del) — deletion toasts.
                      toast("Rule deleted");
                    }}
                  >
                    ✕
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      <header className="qz-ltab-hd qz-ltab-div">
        <h2>Questions</h2>
        {/* QRTZ-S6 — mock s14 .card-meta, in the product's locked vocabulary
            (owner call 8c: "starting set", never "picks the result"). */}
        <p className="qz-ltab-hdmeta">
          Each question either picks the starting set or narrows on one product
          attribute.
        </p>
        <button
          type="button"
          className="qz-ltab-how"
          onClick={() => setExplainer("questions")}
        >
          ✦ How it works
        </button>
      </header>
      <ExplainerSheet
        kind={explainer ?? "rules"}
        open={explainer !== null}
        onClose={() => setExplainer(null)}
        onSwap={setExplainer}
      />
      <table className="qz-ltab-tbl">
        <colgroup>
          <col style={{ width: "17%" }} />
          <col style={{ width: "4%" }} />
          <col style={{ width: "17%" }} />
          {/* §2 — "Shows / narrows" pinned at 36%; the map never reflows. */}
          <col style={{ width: "36%" }} />
          <col style={{ width: "13%" }} />
          <col style={{ width: "13%" }} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Question</th>
            <th scope="col" aria-label="Answer key" />
            <th scope="col">Answer</th>
            <th scope="col">Shows / narrows</th>
            <th scope="col">Products</th>
            <th scope="col">Then go to</th>
          </tr>
        </thead>
        <tbody>
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
        </tbody>
      </table>
    </section>
    </>
  );
}

// §3.3 sentence grammar (read-only): "When they pick <A> and <B>, show
// <Target> (collection)." AND-only v1 (DECISIONS G2); is_not renders as a
// muted "not". Answer labels are bold; joiners are muted.
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
  return (
    <>
      When they pick{" "}
      {rule.conditions.map((c, i) => {
        const label = answerLabel(c.question_id, c.answer_id);
        return (
          <span key={`${c.question_id}:${c.answer_id}:${i}`}>
            {i > 0 ? <span className="qz-ltab-join"> and </span> : null}
            {c.op === "is_not" ? <span className="qz-ltab-join">not </span> : null}
            {label ? (
              <b>{label}</b>
            ) : (
              // Dangling reference (DECISIONS "additions") — flagged, never
              // silently dropped.
              <b className="qz-ltab-bad">(deleted answer)</b>
            )}
          </span>
        );
      })}
      <span className="qz-ltab-join">, </span>
      {ruleVerb(rule.action)}{" "}
      {targets.map((tid, i) => {
        const cat = catById.get(tid);
        const kind = targetKind(cat);
        return (
          <span key={tid}>
            {i > 0 ? <span className="qz-ltab-join"> and </span> : null}
            {cat ? <b>{cat.name}</b> : <b className="qz-ltab-bad">(deleted target)</b>}
            {kind ? <span className="qz-ltab-join"> ({kind})</span> : null}
          </span>
        );
      })}
      .
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
  /** UNIFIED — opens the question window (pill + every mapping cell). */
  onOpenWindow?: (nodeId: string, answerId: string | null) => void;
}) {
  const role = q.node.data.role;
  const answers = q.node.data.answers;
  const total = productIndex.length;
  const keys = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  // UNIFIED — the pill is DERIVED (never stored: narrow_field is no longer
  // written anywhere; the label falls out of the answers' own values) and
  // opens the question window focused on the first answer.
  const pillLabel =
    role === "decides" ? (
      <>◆ Starting set</>
    ) : role === "filter" ? (
      <>Narrows · {derivedNarrowLabel(answers)}</>
    ) : (
      <>Info only</>
    );
  const pillClass =
    role === "decides" ? " is-start" : role === "filter" ? " is-narrow" : "";
  const pill = onOpenWindow ? (
    <button
      type="button"
      className={`qz-ltab-pill${pillClass} qz-ltab-pill-btn`}
      onClick={() => onOpenWindow(q.node.id, answers[0]?.id ?? null)}
    >
      {pillLabel} ▾
    </button>
  ) : (
    <span className={`qz-ltab-pill${pillClass}`}>{pillLabel}</span>
  );

  // A question with no answers (freeform types) still needs its row — the
  // role pill must stay reachable from this tab (review L2-8).
  if (answers.length === 0) {
    return (
      <tr className="qz-ltab-qstart" data-node-id={q.node.id}>
        <td className="qz-ltab-qcell">
          <div className="qz-ltab-qlabel" title={q.node.data.text}>
            <span className="qz-ltab-qnum">Q{q.qIndex}</span> {q.node.data.text}
          </div>
          {pill}
        </td>
        <td className="qz-ltab-key" />
        <td className="qz-ltab-muted" colSpan={4}>
          no answer options
        </td>
      </tr>
    );
  }

  return (
    <>
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
            {i === 0 ? (
              <td className="qz-ltab-qcell" rowSpan={answers.length}>
                <div className="qz-ltab-qlabel" title={q.node.data.text}>
                  <span className="qz-ltab-qnum">Q{q.qIndex}</span> {q.node.data.text}
                </div>
                {pill}
              </td>
            ) : null}
            <td className="qz-ltab-key">{keys[i] ?? i + 1}</td>
            <td className="qz-ltab-answer" title={a.text}>
              {a.text}
            </td>
            <td>
              {/* UNIFIED — every Shows/narrows cell is the same door: it opens
                  the question window focused on this answer. Info-only cells
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
            <td className="qz-ltab-count">
              {commit && (role === "decides" || role === "filter") ? (
                <ProductCountButton
                  answer={a}
                  role={role}
                  catById={catById}
                  productIndex={productIndex}
                  label={count}
                  answerKey={keys[i] ?? String(i + 1)}
                />
              ) : (
                count
              )}
            </td>
            <td>
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
    </>
  );
}

// §5.2 (UNIFIED deltas) — the "Shows / narrows" cell per role. Up to 3 chips
// + a "+N" overflow; field-value chips keep their per-field colour so the
// table reads as before; the "pick anything" invite is gone (unset filter
// cells read "not mapped yet" — the window is the one editor now).
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
      <span className="qz-ltab-chip">{cat.name}</span>
    ) : (
      <span className="qz-ltab-bad">(deleted target)</span>
    );
  }
  if (role === "filter") {
    if (answer.no_preference)
      return <span className="qz-ltab-soft">keeps everything</span>;
    const v = answerFilterValues(answer);
    if (!v) return <span className="qz-ltab-bad">not mapped yet</span>;
    // §11 — each FIELD-shaped value takes its own field's hashed hue; plain
    // tags and collections stay neutral (the field is derived, never stored).
    const chips: Array<{ key: string; hue: number | null; label: string }> = [];
    for (const t of answer.tags) {
      const i = t.indexOf(":");
      if (i > 0 && i < t.length - 1)
        chips.push({
          key: `t:${t}`,
          hue: fieldHue(`tag:${t.slice(0, i).trim().toLowerCase()}`),
          label: t.slice(i + 1),
        });
      else chips.push({ key: `t:${t}`, hue: null, label: t });
    }
    for (const cid of v.collectionIds)
      chips.push({ key: `c:${cid}`, hue: null, label: colTitleById.get(cid) ?? cid });
    for (const m of answer.metafield_filters ?? [])
      chips.push({ key: `m:${m.key}:${m.value}`, hue: fieldHue(`mf:${m.key}`), label: m.value });
    for (const vf of answer.variant_filters ?? [])
      chips.push({ key: `v:${vf.name}:${vf.value}`, hue: fieldHue(`vo:${vf.name}`), label: vf.value });
    for (const pt of answer.product_type_filters ?? [])
      chips.push({ key: `p:${pt}`, hue: fieldHue("ptype"), label: pt });
    return (
      <>
        {chips.slice(0, 3).map((c) => (
          <span key={c.key} className={`qz-ltab-chip${c.hue === null ? "" : ` hue-${c.hue}`}`}>
            {c.label}
          </span>
        ))}
        {chips.length > 3 ? <span className="qz-ltab-soft">+{chips.length - 3}</span> : null}
      </>
    );
  }
  return <span className="qz-ltab-muted">not used for products</span>;
}

// §5.3 — the Products count cell. 0 and "not set" render in the bad colour.
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
  if (role === "decides") {
    const cat = answer.target_id ? catById.get(answer.target_id) : undefined;
    if (!cat) return <span className="qz-ltab-muted">·</span>;
    const n = cat.productIds.length;
    return (
      <span className={n === 0 ? "qz-ltab-bad" : undefined}>
        {n} {n === 1 ? "product" : "products"}
      </span>
    );
  }
  if (role === "filter") {
    if (answer.no_preference || count === null) {
      return answer.no_preference ? (
        <span className="qz-ltab-soft">all {total}</span>
      ) : (
        <span className="qz-ltab-bad">not set</span>
      );
    }
    return (
      <span className={count === 0 ? "qz-ltab-bad" : undefined}>
        {count} / {total}
      </span>
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
  if (nextQ === undefined) return <span>→ results</span>;
  if (nextQ === q.qIndex + 1)
    return <span className="qz-ltab-route-next">next question</span>;
  return <span>→ Q{nextQ}</span>;
}
