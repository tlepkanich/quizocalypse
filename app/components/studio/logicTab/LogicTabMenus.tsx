import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { isFreeformType } from "../../../lib/quizSchema";
import type { Quiz, Answer } from "../../../lib/quizSchema";
import type { BuilderCategory } from "../../builder/stepProps";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import type { OrderedQuestion } from "../../../lib/questionOrder";
import { answerNextNode } from "../../../lib/pathAnalyzer";
import { moveDecider, setAnswerRoute, setQuestionRole } from "../../../lib/quizMutations";
import { filterAnswerMatchingProducts } from "../../../lib/filterMatching";
import { formatMoney } from "../../../lib/formatMoney";
import { formatTimeAgo } from "../../../lib/formatDate";
import {
  answerHasSelection,
  applyNarrowField,
  derivedNarrowField,
  derivedNarrowLabel,
  narrowAppliedToast,
  popoverShopifyUrl,
  ROLE_FOOT,
  ROLE_JOBS,
} from "./logicTabFields";
import { AttributePickerDialog } from "./AttributePickerDialog";
import { QzPopover } from "../../qz-overlays";
import { useQzToast } from "../../qz-toast";

// ════════════════════════════════════════════════════════════════════════════
// Logic tab (HANDOFF §6.4/§6.5 + DECISIONS) — the cell popovers that SURVIVED
// the UNIFIED one-window (P10/P11): the product menu behind every count and
// the forward-only route menu. QRTZ-H5 adds back the ONE role menu (the
// mock's role popover, shared.mjs 443–452) as QuestionRoleControl — shared
// verbatim by the Overview ledger and the Logic table so the role-flip flow
// can never drift between surfaces; answer MAPPING still lives in
// QuestionWindow.tsx (reached through the mapping cells). All popovers ride
// QzPopover (portal to body: the builder's preview pane pointer-traps
// in-flow overlays; one-at-a-time registry; Esc/outside close). Every write
// goes through a pure mutation → commit(next).
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;
type Commit = (doc: QuizDoc) => void;

function MenuShell({
  title,
  footer,
  children,
}: {
  title?: ReactNode;
  /** QRTZ-S6 — mock .pop-foot/.pp-foot: a quiet teaching sentence at the end. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="qz-ltab-menu">
      {title ? <div className="qz-ltab-menu-title">{title}</div> : null}
      {children}
      {footer ? <div className="qz-ltab-menu-foot">{footer}</div> : null}
    </div>
  );
}

function MenuRow({
  onClick,
  current,
  children,
  sub,
}: {
  onClick?: () => void;
  current?: boolean;
  children: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`qz-ltab-menu-row${current ? " is-current" : ""}`}
      onClick={onClick}
    >
      <span className="qz-ltab-menu-row-main">{children}</span>
      {sub ? <span className="qz-ltab-menu-row-sub">{sub}</span> : null}
    </button>
  );
}

const truncate = (s: string, n = 24) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ── §6.4 the product menu — behind every count ──────────────────────────────

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
): { label: string; tone: "is-col" | "is-a" } | null {
  if (role === "decides") {
    const cat = answer.target_id ? catById.get(answer.target_id) : undefined;
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
}) {
  const [open, setOpen] = useState(false);
  const products = useMemo(() => {
    if (role === "decides") {
      const cat = answer.target_id ? catById.get(answer.target_id) : undefined;
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
  }, [answer, role, catById, productIndex]);
  const kind = popoverKind(role, answer, catById);
  // QRTZ-H3 (mock .pp-title) — the title is the TARGET's name where one
  // exists (decides); a narrows selection has no single name (no mock
  // drawing) and keeps the answer text.
  const targetCat =
    role === "decides" && answer.target_id ? catById.get(answer.target_id) : undefined;
  const ppTitle = targetCat?.name ?? answer.text;
  // QRTZ-B2 — the mock's .pp-foot "Open in Shopify": derived from the SAME
  // target the popover lists; kinds without a reliable admin URL get no link.
  const shopUrl = popoverShopifyUrl(
    shopifyAdminDomain,
    role,
    answer,
    role === "decides" && answer.target_id ? catById.get(answer.target_id) : undefined,
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

// ── §6.5 the route menu — forward-only ──────────────────────────────────────

export function RouteMenuButton({
  doc,
  q,
  answer,
  questions,
  commit,
  label,
}: {
  doc: QuizDoc;
  q: OrderedQuestion;
  answer: Answer;
  questions: OrderedQuestion[];
  commit: Commit;
  label: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const nextQ = questions.find((x) => x.qIndex === q.qIndex + 1);
  const later = questions.filter((x) => x.qIndex > q.qIndex + 1);
  const resultNode = doc.nodes.find((n) => n.type === "result");
  // UNIFIED (mock routeMenu) — the current destination is marked. Resolved
  // the same way the route CELL resolves it: walk past content steps to the
  // next question / results.
  const current = useMemo((): "next" | "results" | string | null => {
    let nextId = answerNextNode(doc, q.node.id, answer.edge_handle_id);
    const qByNode = new Map(questions.map((x) => [x.node.id, x.qIndex]));
    for (let hops = 0; nextId && hops < 24; hops++) {
      const cur = nextId;
      if (qByNode.has(cur)) break;
      const node = doc.nodes.find((n) => n.id === cur);
      if (!node || node.type === "result" || node.type === "end") break;
      nextId = doc.edges.find((e) => e.source === cur)?.target ?? null;
    }
    if (!nextId) return null;
    const nq = qByNode.get(nextId);
    if (nq === undefined) return "results";
    return nq === q.qIndex + 1 ? "next" : nextId;
  }, [doc, q, answer, questions]);
  return (
    <QzPopover
      open={open}
      onOpenChange={setOpen}
      maxWidth={320}
      trigger={<button type="button" className="qz-ltab-cellbtn">{label}</button>}
      content={
        <MenuShell title={`${answer.text} · goes to`}>
          <MenuRow
            current={current === "next"}
            sub={
              nextQ ? truncate(nextQ.node.data.text, 34) : "straight to the results"
            }
            onClick={() => {
              commit(setAnswerRoute(doc, q.node.id, answer.id, null));
              setOpen(false);
            }}
          >
            The next question
          </MenuRow>
          {later.map((x) => (
            <MenuRow
              key={x.node.id}
              current={current === x.node.id}
              sub={`skips ${x.qIndex - q.qIndex - 1} question${
                x.qIndex - q.qIndex - 1 === 1 ? "" : "s"
              }`}
              onClick={() => {
                commit(setAnswerRoute(doc, q.node.id, answer.id, x.node.id));
                setOpen(false);
              }}
            >
              Q{x.qIndex} — {truncate(x.node.data.text, 28)}
            </MenuRow>
          ))}
          {resultNode ? (
            <>
              <div className="qz-ltab-menu-sep" aria-hidden />
              <MenuRow
                current={current === "results"}
                onClick={() => {
                  commit(setAnswerRoute(doc, q.node.id, answer.id, resultNode.id));
                  setOpen(false);
                }}
              >
                Straight to the results
              </MenuRow>
            </>
          ) : null}
        </MenuShell>
      }
    />
  );
}

// ── QRTZ-H5 — the ONE role control (pill → role menu → attribute dialog) ────

const stripQ = (s: string) => s.replace(/\s*\?\s*$/, "");

/* QRTZ-OB1 (mock role popover, shared.mjs 443–452) + QRTZ-H2 (mock .ap +
   .attr-slot) + QRTZ-H5 (owner unification): the role pill, its "Question N
   does" menu, the derived attr-slot and the attribute dialog as ONE shared
   control. The Overview ledger and the Logic table render the SAME component
   (variant only swaps the pill's dress), so:
     - every role write is the same barrel mutation (moveDecider promotes,
       setQuestionRole demotes — QuestionWindow's setJob semantics);
     - flipping an UNMAPPED question to Narrows opens the dialog INSTEAD of
       the role write — role + field + seeded values commit TOGETHER through
       applyNarrowField on Use, so Cancel leaves zero half-state (there is no
       role write to revert — reverting a decides→filter flip would have to
       run moveDecider back, which wipes the decider's answer targets);
     - the derived-attribute line is the mock's attr-slot: a picker that
       opens the SAME dialog to change the field (never the QuestionWindow —
       the owner's H5 call: one surface everywhere). */
export function QuestionRoleControl({
  doc,
  node,
  qIndex,
  deciderQIndex,
  productIndex,
  hasNarrowFields,
  onCommit,
  variant,
}: {
  doc: QuizDoc;
  node: OrderedQuestion["node"];
  qIndex: number;
  /** The current decider's question number (for "now on QN"), null if none. */
  deciderQIndex: number | null;
  productIndex: IndexedProduct[];
  /** narrowFieldOptions(productIndex).length > 0, memoized ONCE per surface. */
  hasNarrowFields: boolean;
  onCommit: Commit;
  /** Pill dress only — the flow is identical: "overview" = the ledger's
   *  .qz-ovw-role tag, "table" = the Logic table's .qz-ltab-pill. */
  variant: "overview" | "table";
}) {
  const toast = useQzToast();
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const role = node.data.role;
  const isDecider = role === "decides";
  const isFilter = role === "filter";
  const cannotDecide =
    node.data.question_type === "multi_select" || isFreeformType(node.data.question_type);
  const label = isDecider ? "Picks the result" : isFilter ? "Narrows" : "Asked only";
  const derivedField = derivedNarrowField(node.data.answers);

  // Mirrors QuestionWindow's setJob byte-for-byte in semantics: promote via
  // moveDecider (one decider per quiz), demote via setQuestionRole.
  const setJob = (job: (typeof ROLE_JOBS)[number]["k"]) => {
    setOpen(false);
    if (job === "decides") {
      if (isDecider) return;
      const prev = doc.nodes.find(
        (n) => n.type === "question" && n.data.role === "decides",
      );
      onCommit(moveDecider(doc, node.id));
      if (prev && prev.id !== node.id && prev.type === "question")
        toast(
          `"${stripQ(node.data.text)}" now picks the result (was "${stripQ(prev.data.text)}")`,
        );
      return;
    }
    if (job === "filter" && isFilter) return;
    if (job === "info" && !isDecider && !isFilter) return;
    if (job === "filter") {
      // QRTZ-H2 — a freshly-flipped Narrows question narrows by NOTHING when
      // no answer carries a selection. With fields to offer, the dialog opens
      // INSTEAD of the role write (Use applies both; Cancel writes nothing).
      // With no narrowable fields the plain role write keeps today's
      // behavior — the Logic window's "anything" mode stays reachable.
      const hasMapping = node.data.answers.some(
        (a) => a.no_preference === true || answerHasSelection(a),
      );
      if (!hasMapping && hasNarrowFields) {
        setPickerOpen(true);
        return;
      }
    }
    onCommit(setQuestionRole(doc, node.id, job === "filter" ? "filter" : "qualifier"));
  };

  // The dialog's Use — ONE commit through applyNarrowField (QRTZ-H5: the
  // role+field+values composition lives in logicTabFields, nowhere else).
  const applyField = (field: string) => {
    setPickerOpen(false);
    const applied = applyNarrowField(doc, node.id, productIndex, field);
    // Re-picking the current field is a no-op — re-seeding would overwrite
    // hand-tuned per-answer values with guesses.
    if (!applied) return;
    onCommit(applied.doc);
    toast(narrowAppliedToast(node.data.text, field, applied.mapped, applied.unmatched));
  };

  const narrowLabel = derivedNarrowLabel(node.data.answers);
  const pill =
    variant === "overview" ? (
      <button
        type="button"
        className={`qz-ovw-role${isDecider ? " is-decider" : ""}`}
        aria-label={`Question ${qIndex} role: ${label}`}
      >
        {label} <span className="qz-ovw-role-caret" aria-hidden>▾</span>
      </button>
    ) : (
      <button
        type="button"
        className={`qz-ltab-pill${isDecider ? " is-start" : ""} qz-ltab-pill-btn`}
        aria-label={`Question ${qIndex} role: ${label}`}
      >
        {label}{" "}
        <span className="qz-ltab-caret" aria-hidden>
          ▾
        </span>
      </button>
    );

  return (
    <div className={variant === "overview" ? "qz-ovw-rolestack" : "qz-ltab-rolestack"}>
      <QzPopover
        open={open}
        onOpenChange={setOpen}
        maxWidth={340}
        trigger={pill}
        content={
          // QRTZ-H2 — the owner-reported cutoff was the row LABELS: the sub
          // hint's flex:0 0 auto squeezed the main ("Narrows" → "Narro…").
          // The scoped class flips the shrink side (see the H2 CSS section).
          <div className="qz-ltab-menu qz-h2-rolemenu">
            {/* Mock .pop-head ("Question 1 does", shared.mjs line 444). */}
            <div className="qz-ltab-menu-title">Question {qIndex} does</div>
            {ROLE_JOBS.map((j) => {
              const on =
                j.k === "decides" ? isDecider : j.k === "filter" ? isFilter : !isDecider && !isFilter;
              const sub =
                j.k === "decides" && cannotDecide
                  ? "needs single-answer choices"
                  : j.k === "decides" && deciderQIndex !== null && !isDecider
                    ? `now on Q${deciderQIndex}`
                    : j.hint;
              return (
                <button
                  key={j.k}
                  type="button"
                  className={`qz-ltab-menu-row${on ? " is-current" : ""}`}
                  disabled={j.k === "decides" && cannotDecide}
                  onClick={() => setJob(j.k)}
                >
                  <span className="qz-ltab-menu-row-main">{j.n}</span>
                  <span className="qz-ltab-menu-row-sub">{sub}</span>
                </button>
              );
            })}
            {/* Mock .pop-foot verbatim (shared.mjs line 451). */}
            <div className="qz-qwin-rolefoot">{ROLE_FOOT}</div>
          </div>
        }
      />
      {isFilter ? (
        hasNarrowFields ? (
          // QRTZ-H2 (mock .attr-slot, base.mjs 603–618) — the derived line is
          // a PICKER: click opens the dialog to change the field. The
          // unmapped state is the mock's dashed "Choose attribute" slot.
          narrowLabel === "nothing yet" ? (
            <button
              type="button"
              className="qz-ap-slot is-empty"
              title="Choose the attribute this question narrows by"
              onClick={() => setPickerOpen(true)}
            >
              Choose attribute
            </button>
          ) : (
            <button
              type="button"
              className="qz-ap-slot"
              title={`narrows on ${narrowLabel} — change the attribute`}
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
