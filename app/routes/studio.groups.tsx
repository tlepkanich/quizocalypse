import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";
import { useState } from "react";
import { Info, PlugZap, Plus, Sparkles, Trash2, Users } from "lucide-react";
import { QzModal } from "../components/qz-overlays";
import { requireStudioAccess, resolveStudioShop, isStandalone } from "../lib/studioAccess.server";
import prisma from "../db.server";
import { Quiz } from "../lib/quizSchema";
import { collectReferencedCategoryIds } from "../lib/quizPublish";
import { QzPage, QzEmpty } from "../components/qz";
import { GroupWizard, type WizProduct } from "../components/studio/GroupWizard";
import { PersonaExplainerStrip } from "../components/studio/PersonaExplainerStrip";
import {
  dominantSource,
  normalizeMembership,
  resolveMembership,
  MembershipSchema,
  PersonaSchema,
  type Membership,
  type Persona,
  type ResolvableProduct,
  type StoredMembership,
} from "../lib/groupMembership";

const SRC_ORDER = ["tag", "col", "meta", "man"] as const;
type Src = (typeof SRC_ORDER)[number];

// Flatten a product's metafields Json ({ "ns.key": { value } } or primitives)
// into "ns.key: value" condition strings.
function metafieldValuesOf(mf: unknown): string[] {
  if (!mf || typeof mf !== "object") return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(mf as Record<string, unknown>)) {
    const val = v && typeof v === "object" && "value" in (v as object) ? String((v as { value: unknown }).value) : String(v);
    out.push(`${k}: ${val}`);
  }
  return out;
}

function dominantAccent(m: Membership, fallbackSource: string): Src {
  if (m.tags.length) return "tag";
  if (m.collections.length) return "col";
  if (m.metafields.length) return "meta";
  if (m.manual.length) return "man";
  if (fallbackSource === "collection" || fallbackSource === "smart_collection") return "col";
  if (fallbackSource === "metafield") return "meta";
  if (fallbackSource === "manual") return "man";
  return "tag";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();

  const [groups, products, collections, quizzes] = await Promise.all([
    prisma.category.findMany({ where: { shopId: shop.id, quizId: null }, orderBy: { createdAt: "desc" } }),
    prisma.product.findMany({
      where: { shopId: shop.id },
      select: { productId: true, title: true, imageUrl: true, tags: true, collectionIds: true, metafields: true },
    }),
    prisma.collection.findMany({ where: { shopId: shop.id }, select: { collectionId: true, title: true } }),
    prisma.quiz.findMany({ where: { shopId: shop.id }, select: { id: true, name: true, status: true, draftJson: true } }),
  ]);

  const productById = new Map(products.map((p) => [p.productId, p]));
  const colTitle = new Map(collections.map((c) => [c.collectionId, c.title]));

  // §G18/§C4 — which quizzes reference each Group (read-only usage; the mapping
  // itself happens only inside a quiz). Reuses the publish-time reference walker.
  const usageByGroup = new Map<string, Array<{ id: string; name: string; live: boolean }>>();
  for (const q of quizzes) {
    const parsed = Quiz.safeParse(q.draftJson);
    if (!parsed.success) continue;
    for (const catId of collectReferencedCategoryIds(parsed.data)) {
      const arr = usageByGroup.get(catId) ?? [];
      arr.push({ id: q.id, name: q.name, live: q.status === "published" });
      usageByGroup.set(catId, arr);
    }
  }

  // Wizard data (client-side resolution + pickers).
  const wizProducts: WizProduct[] = products.map((p) => ({
    id: p.productId,
    title: p.title,
    imageUrl: p.imageUrl,
    tags: p.tags,
    collectionIds: p.collectionIds,
    metafieldValues: metafieldValuesOf(p.metafields),
  }));
  const allTags = [...new Set(products.flatMap((p) => p.tags))].sort();
  const metafieldConditions = [...new Set(wizProducts.flatMap((p) => p.metafieldValues))].sort();

  return json({
    connected: !isStandalone(shop) || Boolean(shop.shopifyConnectDomain),
    productCount: products.length,
    wizard: {
      tags: allTags,
      collections: collections.map((c) => ({ id: c.collectionId, title: c.title })),
      metafieldConditions,
      products: wizProducts,
    },
    groups: groups.map((g) => {
      const m = normalizeMembership(g.membership);
      const persona = (g.membership as StoredMembership | null)?.persona ?? null;
      const kinds = SRC_ORDER.filter((s) =>
        s === "tag" ? m.tags.length : s === "col" ? m.collections.length : s === "meta" ? m.metafields.length : m.manual.length,
      );
      const dyn = m.tags.length + m.collections.length + m.metafields.length;
      const type = m.manual.length && dyn ? "Hybrid" : m.manual.length ? "Manual" : "Dynamic";
      return {
        id: g.id,
        name: g.name,
        count: g.productIds.length,
        accent: dominantAccent(m, g.source),
        persona: Boolean(persona),
        // §R-2 — persona framing (name + description) for the detail's persona card.
        personaInfo: persona ? { name: persona.name || g.name, description: persona.description || "" } : null,
        type,
        membership: {
          tags: m.tags,
          collections: m.collections.map((c) => colTitle.get(c) ?? c),
          metafields: m.metafields,
          manual: m.manual,
        },
        kinds,
        thumbs: g.productIds.slice(0, 6).map((id) => productById.get(id)?.imageUrl ?? null),
        used: usageByGroup.get(g.id) ?? [],
      };
    }),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const form = await request.formData();
  const intent = form.get("intent");

  // §G18 — delete a Group. Runtime-safe: the baked target map is unaffected;
  // the next PUBLISH of any quiz that mapped it blocks ("mapped result bucket
  // no longer exists") until the mapping is re-picked. Scoped to this shop's
  // account-level (quizId=null) groups.
  if (intent === "delete-group") {
    const id = String(form.get("groupId") ?? "");
    if (id) await prisma.category.deleteMany({ where: { id, shopId: shop.id, quizId: null } });
    return redirect("/studio/groups");
  }

  if (intent !== "create-group") return json({ ok: false }, { status: 400 });

  const name = String(form.get("name") ?? "").trim() || "New group";
  const description = String(form.get("description") ?? "").trim();

  // Zod boundary: validate the submitted membership + persona (§ invariant).
  const parseJson = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  const memParsed = MembershipSchema.safeParse(parseJson(String(form.get("membership") ?? "{}")) ?? {});
  const membership = memParsed.success ? memParsed.data : MembershipSchema.parse({});
  const personaRaw = String(form.get("persona") ?? "");
  const personaParsed = personaRaw ? PersonaSchema.safeParse(parseJson(personaRaw)) : null;
  const persona: Persona | null = personaParsed?.success ? personaParsed.data : null;

  // Resolve productIds server-side from the shop's live catalog.
  const products = await prisma.product.findMany({
    where: { shopId: shop.id },
    select: { productId: true, tags: true, collectionIds: true, metafields: true },
  });
  const resolvable: ResolvableProduct[] = products.map((p) => ({
    id: p.productId,
    tags: p.tags,
    collectionIds: p.collectionIds,
    metafieldValues: metafieldValuesOf(p.metafields),
  }));
  const productIds = resolveMembership(membership, resolvable);
  const src = dominantSource(membership);
  const stored: StoredMembership = { ...membership, persona };

  await prisma.category.create({
    data: {
      shopId: shop.id,
      quizId: null,
      name,
      description,
      tags: membership.tags,
      productIds,
      source: src,
      sourceRef: null,
      manualProductIds: membership.manual,
      membership: stored as never,
      discoveryRunId: `manual-${Date.now().toString(36)}`,
      rationale: null,
    },
  });
  return redirect("/studio/groups");
};

function initial(name: string): string {
  const c = name.replace(/[^A-Za-z]/g, "").charAt(0);
  return c ? c.toUpperCase() : "G";
}

export default function StudioGroups() {
  const { groups, connected, productCount, wizard } = useLoaderData<typeof loader>();
  const [activeId, setActiveId] = useState<string | null>(groups[0]?.id ?? null);
  const [showInfo, setShowInfo] = useState(false);
  const [wizOpen, setWizOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<(typeof groups)[number] | null>(null);
  const active = groups.find((g) => g.id === activeId) ?? groups[0] ?? null;

  return (
    <QzPage wide>
      <PersonaExplainerStrip />

      <div className="qz-row" style={{ gap: 10, marginBottom: 4 }}>
        <span className="qz-src-status">
          <PlugZap size={15} className="qz-src-status-icon" aria-hidden />
          {connected ? "Connected to Shopify" : "Manual catalog"} · {productCount} products ·{" "}
          <Link to="/studio/products" className="qz-link">manage source</Link>
        </span>
        <span style={{ marginLeft: "auto" }} />
        <button type="button" className="qz-btn qz-btn-primary qz-btn-sm" onClick={() => setWizOpen(true)}>
          <Plus size={15} aria-hidden /> New group
        </button>
      </div>

      {groups.length === 0 ? (
        <QzEmpty
          icon={<Users size={22} aria-hidden />}
          title="No groups yet — create your first group to turn your catalog into quiz outcomes."
          action={
            <button type="button" className="qz-btn qz-btn-primary" onClick={() => setWizOpen(true)}>
              <Plus size={15} aria-hidden /> New group
            </button>
          }
        />
      ) : (
        <div className="qz-groups">
          <div className="qz-glist">
            {groups.map((g) => (
              <button
                type="button"
                key={g.id}
                className={`qz-gitem${g.id === active?.id ? " is-active" : ""}`}
                onClick={() => {
                  setActiveId(g.id);
                  setShowInfo(false);
                }}
              >
                <span className={`qz-gtile src-${g.accent}`} aria-hidden>
                  {g.persona ? "◍" : initial(g.name)}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="qz-gname">{g.name}</span>
                  <span className="qz-gmeta">{g.count} products</span>
                </span>
              </button>
            ))}
          </div>

          {active ? (
            <div className="qz-gdetail" key={active.id}>
              <div className="qz-gbanner">
                <span className={`qz-gbig src-${active.accent}`} aria-hidden>
                  {active.persona ? "◍" : initial(active.name)}
                </span>
                <div style={{ minWidth: 0 }}>
                  <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>{active.name}</h2>
                  <div className="qz-row" style={{ gap: 6, marginTop: 6 }}>
                    <span className="qz-pill">{active.type}</span>
                    {active.persona ? <span className="qz-pill">persona on</span> : null}
                  </div>
                </div>
                <button
                  type="button"
                  className="qz-icon-btn"
                  style={{ marginLeft: "auto" }}
                  aria-label="How this group is built"
                  aria-pressed={showInfo}
                  onClick={() => setShowInfo((s) => !s)}
                >
                  <Info size={19} aria-hidden />
                </button>
                <button
                  type="button"
                  className="qz-icon-btn"
                  aria-label="Delete group"
                  onClick={() => setDeleteTarget(active)}
                >
                  <Trash2 size={18} aria-hidden />
                </button>
              </div>

              {showInfo ? (
                <div className="qz-gbuild">
                  <b>How it&rsquo;s built:</b> auto-includes products matching the membership below, plus any hand-picked.{" "}
                  {active.persona ? "Persona framing is on — shoppers see a named result." : "No persona — plain product set."}
                </div>
              ) : null}

              <div className="qz-gbody">
                <div className="qz-klabel">Membership</div>
                {/* §R R-2(d) — Dynamic (rule-based, auto-refreshes on catalog
                    change) vs Manual (hand-picked, fixed set) made legible per
                    source, not just the account-level type badge. */}
                {active.membership.tags.length || active.membership.collections.length || active.membership.metafields.length ? (
                  <div className="qz-gmemsub">
                    <span className="qz-gmemtag is-dyn">Dynamic · auto-refreshes on catalog change</span>
                    <div className="qz-row" style={{ flexWrap: "wrap", gap: 7 }}>
                      {active.membership.tags.map((t) => <span key={`t${t}`} className="qz-src-chip src-tag">{t}</span>)}
                      {active.membership.collections.map((t) => <span key={`c${t}`} className="qz-src-chip src-col">{t}</span>)}
                      {active.membership.metafields.map((t) => <span key={`m${t}`} className="qz-src-chip src-meta">{t}</span>)}
                    </div>
                  </div>
                ) : null}
                {active.membership.manual.length ? (
                  <div className="qz-gmemsub">
                    <span className="qz-gmemtag is-man">Manual · hand-picked, fixed set</span>
                    <div className="qz-row" style={{ flexWrap: "wrap", gap: 7 }}>
                      <span className="qz-src-chip src-man">{active.membership.manual.length} hand-picked product{active.membership.manual.length === 1 ? "" : "s"}</span>
                    </div>
                  </div>
                ) : null}
                {active.kinds.length === 0 ? <div className="qz-dim" style={{ fontSize: 12.5, marginBottom: 18 }}>No criteria yet — add tags, collections, metafields, or hand-pick products.</div> : null}
                {/* §R-2 — the union resolves to one deduped set. */}
                {active.count > 0 && active.kinds.length ? (
                  <div className="qz-gunion">
                    <span aria-hidden>→</span> <b>{active.count} unique</b> product{active.count === 1 ? "" : "s"}, deduped across the sources above.
                  </div>
                ) : null}

                {/* §R-2 — the persona layer becomes the shopper's result. */}
                {active.personaInfo ? (
                  <>
                    <div className="qz-klabel" style={{ marginTop: 16 }}>
                      Persona <span className="qz-dim" style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· becomes the shopper&rsquo;s result</span>
                    </div>
                    <div className="qz-gpersona">
                      <span className="qz-gpersona-av" aria-hidden><Sparkles size={18} /></span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>&ldquo;You&rsquo;re a {active.personaInfo.name}&rdquo;</div>
                        {active.personaInfo.description ? (
                          <div className="qz-dim" style={{ fontSize: 11.5 }}>{active.personaInfo.description}</div>
                        ) : null}
                      </div>
                    </div>
                  </>
                ) : null}
                <div style={{ marginBottom: 18 }} />

                <div className="qz-klabel">Products in this group ({active.count})</div>
                <div className="qz-gmosaic">
                  {active.thumbs.map((src, i) =>
                    src ? (
                      <img key={i} src={src} alt="" loading="lazy" className="qz-gthumb" />
                    ) : (
                      <span key={i} className="qz-gthumb" aria-hidden>◫</span>
                    ),
                  )}
                  {active.count > active.thumbs.length ? (
                    <span className="qz-gthumb qz-gthumb-more">+{active.count - active.thumbs.length}</span>
                  ) : null}
                  {active.count === 0 ? <span className="qz-dim" style={{ fontSize: 12.5 }}>No products yet</span> : null}
                </div>

                <div className="qz-gused">
                  {active.used.length
                    ? `Used as an outcome in ${active.used.length} quiz${active.used.length > 1 ? "zes" : ""}`
                    : "Not yet used in a quiz"}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}

      <GroupWizard
        open={wizOpen}
        onClose={() => setWizOpen(false)}
        tags={wizard.tags}
        collections={wizard.collections}
        metafieldConditions={wizard.metafieldConditions}
        products={wizard.products}
      />

      {/* §G18 — delete a Group: warn + list affected live quizzes. */}
      <QzModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        size="sm"
        title="Delete this group?"
        destructive
        footer={
          <div className="qz-row" style={{ width: "100%", gap: 10 }}>
            <button type="button" className="qz-btn qz-btn-sm" onClick={() => setDeleteTarget(null)}>Cancel</button>
            <span style={{ marginLeft: "auto" }} />
            <Form method="post" onSubmit={() => setDeleteTarget(null)}>
              <input type="hidden" name="intent" value="delete-group" />
              <input type="hidden" name="groupId" value={deleteTarget?.id ?? ""} />
              <button type="submit" className="qz-btn qz-btn-danger qz-btn-sm">Delete group</button>
            </Form>
          </div>
        }
      >
        {deleteTarget ? (
          <>
            <p style={{ margin: 0, fontSize: 14 }}>
              <b>{deleteTarget.name}</b> will be removed. This can&rsquo;t be undone.
            </p>
            {deleteTarget.used.length ? (
              <div className="qz-banner qz-banner-warn" style={{ marginTop: 12 }}>
                <div className="qz-banner-body">
                  Used as an outcome in {deleteTarget.used.length} quiz
                  {deleteTarget.used.length > 1 ? "zes" : ""}: {deleteTarget.used.map((u) => u.name).join(", ")}. Live
                  quizzes keep working on their baked results until you republish them — after which the mapping must be
                  re-picked before they can publish again.
                </div>
              </div>
            ) : (
              <p className="qz-muted" style={{ margin: "10px 0 0", fontSize: 13 }}>Not used in any quiz.</p>
            )}
          </>
        ) : null}
      </QzModal>
    </QzPage>
  );
}
