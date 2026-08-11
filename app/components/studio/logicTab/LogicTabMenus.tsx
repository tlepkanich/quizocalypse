import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Quiz, Answer } from "../../../lib/quizSchema";
import { isFreeformType } from "../../../lib/quizSchema";
import type { BuilderCategory, BuilderCollection } from "../../builder/stepProps";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import type { OrderedQuestion } from "../../../lib/questionOrder";
import { answerNextNode } from "../../../lib/pathAnalyzer";
import {
  moveDecider,
  setAnswerFilterValues,
  setAnswerRoute,
  setAnswerTarget,
  setQuestionNarrowField,
  setQuestionRole,
} from "../../../lib/quizMutations";
import { filterAnswerMatchingProducts } from "../../../lib/filterMatching";
import { formatMoney } from "../../../lib/formatMoney";
import { QzPopover } from "../../qz-overlays";
import { useQzToast } from "../../qz-toast";
import {
  answerValuesForField,
  fieldValues,
  narrowFieldOptions,
  writeValuesForField,
} from "./logicTabFields";

// ════════════════════════════════════════════════════════════════════════════
// Logic tab (HANDOFF §6 + DECISIONS) — the five popovers, all on QzPopover
// (portal to body: the builder's preview pane pointer-traps in-flow overlays;
// one-at-a-time registry; Esc/outside close). Every write goes through a pure
// mutation → commit(next); nothing here touches the doc directly.
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
  disabled,
  children,
  sub,
  indent,
  detail,
}: {
  onClick?: () => void;
  current?: boolean;
  disabled?: boolean;
  children: ReactNode;
  sub?: ReactNode;
  indent?: boolean;
  /** QRTZ-S6 — mock .ap-vals: a full-width example-values second line. */
  detail?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`qz-ltab-menu-row${current ? " is-current" : ""}${indent ? " is-indent" : ""}${
        detail ? " has-vals" : ""
      }`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="qz-ltab-menu-row-main">{children}</span>
      {sub ? <span className="qz-ltab-menu-row-sub">{sub}</span> : null}
      {detail ? <span className="qz-ltab-menu-row-vals">{detail}</span> : null}
    </button>
  );
}

// ── §6.1 the role menu ──────────────────────────────────────────────────────

export function RoleMenuButton({
  doc,
  q,
  questions,
  productIndex,
  commit,
}: {
  doc: QuizDoc;
  q: OrderedQuestion;
  questions: OrderedQuestion[];
  productIndex: IndexedProduct[];
  commit: Commit;
}) {
  const toast = useQzToast();
  const [open, setOpen] = useState(false);
  const [narrowsOpen, setNarrowsOpen] = useState(false);
  const [fieldQuery, setFieldQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<
    "all" | "tag" | "metafield" | "variant" | "ptype"
  >("all");

  const role = q.node.data.role;
  const narrowField = q.node.data.narrow_field ?? null;
  const decider = questions.find((x) => x.node.data.role === "decides");
  const cannotDecide =
    q.node.data.question_type === "multi_select" ||
    isFreeformType(q.node.data.question_type);

  const fields = useMemo(() => narrowFieldOptions(productIndex), [productIndex]);
  const shownFields = fields.filter(
    (f) =>
      (kindFilter === "all" || f.kind === kindFilter) &&
      (!fieldQuery || f.label.toLowerCase().includes(fieldQuery.toLowerCase())),
  );
  // QRTZ-S6 (mock .ap) — per-kind tab counts, example values per field, and a
  // select-then-Use commit: a row click only HIGHLIGHTS; Use commits, Cancel
  // abandons. `field: null` = the "Anything" mode pending.
  const [pendingNarrow, setPendingNarrow] = useState<{ field: string | null } | null>(
    null,
  );
  const kindCounts = useMemo(() => {
    const counts: Record<"tag" | "metafield" | "variant" | "ptype", number> = {
      tag: 0,
      metafield: 0,
      variant: 0,
      ptype: 0,
    };
    for (const f of fields) counts[f.kind]++;
    return counts;
  }, [fields]);
  const fieldSamples = useMemo(() => {
    const samples = new Map<string, string>();
    for (const f of fields) {
      samples.set(
        f.field,
        fieldValues(productIndex, f.field)
          .slice(0, 4)
          .map((v) => v.label)
          .join(" · "),
      );
    }
    return samples;
  }, [fields, productIndex]);

  const close = () => {
    setOpen(false);
    setNarrowsOpen(false);
    setFieldQuery("");
    setPendingNarrow(null);
  };

  // Use — the one commit for the picker (mock .ap-foot). Same writes the old
  // click-commit rows made; the toast still marks a changed field.
  const commitNarrow = () => {
    if (!pendingNarrow) return;
    const field = pendingNarrow.field;
    const changed = !(role === "filter" && narrowField === field);
    let next = setQuestionRole(doc, q.node.id, "filter");
    next = setQuestionNarrowField(next, q.node.id, field);
    commit(next);
    if (changed && field) {
      const opt = fields.find((f) => f.field === field);
      toast(
        `"${truncate(q.node.data.text)}" now narrows by ${opt?.label ?? field} — map its answers`,
      );
    }
    close();
  };

  const fieldLabel = (field: string | null) =>
    field ? fields.find((f) => f.field === field)?.label ?? field.replace(/^(mf|tag):/, "") : null;

  const pill =
    role === "decides" ? (
      <button type="button" className="qz-ltab-pill is-start qz-ltab-pill-btn">
        ◆ Starting set ▾
      </button>
    ) : role === "filter" ? (
      <button type="button" className="qz-ltab-pill is-narrow qz-ltab-pill-btn">
        Narrows · {narrowField ? fieldLabel(narrowField) : "Anything"} ▾
      </button>
    ) : (
      <button type="button" className="qz-ltab-pill qz-ltab-pill-btn">
        Info only ▾
      </button>
    );

  return (
    <QzPopover
      open={open}
      onOpenChange={(o) => (o ? setOpen(true) : close())}
      trigger={pill}
      maxWidth={380}
      content={
        <MenuShell
          title={q.node.data.text}
          // QRTZ-S6 (mock .pop-foot) — the one-decider rule, in the product's
          // locked vocabulary ("starting set", never "picks the result").
          footer={
            <>
              One question picks the starting set. Every other narrows on a
              single product attribute.
            </>
          }
        >
          <MenuRow
            current={role === "decides"}
            disabled={cannotDecide}
            sub={
              cannotDecide
                ? "needs single-answer choices"
                : decider && decider.node.id !== q.node.id
                  ? `now on Q${decider.qIndex}`
                  : undefined
            }
            onClick={() => {
              if (role === "decides") return close();
              const oldLabel = decider?.node.data.text;
              commit(moveDecider(doc, q.node.id));
              if (oldLabel)
                toast(
                  `Starting set moved from "${truncate(oldLabel)}" to "${truncate(q.node.data.text)}" — map its answers`,
                );
              close();
            }}
          >
            ◆ Starting set
          </MenuRow>
          <MenuRow
            current={role !== "decides" && role !== "filter"}
            onClick={() => {
              if (role !== "decides" && role !== "filter") return close();
              commit(setQuestionRole(doc, q.node.id, "qualifier"));
              close();
            }}
          >
            Info only
          </MenuRow>
          <MenuRow
            current={role === "filter"}
            sub={
              role === "filter"
                ? narrowField
                  ? `by ${fieldLabel(narrowField)}`
                  : "anything"
                : undefined
            }
            onClick={() => setNarrowsOpen((v) => !v)}
          >
            Narrows {narrowsOpen ? "▾" : "▸"}
          </MenuRow>
          {narrowsOpen ? (
            <div className="qz-ltab-menu-section">
              {/* §6.1 — "Anything" is the ABSENCE of a field, not a rival mode.
                  QRTZ-S6 — rows only select; the footer's Use commits. */}
              <MenuRow
                indent
                current={
                  pendingNarrow
                    ? pendingNarrow.field === null
                    : role === "filter" && !narrowField
                }
                sub="each answer picks its own"
                onClick={() => setPendingNarrow({ field: null })}
              >
                Anything
              </MenuRow>
              <div className="qz-ltab-menu-chips">
                {/* G5 widening — variant options + product type now match.
                    QRTZ-S6 (mock .seg-count) — per-kind field counts. */}
                {(
                  [
                    ["all", "All", fields.length],
                    ["tag", "Tags", kindCounts.tag],
                    ["metafield", "Metafields", kindCounts.metafield],
                    ["variant", "Variant options", kindCounts.variant],
                    ["ptype", "Type", kindCounts.ptype],
                  ] as const
                ).map(([k, l, n]) => (
                  <button
                    key={k}
                    type="button"
                    className={`qz-ltab-menu-chip${kindFilter === k ? " is-on" : ""}`}
                    onClick={() => setKindFilter(k)}
                  >
                    {l} <span className="qz-ltab-menu-chipcount">{n}</span>
                  </button>
                ))}
              </div>
              <input
                className="qz-ltab-menu-search"
                placeholder="Search your fields…"
                value={fieldQuery}
                onChange={(e) => setFieldQuery(e.target.value)}
              />
              {shownFields.length === 0 ? (
                <div className="qz-ltab-menu-none">No fields found.</div>
              ) : (
                shownFields.slice(0, 24).map((f) => {
                  // QRTZ-S6 (mock .is-thin) — an attribute most products lack
                  // silently drops the rest from every result; flag it.
                  const thin =
                    productIndex.length > 0 &&
                    f.coverage / productIndex.length < 0.5;
                  return (
                    <MenuRow
                      key={f.field}
                      indent
                      current={
                        pendingNarrow
                          ? pendingNarrow.field === f.field
                          : role === "filter" && narrowField === f.field
                      }
                      // §6.1 — the field's source key + coverage ("custom.gender · 23/23").
                      sub={
                        <span className={thin ? "qz-ltab-menu-covthin" : undefined}>
                          {f.field.replace(/^(mf|tag):/, "")} · {f.coverage}/
                          {productIndex.length}
                        </span>
                      }
                      // QRTZ-S6 (mock .ap-vals) — example values, best first.
                      detail={fieldSamples.get(f.field) || undefined}
                      onClick={() => setPendingNarrow({ field: f.field })}
                    >
                      {f.label}
                      {thin ? (
                        <span className="qz-ltab-menu-thin">low coverage</span>
                      ) : null}
                    </MenuRow>
                  );
                })
              )}
              {shownFields.length > 24 ? (
                <div className="qz-ltab-menu-none">
                  +{shownFields.length - 24} more — keep typing
                </div>
              ) : null}
              {/* QRTZ-S6 (mock .ap-foot) — the explicit commit + the lesson. */}
              <div className="qz-ltab-menu-apfoot">
                <span className="qz-ltab-menu-apnote">
                  <b>Coverage matters:</b> a question can only narrow by data
                  your products actually have.
                </span>
                <button
                  type="button"
                  className="qz-btn qz-btn-ghost qz-btn-sm"
                  onClick={close}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="qz-btn qz-btn-primary qz-btn-sm"
                  disabled={!pendingNarrow}
                  onClick={commitNarrow}
                >
                  Use
                </button>
              </div>
            </div>
          ) : null}
        </MenuShell>
      }
    />
  );
}

const truncate = (s: string, n = 24) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ── §6.2 the set menu — Starting set answers (G9: exactly ONE target) ───────

export function StartingSetMenuButton({
  doc,
  q,
  answer,
  categories,
  commit,
}: {
  doc: QuizDoc;
  q: OrderedQuestion;
  answer: Answer;
  categories: BuilderCategory[];
  commit: Commit;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const current = answer.target_id ?? null;
  const cat = current ? categories.find((c) => c.id === current) : undefined;
  const shown = categories.filter(
    (c) => !query || c.name.toLowerCase().includes(query.toLowerCase()),
  );
  const close = () => {
    setOpen(false);
    setQuery("");
  };
  return (
    <QzPopover
      open={open}
      onOpenChange={(o) => (o ? setOpen(true) : close())}
      maxWidth={340}
      trigger={
        cat ? (
          <button type="button" className="qz-ltab-chip qz-ltab-chip-btn">
            {cat.name} ▾
          </button>
        ) : (
          <button type="button" className="qz-ltab-cellbtn qz-ltab-bad">
            pick what it opens ▾
          </button>
        )
      }
      content={
        <MenuShell title={`${answer.text} opens…`}>
          <input
            className="qz-ltab-menu-search"
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {shown.map((c) => (
            <MenuRow
              key={c.id}
              current={c.id === current}
              sub={`${c.productIds.length} products`}
              onClick={() => {
                commit(setAnswerTarget(doc, q.node.id, answer.id, c.id));
                close();
              }}
            >
              {c.name}
            </MenuRow>
          ))}
          {current ? (
            <MenuRow
              onClick={() => {
                commit(setAnswerTarget(doc, q.node.id, answer.id, null));
                close();
              }}
            >
              Clear this answer
            </MenuRow>
          ) : null}
        </MenuShell>
      }
    />
  );
}

// ── §6.2/§6.3 — Narrows answers: Anything mix or the field's values ─────────

export function NarrowsMenuButton({
  doc,
  q,
  answer,
  collections,
  productIndex,
  commit,
  children,
}: {
  doc: QuizDoc;
  q: OrderedQuestion;
  answer: Answer;
  collections: BuilderCollection[];
  productIndex: IndexedProduct[];
  commit: Commit;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const field = q.node.data.narrow_field ?? null;
  const close = () => {
    setOpen(false);
    setQuery("");
  };

  // §6.3 field mode — the field's values with counts.
  const values = useMemo(
    () => (field ? fieldValues(productIndex, field) : []),
    [productIndex, field],
  );
  // §6.2 Anything mode — tags + collections (G8: no products/variants; a
  // several-things answer is what a Group is for).
  const allTags = useMemo(() => {
    const seen = new Map<string, number>();
    for (const p of productIndex)
      for (const t of p.tags) {
        const k = t.trim();
        if (k) seen.set(k, (seen.get(k) ?? 0) + 1);
      }
    return [...seen.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }, [productIndex]);

  const selectedValues = field ? answerValuesForField(answer, field) : [];
  const selectedTags = answer.tags.map((t) => t.toLowerCase());
  const selectedCols = [
    ...(answer.collection_filter ? [answer.collection_filter] : []),
    ...(answer.collection_filters ?? []),
  ];

  const writeAnything = (tags: string[], cols: string[]) => {
    commit(
      setAnswerFilterValues(doc, q.node.id, answer.id, {
        tags,
        collection_filters: cols,
      }),
    );
  };

  const keepsEverything = (
    <MenuRow
      current={answer.no_preference === true}
      onClick={() => {
        commit(setAnswerFilterValues(doc, q.node.id, answer.id, { no_preference: true }));
        close();
      }}
    >
      Keeps everything
    </MenuRow>
  );
  const clearRow = (
    <MenuRow
      onClick={() => {
        commit(setAnswerFilterValues(doc, q.node.id, answer.id, {}));
        close();
      }}
    >
      Clear this answer
    </MenuRow>
  );

  if (field) {
    const shown = values.filter(
      (v) => !query || v.label.toLowerCase().includes(query.toLowerCase()),
    );
    return (
      <QzPopover
        open={open}
        onOpenChange={(o) => (o ? setOpen(true) : close())}
        maxWidth={340}
        trigger={<button type="button" className="qz-ltab-cellbtn">{children}</button>}
        content={
          <MenuShell title={`${answer.text} narrows to…`}>
            {values.length > 8 ? (
              <input
                className="qz-ltab-menu-search"
                placeholder="Search values…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            ) : null}
            {shown.slice(0, 60).map((v) => {
              const on = selectedValues.includes(v.value);
              return (
                <MenuRow
                  key={v.value}
                  current={on}
                  sub={`${v.count}`}
                  onClick={() => {
                    const next = on
                      ? selectedValues.filter((x) => x !== v.value)
                      : [...selectedValues, v.value];
                    commit(
                      setAnswerFilterValues(
                        doc,
                        q.node.id,
                        answer.id,
                        writeValuesForField(field, next),
                      ),
                    );
                  }}
                >
                  {v.label}
                </MenuRow>
              );
            })}
            {shown.length > 60 ? (
              <div className="qz-ltab-menu-none">+{shown.length - 60} more — keep typing</div>
            ) : null}
            {keepsEverything}
            {clearRow}
          </MenuShell>
        }
      />
    );
  }

  const qlc = query.toLowerCase();
  const shownTags = allTags.filter((t) => !query || t.tag.toLowerCase().includes(qlc));
  const shownCols = collections.filter(
    (c) => !query || c.title.toLowerCase().includes(qlc),
  );
  return (
    <QzPopover
      open={open}
      onOpenChange={(o) => (o ? setOpen(true) : close())}
      maxWidth={340}
      trigger={<button type="button" className="qz-ltab-cellbtn">{children}</button>}
      content={
        <MenuShell title={`${answer.text} narrows to…`}>
          <input
            className="qz-ltab-menu-search"
            placeholder="Search tags & collections…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {/* §6.2 — the Selected group pins to the top. */}
          {!query && (selectedCols.length || selectedTags.length) ? (
            <>
              <div className="qz-ltab-menu-group">Selected</div>
              {selectedCols.map((cid) => (
                <MenuRow
                  key={`sel-c:${cid}`}
                  current
                  onClick={() => writeAnything(answer.tags, selectedCols.filter((x) => x !== cid))}
                >
                  {collections.find((c) => c.collectionId === cid)?.title ?? cid}
                </MenuRow>
              ))}
              {answer.tags.map((t) => (
                <MenuRow
                  key={`sel-t:${t}`}
                  current
                  onClick={() =>
                    writeAnything(answer.tags.filter((x) => x !== t), selectedCols)
                  }
                >
                  {t}
                </MenuRow>
              ))}
            </>
          ) : null}
          {shownCols.length ? <div className="qz-ltab-menu-group">Collections</div> : null}
          {shownCols.slice(0, 12).map((c) => {
            const on = selectedCols.includes(c.collectionId);
            return (
              <MenuRow
                key={c.collectionId}
                current={on}
                onClick={() => {
                  const next = on
                    ? selectedCols.filter((x) => x !== c.collectionId)
                    : [...selectedCols, c.collectionId];
                  writeAnything(answer.tags, next);
                }}
              >
                {c.title}
              </MenuRow>
            );
          })}
          {shownTags.length ? <div className="qz-ltab-menu-group">Tags</div> : null}
          {shownTags.slice(0, 24).map((t) => {
            const on = selectedTags.includes(t.tag.toLowerCase());
            return (
              <MenuRow
                key={t.tag}
                current={on}
                sub={`${t.count}`}
                onClick={() => {
                  const next = on
                    ? answer.tags.filter((x) => x.toLowerCase() !== t.tag.toLowerCase())
                    : [...answer.tags, t.tag];
                  writeAnything(next, selectedCols);
                }}
              >
                {t.tag}
              </MenuRow>
            );
          })}
          {shownTags.length > 24 ? (
            <div className="qz-ltab-menu-none">+{shownTags.length - 24} more — keep typing</div>
          ) : null}
          {keepsEverything}
          {clearRow}
        </MenuShell>
      }
    />
  );
}

// ── §6.4 the product menu — behind every count ──────────────────────────────

// QRTZ-S6 — the popover's kind, for the title chip + the footer sentence
// (mock .pp-title's `tag is-col` + .pp-foot). Decides answers take their
// target's source; narrows answers only get a kind when the selection is
// unambiguous (one kind of value), else no chip.
function popoverKind(
  role: "decides" | "qualifier" | "filter" | undefined,
  answer: Answer,
  catById: Map<string, BuilderCategory>,
): { label: string; chipClass: string } | null {
  if (role === "decides") {
    const cat = answer.target_id ? catById.get(answer.target_id) : undefined;
    if (!cat) return null;
    if (cat.source === "collection") return { label: "collection", chipClass: " is-collection" };
    if (cat.source === "tag") return { label: "tag", chipClass: " is-tag" };
    if (cat.source === "metafield") return { label: "metafield", chipClass: " is-metafield" };
    return { label: "group", chipClass: "" };
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
    const chipClass =
      label === "collection"
        ? " is-collection"
        : label === "tag"
          ? " is-tag"
          : label === "metafield"
            ? " is-metafield"
            : "";
    return { label, chipClass };
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
}: {
  answer: Answer;
  role: "decides" | "qualifier" | "filter" | undefined;
  catById: Map<string, BuilderCategory>;
  productIndex: IndexedProduct[];
  label: ReactNode;
  /** QRTZ-S6 — the row's A/B/C key, for the mock's .pp-foot sentence. */
  answerKey?: string;
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
    if (role === "filter") return filterAnswerMatchingProducts(answer, productIndex) ?? [];
    return [];
  }, [answer, role, catById, productIndex]);
  const kind = popoverKind(role, answer, catById);

  return (
    <QzPopover
      open={open}
      onOpenChange={setOpen}
      maxWidth={320}
      trigger={<button type="button" className="qz-ltab-cellbtn">{label}</button>}
      content={
        // QRTZ-S6 (mock .pp) — kind chip in the title, the count as its own
        // line, price + stock on every product row, foot sentence. No
        // "synced from Shopify" line (no sync timestamp reaches this surface)
        // and no "Open in Shopify" (no shop domain reaches it either).
        <MenuShell
          title={
            <>
              “{answer.text}”
              {kind ? (
                <span className={`qz-crm-kind${kind.chipClass}`}>{kind.label}</span>
              ) : null}
            </>
          }
          footer={
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
            ) : undefined
          }
        >
          <div className="qz-ltab-menu-countline">
            <b>{products.length}</b>{" "}
            {products.length === 1 ? "product" : "products"} matched
          </div>
          {products.length === 0 ? (
            <div className="qz-ltab-menu-none">
              Nothing carries this yet. Everyone who lands here reaches your
              safety net instead.
            </div>
          ) : (
            <div className="qz-ltab-menu-products">
              {products.slice(0, 24).map((p) => (
                <div key={p.product_id} className="qz-ltab-menu-product">
                  {p.image_url ? (
                    <img src={p.image_url} alt="" width={22} height={22} loading="lazy" />
                  ) : (
                    <span className="qz-ltab-menu-swatch" aria-hidden />
                  )}
                  <span className="qz-ltab-menu-pmain">
                    <span className="qz-ltab-menu-pname">{p.title}</span>
                    <span className="qz-ltab-menu-pmeta">
                      {p.price ? <span>{formatMoney(p.price)}</span> : null}
                      <span
                        className={`qz-ltab-menu-stock ${
                          p.inventory_in_stock ? "is-ok" : "is-out"
                        }`}
                      >
                        {p.inventory_in_stock ? "In stock" : "Out of stock"}
                      </span>
                    </span>
                  </span>
                </div>
              ))}
              {products.length > 24 ? (
                <div className="qz-ltab-menu-none">+{products.length - 24} more</div>
              ) : null}
            </div>
          )}
        </MenuShell>
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
