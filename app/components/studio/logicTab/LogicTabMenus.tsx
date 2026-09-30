import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { isFreeformType } from "../../../lib/quizSchema";
import type { Quiz, Answer } from "../../../lib/quizSchema";
import type { BuilderCategory } from "../../builder/stepProps";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import { orderedQuestions, type OrderedQuestion } from "../../../lib/questionOrder";
import { answerNextNode } from "../../../lib/pathAnalyzer";
import {
  changeQuestionRole,
  restoreQuestionLogic,
  setAnswerRoute,
  snapshotQuestionLogic,
} from "../../../lib/quizMutations";
import { filterAnswerMatchingProducts } from "../../../lib/filterMatching";
import { formatMoney } from "../../../lib/formatMoney";
import { formatTimeAgo } from "../../../lib/formatDate";
import {
  answerHasSelection,
  applyNarrowField,
  derivedNarrowField,
  derivedNarrowLabel,
  fieldSlotLabel,
  popoverShopifyUrl,
} from "./logicTabFields";
import { AttributePickerDialog } from "./AttributePickerDialog";
import { QzPopover } from "../../qz-overlays";
import { useQzToast } from "../../qz-toast";
import type { LogicUndoPush } from "./useLogicUndo";
import {
  ROLE_BUTTON,
  ROLE_LOSS_COPY,
  ROLE_MENU,
  ROLE_MENU_FOOT,
  ROUTE_COPY,
} from "./logicCopy";

// ════════════════════════════════════════════════════════════════════════════
// Logic tab — the popovers behind the question pane's controls: the product
// menu behind every count (§6.4), the forward-only route menu (mock
// routeMenu) and the ONE role control (mock roleMenu, D9). Shared by the
// Logic step's question pane and the Questions step's Overview ledger
// (variant only swaps the trigger's dress), so the role flow can never drift
// between surfaces. Every popover rides QzPopover (portal to body; one at a
// time; Esc / outside click close; focus in on open and back to the trigger
// on close). Every write goes through a pure mutation → commit(next).
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;
type Commit = (doc: QuizDoc) => void;

/** The Undo seam a host passes (LogicTabCard's one useLogicUndo run). */
export type PaneUndo = { push: (p: LogicUndoPush<QuizDoc>) => void };

const truncate = (s: string, n = 34) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ── the product menu — behind every count ──────────────────────────────────
// QRTZ-S6/H3 — the popover's kind, for the title tag + the footer sentence
// (mock .pp-title's `tag is-col` + .pp-foot). Decides answers take their
// target's source; narrows answers only get a kind when the selection is
// unambiguous (one kind of value), else no tag. The tone rides the mock's
// tag set: collections keep is-col; other kinds (no mock drawing) take the
// quartz neutral tone.
function popoverKind(
  role: "decides" | "qualifier" | "filter" | undefined,
  answer: Answer,
  catById: Map<string, BuilderCategory>,
  // QWIDGET-M — a multi-mapped answer opens one popover PER chip; the caller
  // resolves which target this popover is about.
  catOverride?: BuilderCategory,
): { label: string; tone: "is-col" | "is-a" } | null {
  if (role === "decides") {
    const cat = catOverride ?? (answer.target_id ? catById.get(answer.target_id) : undefined);
    if (!cat) return null;
    if (cat.source === "collection") return { label: "collection", tone: "is-col" };
    if (cat.source === "tag") return { label: "tag", tone: "is-a" };
    if (cat.source === "metafield") return { label: "metafield", tone: "is-a" };
    return { label: "group", tone: "is-a" };
  }
  if (role === "filter") {
    const kinds = new Set<string>();
    if (answer.tags.length) kinds.add("tag");
    if (answer.collection_filter || answer.collection_filters?.length)
      kinds.add("collection");
    if (answer.metafield_filters?.length) kinds.add("metafield");
    if (answer.variant_filters?.length) kinds.add("variant option");
    if (answer.product_type_filters?.length) kinds.add("type");
    if (kinds.size !== 1) return null;
    const label = [...kinds][0]!;
    return { label, tone: label === "collection" ? "is-col" : "is-a" };
  }
  return null;
}

export function ProductCountButton({
  answer,
  role,
  catById,
  productIndex,
  label,
  answerKey,
  lastSyncAt,
  shopifyAdminDomain,
  targetId,
}: {
  answer: Answer;
  role: "decides" | "qualifier" | "filter" | undefined;
  catById: Map<string, BuilderCategory>;
  productIndex: IndexedProduct[];
  label: ReactNode;
  /** QRTZ-S6 — the row's A/B/C key, for the mock's .pp-foot sentence. */
  answerKey?: string;
  /** QRTZ-B2 — Shop.lastSyncAt (ISO), for the mock's "synced from Shopify X
   *  ago" line. Absent/null → the count-only line. */
  lastSyncAt?: string | null;
  /** QRTZ-B2 — the Shopify ADMIN domain (null on an unconnected standalone
   *  workspace), for the mock's "Open in Shopify" footer link. */
  shopifyAdminDomain?: string | null;
  /** QWIDGET-M — which of a multi-mapped answer's targets this popover shows
   *  (decides only). Absent → the anchor (answer.target_id), unchanged. */
  targetId?: string;
}) {
  const [open, setOpen] = useState(false);
  const decTid = role === "decides" ? (targetId ?? answer.target_id) : undefined;
  const decCat = decTid ? catById.get(decTid) : undefined;
  const products = useMemo(() => {
    if (role === "decides") {
      const cat = decCat;
      if (!cat) return [];
      const byId = new Map(productIndex.map((p) => [p.product_id, p]));
      return cat.productIds
        .map((id) => byId.get(id))
        .filter((p): p is IndexedProduct => p !== undefined);
    }
    if (role === "filter")
      // QRTZ-H3 — a no-preference answer keeps everything: the popover lists
      // the whole pool, matching its "N products" count.
      return answer.no_preference
        ? [...productIndex]
        : (filterAnswerMatchingProducts(answer, productIndex) ?? []);
    return [];
  }, [answer, role, catById, productIndex, decCat]);
  const kind = popoverKind(role, answer, catById, decCat);
  // QRTZ-H3 (mock .pp-title) — the title is the TARGET's name where one
  // exists (decides); a narrows selection has no single name (no mock
  // drawing) and keeps the answer text.
  const targetCat = decCat;
  const ppTitle = targetCat?.name ?? answer.text;
  // QRTZ-B2 — the mock's .pp-foot "Open in Shopify": derived from the SAME
  // target the popover lists; kinds without a reliable admin URL get no link.
  const shopUrl = popoverShopifyUrl(
    shopifyAdminDomain,
    role,
    answer,
    decCat,
  );
  const footSentence =
    answerKey && products.length > 0 ? (
      role === "decides" ? (
        <>
          Answer <b>{answerKey} · {answer.text}</b> shows this{" "}
          {kind?.label ?? "group"}.
        </>
      ) : (
        <>
          Answer <b>{answerKey} · {answer.text}</b> narrows to these
          products.
        </>
      )
    ) : null;

  return (
    <QzPopover
      open={open}
      onOpenChange={setOpen}
      maxWidth={720}
      trigger={
        <button type="button" className="qz-ltab-countbtn">
          {label}
        </button>
      }
      content={
        // QRTZ-H3 (owner's exact-match order) — the mock's .pp card layout
        // (shared.mjs 419–441): head with target name + kind tag + the
        // count·sync sub line, the 4-across pp-grid of image · name · price ·
        // stock pill, and the teaching foot with QRTZ-B2's Open-in-Shopify
        // link (owner-approved additions that slot into the mock's foot).
        <div className="qz-pp">
          <header className="qz-pp-head">
            <div className="qz-pp-headmain">
              <p className="qz-pp-title">
                {ppTitle}
                {kind ? (
                  <span className={`qz-ltab-tag ${kind.tone}`}>{kind.label}</span>
                ) : null}
              </p>
              <p className="qz-pp-sub">
                <b>{products.length}</b>{" "}
                {products.length === 1 ? "product" : "products"} matched
                {lastSyncAt ? (
                  <> · synced from Shopify {formatTimeAgo(lastSyncAt)}</>
                ) : null}
              </p>
            </div>
            <button
              type="button"
              className="qz-pp-close"
              aria-label="Close"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </header>
          {products.length === 0 ? (
            <div className="qz-pp-none">
              Nothing carries this yet. Everyone who lands here reaches your
              safety net instead.
            </div>
          ) : (
            <div className="qz-pp-grid">
              {products.slice(0, 24).map((p) => (
                <article key={p.product_id} className="qz-pp-card">
                  {p.image_url ? (
                    <img
                      className="qz-pp-img"
                      src={p.image_url}
                      alt=""
                      loading="lazy"
                    />
                  ) : (
                    <span className="qz-pp-img" aria-hidden />
                  )}
                  <p className="qz-pp-name">{p.title}</p>
                  <p className="qz-pp-meta">
                    {p.price ? <span>{formatMoney(p.price)}</span> : null}
                    <span
                      className={`qz-pp-stock ${
                        p.inventory_in_stock ? "is-ok" : "is-out"
                      }`}
                    >
                      {p.inventory_in_stock ? "In stock" : "Out of stock"}
                    </span>
                  </p>
                </article>
              ))}
              {products.length > 24 ? (
                <div className="qz-pp-more">+{products.length - 24} more</div>
              ) : null}
            </div>
          )}
          {footSentence || shopUrl ? (
            <footer className="qz-pp-foot">
              <span>{footSentence}</span>
              {shopUrl ? (
                <a
                  className="qz-btn qz-btn-sm"
                  href={shopUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in Shopify
                </a>
              ) : null}
            </footer>
          ) : null}
        </div>
      }
    />
  );
}


// ── the route: where an answer goes (mock pane .go, routeMenu) ──────────────

/** Walk past content steps to the next question or the results. */
function walkToQuestion(
  doc: QuizDoc,
  start: string | null,
  qByNode: ReadonlyMap<string, number>,
): string | null {
  let nextId = start;
  for (let hops = 0; nextId && hops < 24; hops++) {
    const cur = nextId;
    if (qByNode.has(cur)) break;
    const node = doc.nodes.find((n) => n.id === cur);
    if (!node || node.type === "result" || node.type === "end") break;
    nextId = doc.edges.find((e) => e.source === cur)?.target ?? null;
  }
  return nextId;
}

export type AnswerRoute = {
  /** "next" = the question numbered one higher; a node id = a later
   *  question; "results" = a result / end node (or nothing after it). */
  current: "next" | "results" | string;
  label: string;
  /** Dark and bold: the answer has its own edge that goes somewhere other
   *  than the question's default (mock .go.set, B64). */
  set: boolean;
};

/** '→ Next', '→ Q4' or '→ Results' for one answer, and whether it is set. */
export function answerRoute(
  doc: QuizDoc,
  q: OrderedQuestion,
  answer: Answer,
  questions: readonly OrderedQuestion[],
): AnswerRoute {
  const qByNode = new Map(questions.map((x) => [x.node.id, x.qIndex]));
  const resolve = (id: string | null): AnswerRoute["current"] => {
    const at = walkToQuestion(doc, id, qByNode);
    if (!at) {
      return questions.some((x) => x.qIndex === q.qIndex + 1) ? "next" : "results";
    }
    const n = qByNode.get(at);
    if (n === undefined) return "results";
    return n === q.qIndex + 1 ? "next" : at;
  };
  const current = resolve(answerNextNode(doc, q.node.id, answer.edge_handle_id));
  const own = doc.edges.some(
    (e) => e.source === q.node.id && e.source_handle === answer.edge_handle_id,
  );
  const fallback = resolve(
    doc.edges.find((e) => e.source === q.node.id && !e.source_handle)?.target ?? null,
  );
  const label =
    current === "next"
      ? ROUTE_COPY.next
      : current === "results"
        ? ROUTE_COPY.results
        : `Q${qByNode.get(current) ?? "?"}`;
  return { current, label, set: own && current !== fallback };
}

export function RouteMenuButton({
  doc,
  q,
  answer,
  questions,
  commit,
  getLatestDoc,
}: {
  doc: QuizDoc;
  q: OrderedQuestion;
  answer: Answer;
  questions: OrderedQuestion[];
  /** Absent = read-only: the label renders without a menu. */
  commit?: Commit;
  getLatestDoc?: () => QuizDoc;
}) {
  const [open, setOpen] = useState(false);
  const route = answerRoute(doc, q, answer, questions);
  const nextQ = questions.find((x) => x.qIndex === q.qIndex + 1);
  const later = questions.filter((x) => x.qIndex > q.qIndex + 1);
  const resultNode = doc.nodes.find((n) => n.type === "result" || n.type === "end");
  const go = (target: string | null) => {
    setOpen(false);
    if (!commit) return;
    const latest = getLatestDoc?.() ?? doc;
    const next = setAnswerRoute(latest, q.node.id, answer.id, target);
    if (next !== latest) commit(next);
  };
  const label = (
    <>
      <span aria-hidden>→</span> {route.label}
    </>
  );
  if (!commit) {
    return <span className={`qz-lg-go is-static${route.set ? " is-set" : ""}`}>{label}</span>;
  }
  const item = (on: boolean, cls: string, body: ReactNode, onPick: () => void, key: string) => (
    <button
      key={key}
      type="button"
      role="menuitemradio"
      aria-checked={on}
      className={`qz-lg-mi${cls}${on ? " is-on" : ""}`}
      onClick={onPick}
    >
      {body}
    </button>
  );
  return (
    <QzPopover
      open={open}
      onOpenChange={setOpen}
      width={280}
      maxWidth={280}
      align="end"
      ariaHaspopup="menu"
      manageFocus
      closeOnAnchorHidden
      className="qz-lg-pop"
      offset={6}
      trigger={
        <button
          type="button"
          className={`qz-lg-go${route.set ? " is-set" : ""}`}
          aria-label={`${answer.text} goes to ${route.label}`}
          data-pane-control="route"
          data-answer-id={answer.id}
        >
          {label}
        </button>
      }
      content={
        <>
          <div className="qz-lg-pt">{ROUTE_COPY.title(answer.text)}</div>
          <div role="menu" aria-label={ROUTE_COPY.menuLabel(answer.text)}>
            {item(
              route.current === "next" || (!nextQ && route.current === "results" && !route.set),
              " qz-lg-mi2",
              <>
                <span className="qz-lg-mi2-t">{ROUTE_COPY.nextQuestion}</span>
                <span className="qz-lg-mi2-d">
                  {nextQ ? truncate(nextQ.node.data.text) : ROUTE_COPY.lastQuestion}
                </span>
              </>,
              () => go(null),
              "next",
            )}
            {later.map((x) =>
              item(
                route.current === x.node.id,
                "",
                <>
                  <span className="qz-lg-mi-n">Q{x.qIndex}</span>
                  <span className="qz-lg-mi-h">{ROUTE_COPY.skips(x.qIndex - q.qIndex - 1)}</span>
                </>,
                () => go(x.node.id),
                x.node.id,
              ),
            )}
            {resultNode
              ? item(
                  route.current === "results" && (!!nextQ || route.set),
                  "",
                  <span className="qz-lg-mi-n">{ROUTE_COPY.straight}</span>,
                  () => go(resultNode.id),
                  "results",
                )
              : null}
          </div>
        </>
      }
    />
  );
}

// ── the ONE role control (trigger → "Question N does" → attribute dialog) ──

type RoleKey = (typeof ROLE_MENU)[number]["k"];
const STORED: Record<RoleKey, "decides" | "filter" | "qualifier"> = {
  decides: "decides",
  filter: "filter",
  info: "qualifier",
};

function answerValueCount(a: Answer): number {
  return (
    a.tags.length +
    (a.collection_filter ? 1 : 0) +
    (a.collection_filters?.length ?? 0) +
    (a.metafield_filters?.length ?? 0) +
    (a.variant_filters?.length ?? 0) +
    (a.product_type_filters?.length ?? 0) +
    (a.no_preference ? 1 : 0)
  );
}

/** The D9 toast for what a role change removed ("" when nothing went). */
function lossMessage(
  doc: QuizDoc,
  lost: ReturnType<typeof changeQuestionRole>["lost"],
): string {
  const qIndex = new Map(orderedQuestions(doc).map((q) => [q.node.id, q.qIndex]));
  const parts: string[] = [];
  if (lost.targets) parts.push(ROLE_LOSS_COPY.targets(qIndex.get(lost.targets.nodeId) ?? 0, lost.targets.count));
  if (lost.values) parts.push(ROLE_LOSS_COPY.values(qIndex.get(lost.values.nodeId) ?? 0, lost.values.count));
  return parts.join(" · ");
}

/* The role pill, its "Question N does" menu (mock roleMenu: 300px, two-line
   menuitemradio rows, the loss line on each row, the foot), the attribute
   slot and the attribute dialog, as ONE control:
     - every role write is changeQuestionRole, the ONE path (D9): a move of
       "Picks the result" clears both questions' recommendations and leaving
       "Narrows" clears that question's values, and one toast names what went
       with an Undo (restoreQuestionLogic from a snapshot taken first);
     - flipping an UNMAPPED question to Narrows opens the attribute dialog
       INSTEAD of the role write; Use commits role, field and seeded values
       together, Cancel writes nothing (D19). */
export function QuestionRoleControl({
  doc,
  node,
  qIndex,
  deciderQIndex,
  productIndex,
  hasNarrowFields,
  onCommit,
  variant,
  undo,
  getLatestDoc,
  onRoleChanged,
}: {
  doc: QuizDoc;
  node: OrderedQuestion["node"];
  qIndex: number;
  /** The current picking question's number (for the move line), null if none. */
  deciderQIndex: number | null;
  productIndex: IndexedProduct[];
  /** narrowFieldOptions(productIndex).length > 0, memoized ONCE per surface. */
  hasNarrowFields: boolean;
  onCommit: Commit;
  /** Trigger dress only: "pane" = the question pane's text with a caret,
   *  "overview" = the Questions step ledger's tag, "table" = the pill. */
  variant: "overview" | "table" | "pane";
  /** The host's Undo run; absent = the loss toast carries no Undo. */
  undo?: PaneUndo;
  getLatestDoc?: () => QuizDoc;
  /** Any pick (the pane disarms the tray). */
  onRoleChanged?: () => void;
}) {
  const toast = useQzToast();
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const role = node.data.role;
  const isDecider = role === "decides";
  const isFilter = role === "filter";
  const cur: RoleKey = isDecider ? "decides" : isFilter ? "filter" : "info";
  const cannotDecide = isFreeformType(node.data.question_type);
  const label =
    variant === "pane"
      ? ROLE_BUTTON[cur]
      : (ROLE_MENU.find((j) => j.k === cur)?.n ?? ROLE_BUTTON.info);
  const derivedField = derivedNarrowField(node.data.answers);
  const valueCount = isFilter ? node.data.answers.reduce((s, a) => s + answerValueCount(a), 0) : 0;
  const latest = () => getLatestDoc?.() ?? doc;

  const announce = (message: string, snap: ReturnType<typeof snapshotQuestionLogic>) => {
    if (!message) return;
    if (undo) undo.push({ message, inverse: (d) => restoreQuestionLogic(d, snap) });
    else toast(message);
  };

  const snapFor = (d: QuizDoc) => {
    const oldPicker = d.nodes.find(
      (n) => n.type === "question" && n.data.role === "decides" && n.id !== node.id,
    );
    return snapshotQuestionLogic(d, oldPicker ? [node.id, oldPicker.id] : [node.id]);
  };

  const apply = (k: RoleKey) => {
    const base = latest();
    const snap = snapFor(base);
    const { doc: next, lost } = changeQuestionRole(base, node.id, STORED[k]);
    if (next === base) return;
    onCommit(next);
    announce(lossMessage(base, lost), snap);
  };

  const setJob = (k: RoleKey) => {
    setOpen(false);
    onRoleChanged?.();
    if (k === cur) return;
    if (k === "decides" && cannotDecide) return;
    if (k === "filter") {
      // A freshly flipped Narrows question narrows by NOTHING when no answer
      // carries a selection. With fields to offer, the dialog opens INSTEAD
      // of the role write (Use applies both; Cancel writes nothing).
      const hasMapping = node.data.answers.some(
        (a) => a.no_preference === true || answerHasSelection(a),
      );
      if (!hasMapping && hasNarrowFields) {
        setPickerOpen(true);
        return;
      }
    }
    apply(k);
  };

  // The dialog's Use: the role change (its D9 loss) and the field in ONE
  // commit, with one Undo that restores both.
  const applyField = (field: string) => {
    setPickerOpen(false);
    const base = latest();
    const snap = snapFor(base);
    const moved = isFilter ? { doc: base, lost: {} } : changeQuestionRole(base, node.id, "filter");
    const applied = applyNarrowField(moved.doc, node.id, productIndex, field);
    // Re-picking the current field is a no-op: re-seeding would overwrite
    // hand-tuned per-answer values with guesses.
    if (!applied) return;
    onCommit(applied.doc);
    const msg = [
      ROLE_LOSS_COPY.narrowApplied(fieldSlotLabel(field), applied.mapped, applied.unmatched),
      lossMessage(base, moved.lost),
    ]
      .filter(Boolean)
      .join(" · ");
    announce(msg, snap);
  };

  const narrowLabel = derivedNarrowLabel(node.data.answers);
  const pill =
    variant === "pane" ? (
      <button
        type="button"
        className="qz-lg-rolebtn"
        aria-label={ROLE_LOSS_COPY.pillLabel(qIndex, label)}
        data-pane-control="role"
      >
        {label} <span className="qz-lg-cv" aria-hidden>▾</span>
      </button>
    ) : variant === "overview" ? (
      <button
        type="button"
        className={`qz-ovw-role${isDecider ? " is-decider" : ""}`}
        aria-label={ROLE_LOSS_COPY.pillLabel(qIndex, label)}
      >
        {label} <span className="qz-ovw-role-caret" aria-hidden>▾</span>
      </button>
    ) : (
      <button
        type="button"
        className={`qz-ltab-pill${isDecider ? " is-start" : ""} qz-ltab-pill-btn`}
        aria-label={ROLE_LOSS_COPY.pillLabel(qIndex, label)}
      >
        {label}{" "}
        <span className="qz-ltab-caret" aria-hidden>
          ▾
        </span>
      </button>
    );

  const title = `Question ${qIndex} does`;
  return (
    <div
      className={
        variant === "overview"
          ? "qz-ovw-rolestack"
          : variant === "pane"
            ? "qz-lg-rolestack"
            : "qz-ltab-rolestack"
      }
    >
      <QzPopover
        open={open}
        onOpenChange={setOpen}
        width={300}
        maxWidth={300}
        align={variant === "pane" ? "end" : "start"}
        ariaHaspopup="menu"
        manageFocus
        closeOnAnchorHidden
        className="qz-lg-pop"
        offset={6}
        trigger={pill}
        content={
          <>
            <div className="qz-lg-pt">{title}</div>
            <div role="menu" aria-label={title} data-testid="role-menu">
              {ROLE_MENU.map((j) => {
                const on = j.k === cur;
                const disabled = j.k === "decides" && cannotDecide;
                const extra =
                  (j.k === "decides" && !isDecider && deciderQIndex !== null
                    ? ROLE_LOSS_COPY.moves(deciderQIndex)
                    : "") + (isFilter && j.k !== "filter" && valueCount > 0 ? ROLE_LOSS_COPY.clearsValues(qIndex) : "");
                return (
                  <button
                    key={j.k}
                    type="button"
                    role="menuitemradio"
                    aria-checked={on}
                    disabled={disabled}
                    className={`qz-lg-mi qz-lg-mi2${on ? " is-on" : ""}`}
                    onClick={() => setJob(j.k)}
                  >
                    <span className="qz-lg-mi2-t">{j.n}</span>
                    <span className="qz-lg-mi2-d">
                      {disabled ? ROLE_LOSS_COPY.cannotPick : j.hint}
                      {disabled ? "" : extra}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="qz-lg-pfoot">{ROLE_MENU_FOOT}</div>
          </>
        }
      />
      {isFilter ? (
        hasNarrowFields ? (
          narrowLabel === "nothing yet" ? (
            <button
              type="button"
              className="qz-ap-slot is-empty"
              title={ROLE_LOSS_COPY.attrChooseTip}
              onClick={() => setPickerOpen(true)}
            >
              {ROLE_LOSS_COPY.attrChoose}
            </button>
          ) : (
            <button
              type="button"
              className="qz-ap-slot"
              title={ROLE_LOSS_COPY.attrTip(narrowLabel)}
              onClick={() => setPickerOpen(true)}
            >
              <span>
                narrows on <b>{narrowLabel}</b>
              </span>
            </button>
          )
        ) : variant === "overview" ? (
          <span className="qz-ltab-attr" title={`narrows on ${narrowLabel}`}>
            narrows on <b>{narrowLabel}</b>
          </span>
        ) : (
          <span className="qz-ap-slot" title={`narrows on ${narrowLabel}`}>
            <span>
              narrows on <b>{narrowLabel}</b>
            </span>
          </span>
        )
      ) : null}
      {pickerOpen ? (
        <AttributePickerDialog
          qIndex={qIndex}
          productIndex={productIndex}
          currentField={isFilter ? derivedField : null}
          onCancel={() => setPickerOpen(false)}
          onUse={applyField}
        />
      ) : null}
    </div>
  );
}
