import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import type { Quiz, Answer } from "../../../lib/quizSchema";
import type { BuilderCategory } from "../../builder/stepProps";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import type { OrderedQuestion } from "../../../lib/questionOrder";
import type { AttributeReadout } from "../../../lib/attributeClustering";
import { setAnswerFilterValues, setAnswerTarget } from "../../../lib/quizMutations";
import { answerNextNode } from "../../../lib/pathAnalyzer";
import { routingConflicts } from "../../../lib/routeTrace";
import { filterAnswerMatchCount } from "../../../lib/filterMatching";
import { QzPopover } from "../../qz-overlays";
import { ProductCountButton, QuestionRoleControl, RouteMenuButton } from "./LogicTabMenus";
import { ValuePickerPopover, type FilterValueSet } from "./ValuePickerPopover";
import { answerHasSelection, baseValueSet } from "./logicTabFields";

// ════════════════════════════════════════════════════════════════════════════
// QWIDGET — the Logic step's QUESTION widget (Attributes + Rules), rebuilt to
// the "Question Widget" artifact + its dev handoff (rev 2026-09-08). This is
// the questions widget ONLY: the STYLE bar above it and the Rules ledger
// below it are untouched (they live in Step3Shell / LogicTabCard).
//
// Format B: a rail of questions with their ROLE visible as a tag, and one
// pane — the question title, a text-with-caret role control, then either
// the RECOMMENDATIONS FROM STEP 1 tray (deciding question) or a hairline,
// then the answer rows: key · answer · mapping · then-go-to. No PRODUCTS
// column: the count moves inside the mapping chip, where the products
// popover survives.
//
// Decision 1 (owner-locked): one deciding answer points at exactly ONE
// recommendation (Answer.target_id). The mock let a cell hold several —
// that is NOT built: one chip, one clear ×, placing REPLACES.
// Decision 2: a multi-select question may decide. Decision 3: several
// selected mapped answers union their targets (resolveTarget).
//
// The CELL is the control (div role="button", Enter/Space) — a button cannot
// contain a button, and the chip, its count and its × are real buttons that
// stop propagation. The picks picker (deciding rows) is single-select and
// writes on click; the narrows picker stages and writes on Done.
//
// The tray's two-row overflow is MEASURED after layout (ResizeObserver +
// fonts.ready), never a hard-coded card count: names run 67–175px and the
// pane is fluid.
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;
type Commit = (doc: QuizDoc) => void;
type DisplayRole = "decides" | "filter" | "info";
type RulesByAnswer = Map<
  string,
  Array<{ index: number; rule: NonNullable<QuizDoc["decision_rules"]>[number] }>
>;

// §3.2 copy — no em dashes in merchant-facing copy (owner, 2026-09-07).
const COPY = {
  trayLabel: "Recommendations from step 1",
  chooseResult: "Choose a result",
  chooseValue: "Choose a value",
  place: (name: string) => `Place ${name} here`,
  replace: (old: string, next: string) => `Replace ${old} with ${next}`,
  seeMore: (n: number) => `See ${n} more`,
  allPlaced: "Every one of them is placed",
};

// The picks picker groups step-1 output by what it is.
type RecSource = "Collections" | "Single products" | "Tag buckets" | "Custom groups";
const REC_SOURCES: RecSource[] = ["Collections", "Single products", "Tag buckets", "Custom groups"];
function recSourceOf(cat: BuilderCategory): RecSource {
  if (cat.source === "collection" || cat.source === "smart_collection") return "Collections";
  if (cat.source === "product") return "Single products";
  if (cat.source === "tag") return "Tag buckets";
  return "Custom groups";
}

// The rail only has to make a question recognisable: the trailing instruction
// ("Select all that apply.") repeats across questions, so it is dropped before
// the two-line clamp. Full text stays on hover.
function shortQ(t: string): string {
  const i = t.indexOf("?");
  if (i > 0 && i < t.length - 1) return t.slice(0, i + 1);
  const j = t.indexOf(". ");
  return j > 0 ? t.slice(0, j + 1) : t;
}

function displayRole(
  role: "decides" | "qualifier" | "filter" | undefined,
  rulesOnly: boolean,
): DisplayRole {
  if (rulesOnly) return "info";
  if (role === "decides") return "decides";
  if (role === "filter") return "filter";
  return "info";
}

const ROLE_TAG: Record<DisplayRole, string> = { decides: "Picks", filter: "Narrows", info: "Info" };

/** A step-1 recommendation as the widget sees it. */
interface RecCard {
  cat: BuilderCategory;
  source: RecSource;
  thumb: string | null;
  count: number;
}

export function LogicQuestionWidget({
  doc,
  questions,
  categories,
  colTitleById,
  productIndex,
  readout,
  qIndexByNodeId,
  commit,
  rulesOnly,
  deciderQIndex,
  hasNarrowFields,
  lastSyncAt,
  shopifyAdminDomain,
  rulesByAnswer,
  selectedId,
  onSelect,
  onAddQuestion,
  onExplain,
}: {
  doc: QuizDoc;
  questions: OrderedQuestion[];
  /** Every category the workspace knows (quiz-scoped + shop-global groups). */
  categories: BuilderCategory[];
  colTitleById: Map<string, string>;
  productIndex: IndexedProduct[];
  readout: AttributeReadout;
  qIndexByNodeId: Map<string, number>;
  commit?: Commit;
  rulesOnly: boolean;
  deciderQIndex: number | null;
  hasNarrowFields: boolean;
  lastSyncAt?: string | null;
  shopifyAdminDomain?: string | null;
  rulesByAnswer: RulesByAnswer;
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
  onAddQuestion?: () => void;
  onExplain: () => void;
}) {
  const selected = questions.find((q) => q.node.id === selectedId) ?? questions[0] ?? null;
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const productById = useMemo(
    () => new Map(productIndex.map((p) => [p.product_id, p])),
    [productIndex],
  );
  // The pool is STEP-1 OUTPUT ONLY — this quiz's own Category rows (the
  // buckets picked on the Recommendations step, the groups it created, the
  // rule targets it materialised). Shop-global groups stay out (they belong
  // to the Logic/Results pickers, not to "what step 1 produced").
  const recs = useMemo<RecCard[]>(
    () =>
      categories
        .filter((c) => c.quizId != null)
        .map((c) => ({
          cat: c,
          source: recSourceOf(c),
          thumb:
            c.productIds.map((id) => productById.get(id)?.image_url ?? null).find((u) => Boolean(u)) ??
            null,
          count: c.productIds.length,
        })),
    [categories, productById],
  );

  // Arm and place — one armed card per widget, cleared on question change.
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => setArmed(null), [selected?.node.id]);
  // The cell you changed flashes briefly so the eye lands on what moved.
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);
  const markChanged = useCallback((answerId: string) => {
    setFlash(answerId);
    if (flashTimer.current != null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 2600);
  }, []);
  useEffect(() => () => {
    if (flashTimer.current != null) window.clearTimeout(flashTimer.current);
  }, []);

  return (
    <div className="qz-lw-grid qz-lw-grid--b">
      <div className="qz-lw-rail">
        <div className="qz-lw-railhead">
          <span className="qz-lw-railh">Questions</span>
          <span className="qz-lw-railn">{questions.length}</span>
          <button
            type="button"
            className="qz-lw-howmini"
            aria-label="How questions work"
            title="How questions work"
            onClick={onExplain}
          >
            ✦
          </button>
        </div>
        {questions.map((q) => {
          const role = displayRole(q.node.data.role, rulesOnly);
          const on = selected?.node.id === q.node.id;
          return (
            <button
              key={q.node.id}
              type="button"
              className={`qz-lw-qi${on ? " is-on" : ""}`}
              data-node-id={q.node.id}
              aria-pressed={on}
              title={q.node.data.text}
              onClick={() => onSelect(q.node.id)}
            >
              <span className="qz-lw-qn">{q.qIndex}</span>
              <span className="qz-lw-qtxt">{shortQ(q.node.data.text)}</span>
              {!rulesOnly ? (
                <span className={`qz-lw-qtag is-${role}`}>{ROLE_TAG[role]}</span>
              ) : null}
            </button>
          );
        })}
        {onAddQuestion ? (
          <button type="button" className="qz-lw-qadd" onClick={onAddQuestion}>
            + Add question
          </button>
        ) : null}
      </div>
      <div className="qz-lw-detail">
        {selected ? (
          <QuestionPane
            key={selected.node.id}
            doc={doc}
            q={selected}
            questions={questions}
            rulesOnly={rulesOnly}
            catById={catById}
            colTitleById={colTitleById}
            productIndex={productIndex}
            productById={productById}
            readout={readout}
            qIndexByNodeId={qIndexByNodeId}
            commit={commit}
            deciderQIndex={deciderQIndex}
            hasNarrowFields={hasNarrowFields}
            lastSyncAt={lastSyncAt}
            shopifyAdminDomain={shopifyAdminDomain}
            rulesByAnswer={rulesByAnswer}
            recs={recs}
            armed={armed}
            setArmed={setArmed}
            flash={flash}
            markChanged={markChanged}
          />
        ) : (
          <p className="qz-ltab-empty">No questions yet.</p>
        )}
      </div>
    </div>
  );
}

// ── the ONE pane ────────────────────────────────────────────────────────────
function QuestionPane({
  doc,
  q,
  questions,
  rulesOnly,
  catById,
  colTitleById,
  productIndex,
  productById,
  readout,
  qIndexByNodeId,
  commit,
  deciderQIndex,
  hasNarrowFields,
  lastSyncAt,
  shopifyAdminDomain,
  rulesByAnswer,
  recs,
  armed,
  setArmed,
  flash,
  markChanged,
}: {
  doc: QuizDoc;
  q: OrderedQuestion;
  questions: OrderedQuestion[];
  rulesOnly: boolean;
  catById: Map<string, BuilderCategory>;
  colTitleById: Map<string, string>;
  productIndex: IndexedProduct[];
  productById: Map<string, IndexedProduct>;
  readout: AttributeReadout;
  qIndexByNodeId: Map<string, number>;
  commit?: Commit;
  deciderQIndex: number | null;
  hasNarrowFields: boolean;
  lastSyncAt?: string | null;
  shopifyAdminDomain?: string | null;
  rulesByAnswer: RulesByAnswer;
  recs: RecCard[];
  armed: string | null;
  setArmed: (id: string | null) => void;
  flash: string | null;
  markChanged: (answerId: string) => void;
}) {
  const role = displayRole(q.node.data.role, rulesOnly);
  const rawRole = q.node.data.role;
  const answers = q.node.data.answers;
  const keys = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  // Which recommendations this question's answers already point at — the
  // tray greys them and slides them last; the picker still offers them (two
  // answers may share a target — one rule, both surfaces obey it).
  const usedBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of answers) if (a.target_id) m.set(a.target_id, (m.get(a.target_id) ?? 0) + 1);
    return m;
  }, [answers]);
  // §6 routing (option A) — the multi-select first-authored-wins rule stays
  // implicit at runtime but stops being invisible: the conflicts surface on
  // the deciding question's rows.
  const conflicts = useMemo(
    () => (role === "decides" && q.node.data.question_type === "multi_select" ? routingConflicts(doc, q.node.id) : []),
    [doc, q.node.id, q.node.data.question_type, role],
  );

  const place = (answer: Answer, catId: string) => {
    if (!commit) return;
    commit(setAnswerTarget(doc, q.node.id, answer.id, catId));
    markChanged(answer.id);
    setArmed(null);
  };
  const clearTarget = (answer: Answer) => {
    if (!commit) return;
    commit(setAnswerTarget(doc, q.node.id, answer.id, null));
    markChanged(answer.id);
  };
  const writeValues = (answer: Answer, values: FilterValueSet) => {
    if (!commit) return;
    commit(setAnswerFilterValues(doc, q.node.id, answer.id, values));
    markChanged(answer.id);
  };

  const pillLabel =
    rawRole === "decides" ? "Picks results" : rawRole === "filter" ? "Narrows results" : "Info only";

  return (
    <div className="qz-lw-panel qz-lw-pane" data-node-id={q.node.id}>
      <div className="qz-lw-paneh">
        <h3 className="qz-lw-panet">{q.node.data.text}</h3>
        {/* The role control — text with a caret, an edge only on reach.
            HIDDEN entirely in Rules only (the role stops existing there). */}
        {!rulesOnly ? (
          commit ? (
            <QuestionRoleControl
              variant="pane"
              doc={doc}
              node={q.node}
              qIndex={q.qIndex}
              deciderQIndex={deciderQIndex}
              productIndex={productIndex}
              hasNarrowFields={hasNarrowFields}
              onCommit={commit}
            />
          ) : (
            <span className="qz-lw-rolebtn is-static">{pillLabel}</span>
          )
        ) : null}
      </div>

      {role === "decides" ? (
        <RecTray
          recs={recs}
          usedBy={usedBy}
          armed={armed}
          setArmed={setArmed}
          productById={productById}
          editable={Boolean(commit)}
        />
      ) : (
        // Where there is no tray a hairline stands in, so the answer list
        // always has a top edge.
        <div className="qz-lw-prule" />
      )}

      {answers.length === 0 ? (
        <p className="qz-ltab-empty">
          <span className="qz-ltab-muted">—</span> no answer options
        </p>
      ) : (
        <div className="qz-lw-arows">
          {answers.map((a, i) => (
            <AnswerRow
              key={a.id}
              doc={doc}
              q={q}
              answer={a}
              answerKey={keys[i] ?? String(i + 1)}
              role={role}
              questions={questions}
              catById={catById}
              colTitleById={colTitleById}
              productIndex={productIndex}
              readout={readout}
              qIndexByNodeId={qIndexByNodeId}
              editable={Boolean(commit)}
              commit={commit}
              lastSyncAt={lastSyncAt}
              shopifyAdminDomain={shopifyAdminDomain}
              rulesForAnswer={rulesByAnswer.get(a.id) ?? []}
              recs={recs}
              armed={armed ? catById.get(armed) ?? null : null}
              onPlace={(catId) => place(a, catId)}
              onClear={() => clearTarget(a)}
              onWriteValues={(v) => writeValues(a, v)}
              flashing={flash === a.id}
            />
          ))}
        </div>
      )}
      {conflicts.length > 0 ? (
        <div className="qz-lw-routewarn" role="status">
          {conflicts.map((c, i) => (
            <p key={i} className={c.severity === "error" ? "is-error" : ""}>
              {c.message}
              {i === conflicts.length - 1 && q.node.data.question_type === "multi_select"
                ? " The first checked answer, in the order above, decides where the shopper goes next."
                : ""}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── the tray: RECOMMENDATIONS FROM STEP 1 ───────────────────────────────────
function RecTray({
  recs,
  usedBy,
  armed,
  setArmed,
  productById,
  editable,
}: {
  recs: RecCard[];
  usedBy: Map<string, number>;
  armed: string | null;
  setArmed: (id: string | null) => void;
  productById: Map<string, IndexedProduct>;
  editable: boolean;
}) {
  // Used cards grey out and slide to the end on their own, so what is left to
  // place stays at the front. Stable within each half.
  const ordered = useMemo(() => {
    const free = recs.filter((r) => !usedBy.has(r.cat.id));
    const used = recs.filter((r) => usedBy.has(r.cat.id));
    return [...free, ...used];
  }, [recs, usedBy]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState<number>(ordered.length);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [peek, setPeek] = useState<string | null>(null);
  // Measure after layout: fill two rows, hide whatever starts a third, and
  // give back a slot if revealing the See-more tile pushes one over.
  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const cards = Array.from(wrap.querySelectorAll<HTMLElement>("[data-tray-card]"));
    const more = wrap.querySelector<HTMLElement>("[data-tray-more]");
    for (const c of cards) c.style.display = "";
    if (more) more.style.display = "none";
    const rows: number[] = [];
    let keep = cards.length;
    for (let i = 0; i < cards.length; i++) {
      const t = cards[i]!.offsetTop;
      if (!rows.includes(t)) rows.push(t);
      if (rows.length > 2) {
        keep = i;
        break;
      }
    }
    if (keep >= cards.length) {
      setVisibleCount(cards.length);
      return;
    }
    if (!more) {
      setVisibleCount(keep);
      return;
    }
    const row2 = rows[1];
    for (let guard = 0; guard < cards.length + 2; guard++) {
      for (let n = 0; n < cards.length; n++) cards[n]!.style.display = n < keep ? "" : "none";
      more.style.display = "";
      if (row2 === undefined || more.offsetTop <= row2 || keep <= 1) break;
      keep--;
    }
    setVisibleCount(keep);
  }, []);
  useLayoutEffect(() => {
    measure();
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(wrap);
    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    fonts?.ready?.then(() => measure()).catch(() => {});
    return () => ro.disconnect();
  }, [measure, ordered.length]);

  const hidden = Math.max(0, ordered.length - visibleCount);
  const toggleArm = (id: string) => {
    if (!editable) return;
    const same = armed === id;
    setArmed(same ? null : id);
    setPeek(same ? null : id);
  };

  return (
    <div className="qz-lw-tray">
      <div className="qz-lw-tray-h">
        <span className="qz-lw-tray-lb">{COPY.trayLabel}</span>
        {armed ? (
          <span className="qz-lw-tray-hint">Click an answer to place it</span>
        ) : null}
      </div>
      <div className="qz-lw-tray-c" ref={wrapRef}>
        {ordered.length === 0 ? (
          <span className="qz-lw-tray-lb">Nothing from step 1 yet</span>
        ) : null}
        {ordered.map((r, n) => {
          const isArmed = armed === r.cat.id;
          const used = usedBy.get(r.cat.id) ?? 0;
          const card = (
            <button
              type="button"
              className={`qz-lw-tcard${isArmed ? " is-armed" : ""}${used ? " is-used" : ""}`}
              aria-pressed={isArmed}
              title={used ? `${r.cat.name} · placed on ${used} answer${used === 1 ? "" : "s"}` : r.cat.name}
              onClick={() => toggleArm(r.cat.id)}
              disabled={!editable}
            >
              {r.thumb ? (
                <img className="qz-lw-thumb" src={r.thumb} alt="" aria-hidden loading="lazy" />
              ) : (
                <span className="qz-lw-thumb" aria-hidden />
              )}
              <span className="qz-lw-tname">{r.cat.name}</span>
            </button>
          );
          return (
            <span
              key={r.cat.id}
              className="qz-lw-tw"
              data-tray-card
              style={n >= visibleCount ? { display: "none" } : undefined}
            >
              {r.count > 1 ? (
                <QzPopover
                  placement="top"
                  maxWidth={320}
                  open={peek === r.cat.id}
                  onOpenChange={(o) => setPeek(o ? r.cat.id : null)}
                  trigger={card}
                  content={<RecPeek rec={r} productById={productById} />}
                />
              ) : (
                card
              )}
            </span>
          );
        })}
        <span className="qz-lw-tw" data-tray-more style={hidden > 0 ? undefined : { display: "none" }}>
          <QzPopover
            placement="top"
            maxWidth={392}
            open={browseOpen}
            onOpenChange={setBrowseOpen}
            trigger={
              <button type="button" className="qz-lw-tmore">
                {COPY.seeMore(hidden)}
              </button>
            }
            content={
              <BrowseList
                recs={ordered}
                usedBy={usedBy}
                onArm={(id) => {
                  setArmed(id);
                  setBrowseOpen(false);
                }}
              />
            }
          />
        </span>
      </div>
    </div>
  );
}

// A quick view of the products in a group. Editing lives in step 1, not here.
function RecPeek({ rec, productById }: { rec: RecCard; productById: Map<string, IndexedProduct> }) {
  const rows = rec.cat.productIds.map((id) => productById.get(id)).filter((p): p is IndexedProduct => Boolean(p));
  const shown = rows.slice(0, 14);
  return (
    <div className="qz-lw-vp">
      <div className="qz-lw-vp-title">
        {rec.cat.name} <span>· {rec.source.toLowerCase().replace(/s$/, "")}</span>
      </div>
      <div className="qz-lw-vp-list">
        {shown.map((p) => (
          <div key={p.product_id} className="qz-lw-pp">
            {p.image_url ? (
              <img className="qz-lw-pp-sw" src={p.image_url} alt="" loading="lazy" />
            ) : (
              <span className="qz-lw-pp-sw" aria-hidden />
            )}
            <span className="qz-lw-pp-nm">{p.title}</span>
          </div>
        ))}
        {rows.length > shown.length ? (
          <p className="qz-lw-vp-more">Showing {shown.length} of {rows.length}</p>
        ) : null}
      </div>
    </div>
  );
}

// "See N more" — every recommendation, searchable, grouped by kind; picking
// one arms it (the mock's browse list was unreachable with no overflow —
// here the tile shows whenever anything is hidden).
function BrowseList({
  recs,
  usedBy,
  onArm,
}: {
  recs: RecCard[];
  usedBy: Map<string, number>;
  onArm: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const qs = search.trim().toLowerCase();
  const pool = recs.filter((r) => !qs || r.cat.name.toLowerCase().includes(qs));
  return (
    <div className="qz-lw-vp">
      <input
        className="qz-lw-vp-srch"
        type="search"
        placeholder="Search recommendations…"
        aria-label="Search recommendations"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />
      <div className="qz-lw-vp-list">
        {REC_SOURCES.map((src) => {
          const rs = pool.filter((r) => r.source === src);
          if (!rs.length) return null;
          return (
            <div key={src}>
              <div className="qz-lw-vp-grp">{src}</div>
              {rs.map((r) => (
                <div key={r.cat.id} className="qz-lw-vp-row">
                  <button type="button" className="qz-lw-vp-opt" onClick={() => onArm(r.cat.id)}>
                    <span className="qz-lw-vp-ov">{r.cat.name}</span>
                    {usedBy.has(r.cat.id) ? <span className="qz-lw-vp-q">placed</span> : null}
                  </button>
                  <span className="qz-lw-vp-drill is-flat">{r.count}</span>
                </div>
              ))}
            </div>
          );
        })}
        {pool.length === 0 ? <p className="qz-lw-vp-none">Nothing matches.</p> : null}
      </div>
    </div>
  );
}

// ── the picks picker — single-select radios over step-1 output ──────────────
function PicksPicker({
  open,
  onOpenChange,
  anchorRef,
  trigger,
  recs,
  currentId,
  productById,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  trigger: ReactNode;
  recs: RecCard[];
  currentId: string | null;
  productById: Map<string, IndexedProduct>;
  onPick: (catId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<RecSource | "">("");
  const [drill, setDrill] = useState<RecCard | null>(null);
  useEffect(() => {
    if (!open) return;
    setSearch("");
    setKind("");
    setDrill(null);
  }, [open]);
  const qs = search.trim().toLowerCase();
  const pool = recs.filter((r) => {
    if (!qs) return true;
    if (r.cat.name.toLowerCase().includes(qs)) return true;
    return r.cat.productIds.some((id) => (productById.get(id)?.title ?? "").toLowerCase().includes(qs));
  });
  const current = currentId ? recs.find((r) => r.cat.id === currentId) ?? null : null;
  return (
    <QzPopover
      open={open}
      onOpenChange={onOpenChange}
      maxWidth={392}
      anchorRef={anchorRef}
      trigger={trigger}
      content={
        drill ? (
          <div className="qz-lw-vp">
            <div className="qz-lw-vp-title">
              {drill.cat.name} <span>· {drill.count} products</span>
            </div>
            <div className="qz-lw-vp-list">
              {drill.cat.productIds
                .map((id) => productById.get(id))
                .filter((p): p is IndexedProduct => Boolean(p))
                .slice(0, 14)
                .map((p) => (
                  <div key={p.product_id} className="qz-lw-pp">
                    {p.image_url ? (
                      <img className="qz-lw-pp-sw" src={p.image_url} alt="" loading="lazy" />
                    ) : (
                      <span className="qz-lw-pp-sw" aria-hidden />
                    )}
                    <span className="qz-lw-pp-nm">{p.title}</span>
                    {p.product_type ? <span className="qz-lw-pp-ty">{p.product_type}</span> : null}
                  </div>
                ))}
              {drill.count > 14 ? <p className="qz-lw-vp-more">Showing 14 of {drill.count}</p> : null}
            </div>
            <div className="qz-lw-vp-foot">
              <button type="button" className="qz-btn qz-btn-sm" onClick={() => setDrill(null)}>
                ‹ Back
              </button>
              <span className="qz-lw-vp-fbtns">
                <button type="button" className="qz-btn qz-btn-primary qz-btn-sm" onClick={() => onPick(drill.cat.id)}>
                  Use this
                </button>
              </span>
            </div>
          </div>
        ) : (
          <div className="qz-lw-vp" role="radiogroup" aria-label="Recommendations from step 1">
            <input
              className="qz-lw-vp-srch"
              type="search"
              placeholder="Search your recommendations…"
              aria-label="Search your recommendations"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
            <div className="qz-lw-vp-tfilt">
              <button
                type="button"
                className={`qz-lw-vp-tf${kind === "" ? " is-on" : ""}`}
                aria-pressed={kind === ""}
                onClick={() => setKind("")}
              >
                All <span className="qz-lw-vp-c">{pool.length}</span>
              </button>
              {REC_SOURCES.map((src) => {
                const n = pool.filter((r) => r.source === src).length;
                if (!n) return null;
                return (
                  <button
                    key={src}
                    type="button"
                    className={`qz-lw-vp-tf${kind === src ? " is-on" : ""}`}
                    aria-pressed={kind === src}
                    onClick={() => setKind(src)}
                  >
                    {src} <span className="qz-lw-vp-c">{n}</span>
                  </button>
                );
              })}
            </div>
            <div className="qz-lw-vp-list">
              {REC_SOURCES.map((src) => {
                if (kind && kind !== src) return null;
                const rs = pool.filter((r) => r.source === src);
                if (!rs.length) return null;
                return (
                  <div key={src}>
                    <div className="qz-lw-vp-grp">{src}</div>
                    {rs.map((r) => {
                      const on = r.cat.id === currentId;
                      return (
                        <div key={r.cat.id} className="qz-lw-vp-row">
                          {/* Rows are RADIOS — a single-target picker. */}
                          <button
                            type="button"
                            role="radio"
                            aria-checked={on}
                            className={`qz-lw-vp-opt is-radio${on ? " is-on" : ""}`}
                            onClick={() => onPick(r.cat.id)}
                          >
                            <span className="qz-lw-vp-tk" aria-hidden>{on ? "✓" : ""}</span>
                            <span className="qz-lw-vp-ov">{r.cat.name}</span>
                          </button>
                          {r.count > 1 ? (
                            <button
                              type="button"
                              className="qz-lw-vp-drill"
                              aria-label={`See the ${r.count} products in ${r.cat.name}`}
                              onClick={() => setDrill(r)}
                            >
                              {r.count}
                              <span aria-hidden>›</span>
                            </button>
                          ) : (
                            <span className="qz-lw-vp-drill is-flat">{r.count}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {pool.length === 0 ? (
                <p className="qz-lw-vp-none">
                  {recs.length === 0 ? "Nothing from step 1 yet." : "Nothing matches."}
                </p>
              ) : null}
            </div>
            {/* The footer slot carries the SELECTED recommendation's product
                count (a single-target picker never reads "N selected"). */}
            <div className="qz-lw-vp-foot">
              <span>
                {current ? (
                  <>
                    <b>{current.cat.name}</b> · {current.count} product{current.count === 1 ? "" : "s"}
                  </>
                ) : (
                  "Nothing chosen yet"
                )}
              </span>
              <span className="qz-lw-vp-fbtns">
                <button type="button" className="qz-btn qz-btn-sm" onClick={() => onOpenChange(false)}>
                  Cancel
                </button>
              </span>
            </div>
          </div>
        )
      }
    />
  );
}

// ── one answer row: key · answer · mapping · then-go-to ─────────────────────
function AnswerRow({
  doc,
  q,
  answer,
  answerKey,
  role,
  questions,
  catById,
  colTitleById,
  productIndex,
  readout,
  qIndexByNodeId,
  editable,
  commit,
  lastSyncAt,
  shopifyAdminDomain,
  rulesForAnswer,
  recs,
  armed,
  onPlace,
  onClear,
  onWriteValues,
  flashing,
}: {
  doc: QuizDoc;
  q: OrderedQuestion;
  answer: Answer;
  answerKey: string;
  role: DisplayRole;
  questions: OrderedQuestion[];
  catById: Map<string, BuilderCategory>;
  colTitleById: Map<string, string>;
  productIndex: IndexedProduct[];
  readout: AttributeReadout;
  qIndexByNodeId: Map<string, number>;
  editable: boolean;
  commit?: Commit;
  lastSyncAt?: string | null;
  shopifyAdminDomain?: string | null;
  rulesForAnswer: RulesByAnswer extends Map<string, infer V> ? V : never;
  recs: RecCard[];
  armed: BuilderCategory | null;
  onPlace: (catId: string) => void;
  onClear: () => void;
  onWriteValues: (values: FilterValueSet) => void;
  flashing: boolean;
}) {
  const cellRef = useRef<HTMLDivElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const productById = useMemo(() => new Map(productIndex.map((p) => [p.product_id, p])), [productIndex]);
  const total = productIndex.length;

  // ── the mapping cell ──────────────────────────────────────────────────────
  let cell: ReactNode;
  const cat = answer.target_id ? catById.get(answer.target_id) : undefined;
  const hasMapping =
    role === "decides"
      ? Boolean(answer.target_id)
      : role === "filter"
        ? answer.no_preference === true || answerHasSelection(answer)
        : false;

  if (role === "info") {
    // Inert: stored values render greyed and non-interactive (they survive a
    // role change both ways — setQuestionRole never touches them), or a
    // dash when empty. No picker, no drop target, no ×.
    const chips = narrowChips(answer, colTitleById).map((c) => c.label);
    const rules = rulesForAnswer;
    cell = (
      <span className="qz-lw-vinert">
        {rules.length > 0 ? (
          rules.map(({ index, rule }) => {
            const tid = (rule.target_ids?.length ? rule.target_ids : [rule.target_id])[0];
            const rcat = tid ? catById.get(tid) : undefined;
            return (
              <span key={rule.id} className="qz-lw-vchip is-rule">
                λ{index} {rule.action === "prioritize" ? "lifts" : rule.action === "hide" ? "hides" : "shows"}{" "}
                {rcat ? rcat.name : "(deleted target)"}
              </span>
            );
          })
        ) : chips.length ? (
          chips.map((c, i) => (
            <span key={`${c}:${i}`} className="qz-lw-ichip">
              {c}
            </span>
          ))
        ) : (
          <span className="qz-lw-dash">—</span>
        )}
      </span>
    );
  } else if (role === "decides") {
    const armedHere = armed && editable;
    const openPicker = () => {
      if (!editable) return;
      if (armedHere) {
        onPlace(armed.id);
        return;
      }
      setPickerOpen((o) => !o);
    };
    const label = armedHere
      ? cat
        ? COPY.replace(cat.name, armed.name)
        : COPY.place(armed.name)
      : null;
    const chipBody = cat ? (
      <span className="qz-lw-chipw" onClick={(e) => e.stopPropagation()}>
        <span className="qz-lw-chip is-res">{cat.name}</span>
        {editable ? (
          <ProductCountButton
            answer={answer}
            role="decides"
            catById={catById}
            productIndex={productIndex}
            label={<span className="qz-lw-cn">{cat.productIds.length}</span>}
            answerKey={answerKey}
            lastSyncAt={lastSyncAt}
            shopifyAdminDomain={shopifyAdminDomain}
          />
        ) : (
          <span className="qz-lw-cn">{cat.productIds.length}</span>
        )}
        {editable ? (
          <button
            type="button"
            className="qz-lw-xone"
            aria-label={`Clear this answer's result (${cat.name})`}
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
          >
            ×
          </button>
        ) : null}
      </span>
    ) : answer.target_id ? (
      <span className="qz-ltab-bad">(deleted target)</span>
    ) : null;
    const inner = (
      <div
        ref={cellRef}
        className={`qz-lw-cell${hasMapping ? "" : " is-blank"}${armedHere ? " is-drop" : ""}${pickerOpen ? " is-open" : ""}${flashing ? " is-flash" : ""}`}
        role="button"
        tabIndex={editable ? 0 : -1}
        aria-label={hasMapping ? "Edit this answer's result" : "Choose a result for this answer"}
        onClick={(e) => {
          e.stopPropagation();
          openPicker();
        }}
        onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          e.stopPropagation();
          openPicker();
        }}
      >
        {label ? (
          <span className="qz-lw-placesay">{label}</span>
        ) : hasMapping ? (
          chipBody
        ) : (
          <span className="qz-lw-vbtn is-empty">
            {COPY.chooseResult}
            <span className="qz-lw-cv" aria-hidden>▾</span>
          </span>
        )}
      </div>
    );
    cell = editable ? (
      <PicksPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        anchorRef={cellRef}
        trigger={inner}
        recs={recs}
        currentId={answer.target_id ?? null}
        productById={productById}
        onPick={(id) => {
          setPickerOpen(false);
          onPlace(id);
        }}
      />
    ) : (
      inner
    );
  } else {
    // Narrows — per-value chips with their own ×, the answer's match count
    // beside them (the products popover survives there), the staged picker.
    const chips = narrowChips(answer, colTitleById);
    const count = answer.no_preference ? total : filterAnswerMatchCount(answer, productIndex);
    const inner = (
      <div
        ref={cellRef}
        className={`qz-lw-cell${hasMapping ? "" : " is-blank"}${pickerOpen ? " is-open" : ""}${flashing ? " is-flash" : ""}`}
        role="button"
        tabIndex={editable ? 0 : -1}
        aria-label={hasMapping ? "Edit this answer's values" : "Choose values for this answer"}
        onClick={(e) => {
          e.stopPropagation();
          if (editable) setPickerOpen((o) => !o);
        }}
        onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          e.stopPropagation();
          if (editable) setPickerOpen((o) => !o);
        }}
      >
        {answer.no_preference ? (
          <span className="qz-lw-chipw" onClick={(e) => e.stopPropagation()}>
            <span className="qz-lw-chip is-all">Keeps everything</span>
            {editable ? (
              <button
                type="button"
                className="qz-lw-xone"
                aria-label="Stop keeping everything"
                onClick={(e) => {
                  e.stopPropagation();
                  onWriteValues({ tags: [] });
                }}
              >
                ×
              </button>
            ) : null}
          </span>
        ) : chips.length ? (
          <span className="qz-lw-chips" onClick={(e) => e.stopPropagation()}>
            {chips.map((c) => (
              <span key={c.key} className="qz-lw-chipw" onClick={(e) => e.stopPropagation()}>
                <span className="qz-lw-chip">
                  {c.label}
                  {c.field ? <span className="qz-lw-qf">{c.field}</span> : null}
                </span>
                {editable ? (
                  <button
                    type="button"
                    className="qz-lw-xone"
                    aria-label={`Remove ${c.label} from this answer`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onWriteValues(c.removed);
                    }}
                  >
                    ×
                  </button>
                ) : null}
              </span>
            ))}
            {count !== null && editable ? (
              <ProductCountButton
                answer={answer}
                role="filter"
                catById={catById}
                productIndex={productIndex}
                label={
                  <span className={`qz-lw-cn${count === 0 ? " is-zero" : ""}`}>
                    {count} of {total}
                  </span>
                }
                answerKey={answerKey}
                lastSyncAt={lastSyncAt}
                shopifyAdminDomain={shopifyAdminDomain}
              />
            ) : null}
          </span>
        ) : (
          <span className="qz-lw-vbtn is-empty">
            {COPY.chooseValue}
            <span className="qz-lw-cv" aria-hidden>▾</span>
          </span>
        )}
      </div>
    );
    cell = editable ? (
      <ValuePickerPopover
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        anchorRef={cellRef}
        trigger={inner}
        answer={answer}
        siblingAnswers={q.node.data.answers}
        readout={readout}
        productIndex={productIndex}
        onApply={onWriteValues}
      />
    ) : (
      inner
    );
  }

  // ── then-go-to: near-silent by default, ink when overridden ──────────────
  const route = routeLabel(doc, q, answer, qIndexByNodeId);
  const goLabel = (
    <span className={`qz-lw-go${route.set ? " is-set" : ""}`}>→ {route.label}</span>
  );

  return (
    <div className="qz-lw-arow">
      <span className="qz-lw-akey">{answerKey}</span>
      <span className="qz-lw-atext" title={answer.text}>
        {answer.text}
      </span>
      <span className="qz-lw-acellw">{cell}</span>
      <span className="qz-lw-aroute">
        {commit ? (
          <RouteMenuButton
            doc={doc}
            q={q}
            answer={answer}
            questions={questions}
            commit={commit}
            label={goLabel}
          />
        ) : (
          goLabel
        )}
      </span>
    </div>
  );
}

// A mapped value keeps the field it came from: "dry" alone reads as a tag
// when it is really the skin_type metafield.
function narrowChips(
  answer: Answer,
  colTitleById: Map<string, string>,
): Array<{ key: string; label: string; field: string | null; removed: FilterValueSet }> {
  const chips: Array<{ key: string; label: string; field: string | null; removed: FilterValueSet }> = [];
  answer.tags.forEach((t, ti) => {
    const ci = t.indexOf(":");
    const label = ci > 0 && ci < t.length - 1 ? t.slice(ci + 1) : t;
    const field = ci > 0 && ci < t.length - 1 ? t.slice(0, ci) : null;
    const removed = baseValueSet(answer);
    removed.tags = answer.tags.filter((_, j) => j !== ti);
    chips.push({ key: `t:${t}:${ti}`, label, field, removed });
  });
  const cols = [
    ...(answer.collection_filter ? [answer.collection_filter] : []),
    ...(answer.collection_filters ?? []),
  ].filter((c, i, all) => Boolean(c) && all.indexOf(c) === i);
  cols.forEach((cid) => {
    const removed = baseValueSet(answer);
    removed.collection_filters = cols.filter((c) => c !== cid);
    if (!removed.collection_filters.length) delete removed.collection_filters;
    chips.push({ key: `c:${cid}`, label: colTitleById.get(cid) ?? cid, field: "collection", removed });
  });
  (answer.metafield_filters ?? []).forEach((m, mi) => {
    const removed = baseValueSet(answer);
    removed.metafield_filters = (answer.metafield_filters ?? []).filter((_, j) => j !== mi);
    chips.push({ key: `m:${m.key}:${m.value}:${mi}`, label: m.value, field: m.key.split(".").pop() ?? m.key, removed });
  });
  (answer.variant_filters ?? []).forEach((v, vi) => {
    const removed = baseValueSet(answer);
    removed.variant_filters = (answer.variant_filters ?? []).filter((_, j) => j !== vi);
    chips.push({ key: `v:${v.name}:${v.value}:${vi}`, label: v.value, field: v.name, removed });
  });
  (answer.product_type_filters ?? []).forEach((p, pi) => {
    const removed = baseValueSet(answer);
    removed.product_type_filters = (answer.product_type_filters ?? []).filter((_, j) => j !== pi);
    chips.push({ key: `p:${p}:${pi}`, label: p, field: "type", removed });
  });
  return chips;
}

// §5.4 — "Then go to": Next (quiet) · Qn · Results. Content steps between
// questions are walked through — the merchant routes between QUESTIONS.
function routeLabel(
  doc: QuizDoc,
  q: OrderedQuestion,
  answer: Answer,
  qIndexByNodeId: Map<string, number>,
): { label: string; set: boolean } {
  let nextId = answerNextNode(doc, q.node.id, answer.edge_handle_id);
  for (let hops = 0; nextId && hops < 24; hops++) {
    const cur = nextId;
    if (qIndexByNodeId.has(cur)) break;
    const node = doc.nodes.find((n) => n.id === cur);
    if (!node || node.type === "result" || node.type === "end") break;
    nextId = doc.edges.find((e) => e.source === cur)?.target ?? null;
  }
  if (!nextId) return { label: "Next", set: false };
  const nextQ = qIndexByNodeId.get(nextId);
  if (nextQ === undefined) return { label: "Results", set: true };
  if (nextQ === q.qIndex + 1) return { label: "Next", set: false };
  return { label: `Q${nextQ}`, set: true };
}
