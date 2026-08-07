import { useEffect, useMemo, useRef, useState } from "react";
import type { Quiz, Answer } from "../../../lib/quizSchema";
import type { BuilderCategory, BuilderCollection } from "../../builder/stepProps";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import type { OrderedQuestion } from "../../../lib/questionOrder";
import { answerNextNode } from "../../../lib/pathAnalyzer";
import { moveDecisionRule, removeDecisionRule } from "../../../lib/quizMutations";
import { answerFilterValues, filterAnswerMatchCount } from "../../../lib/filterMatching";
import { ruleTargets } from "../../../lib/recommendDecider";
import {
  NarrowsMenuButton,
  ProductCountButton,
  RoleMenuButton,
  RouteMenuButton,
  StartingSetMenuButton,
} from "./LogicTabMenus";
import { CreateRuleModal } from "./CreateRuleModal";
import { ExplainerSheet, type ExplainerKind } from "./Explainers";

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

// §6.1 field naming — "mf:custom.gender" → "gender", "tag:fit" → "fit".
function narrowFieldLabel(field: string): string {
  const bare = field.replace(/^(mf|tag):/, "");
  const last = bare.split(".").pop();
  return last || bare;
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
  // P5 — categories materialized by the create-rule modal, merged until the
  // route loader's next pass returns them (autosave revalidation).
  const [extraCats, setExtraCats] = useState<BuilderCategory[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
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

  return (
    <section className="qz-ltab" data-testid="logic-tab-card">
      <header className="qz-ltab-hd">
        <h2>Rules</h2>
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
            onClick={() => setCreateOpen(true)}
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
        />
      ) : null}
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
              className={`qz-ltab-rrow${rule.id === freshRuleId ? " is-fresh" : ""}`}
            >
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
                    onClick={() => commit(removeDecisionRule(doc, rule.id))}
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
              categories={allCategories}
              catById={catById}
              collections={collections}
              colTitleById={colTitleById}
              productIndex={productIndex}
              qIndexByNodeId={qIndexByNodeId}
              commit={commit}
            />
          ))}
        </tbody>
      </table>
    </section>
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
  categories,
  catById,
  collections,
  colTitleById,
  productIndex,
  qIndexByNodeId,
  commit,
}: {
  doc: QuizDoc;
  q: OrderedQuestion;
  questions: OrderedQuestion[];
  categories: BuilderCategory[];
  catById: Map<string, BuilderCategory>;
  collections: BuilderCollection[];
  colTitleById: Map<string, string>;
  productIndex: IndexedProduct[];
  qIndexByNodeId: Map<string, number>;
  commit?: (doc: QuizDoc) => void;
}) {
  const role = q.node.data.role;
  const answers = q.node.data.answers;
  const total = productIndex.length;
  const keys = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  // §5.1 — the role pill under the question label. With a commit seam it
  // opens the §6.1 role menu; read-only hosts get the static pill.
  const pill = commit ? (
    <RoleMenuButton
      doc={doc}
      q={q}
      questions={questions}
      productIndex={productIndex}
      commit={commit}
    />
  ) : role === "decides" ? (
    <span className="qz-ltab-pill is-start">◆ Starting set</span>
  ) : role === "filter" ? (
    <span className="qz-ltab-pill is-narrow">
      Narrows · {q.node.data.narrow_field ? narrowFieldLabel(q.node.data.narrow_field) : "Anything"}
    </span>
  ) : (
    <span className="qz-ltab-pill">Info only</span>
  );

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
          <tr key={a.id} className={i === 0 ? "qz-ltab-qstart" : undefined}>
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
              {commit && role === "decides" ? (
                <StartingSetMenuButton
                  doc={doc}
                  q={q}
                  answer={a}
                  categories={categories}
                  commit={commit}
                />
              ) : commit && role === "filter" ? (
                <NarrowsMenuButton
                  doc={doc}
                  q={q}
                  answer={a}
                  collections={collections}
                  productIndex={productIndex}
                  commit={commit}
                >
                  {mapping}
                </NarrowsMenuButton>
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

// §5.2 — the "Shows / narrows" cell per role.
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
    return (
      <>
        {answer.tags.map((t) => (
          <span key={`t:${t}`} className="qz-ltab-chip">
            {t}
          </span>
        ))}
        {v.collectionIds.map((cid) => (
          <span key={`c:${cid}`} className="qz-ltab-chip">
            {colTitleById.get(cid) ?? cid}
          </span>
        ))}
        {(answer.metafield_filters ?? []).map((m) => (
          <span key={`m:${m.key}:${m.value}`} className="qz-ltab-chip">
            {m.value}
          </span>
        ))}
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
      <span className={n === 0 ? "qz-ltab-bad" : undefined}>{n} products</span>
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
