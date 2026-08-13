import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Quiz, Answer } from "../../../lib/quizSchema";
import type { BuilderCategory } from "../../builder/stepProps";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import type { OrderedQuestion } from "../../../lib/questionOrder";
import { answerNextNode } from "../../../lib/pathAnalyzer";
import { setAnswerRoute } from "../../../lib/quizMutations";
import { filterAnswerMatchingProducts } from "../../../lib/filterMatching";
import { formatMoney } from "../../../lib/formatMoney";
import { formatTimeAgo } from "../../../lib/formatDate";
import { popoverShopifyUrl } from "./logicTabFields";
import { QzPopover } from "../../qz-overlays";

// ════════════════════════════════════════════════════════════════════════════
// Logic tab (HANDOFF §6.4/§6.5 + DECISIONS) — the two cell popovers that
// SURVIVED the UNIFIED one-window (P10/P11): the product menu behind every
// count and the forward-only route menu. Role/set/narrows editing lives in
// QuestionWindow.tsx now (QRTZ-D2 deleted the orphaned menu buttons). Both
// popovers ride QzPopover (portal to body: the builder's preview pane
// pointer-traps in-flow overlays; one-at-a-time registry; Esc/outside close).
// Every write goes through a pure mutation → commit(next).
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
