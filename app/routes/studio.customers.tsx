import { useMemo, useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import prisma from "../db.server";
import { QzPage, QzPageHeader, QzCard, QzBadge } from "../components/qz";
import { QzDrawer } from "../components/qz-overlays";
import { formatDate } from "../lib/formatDate";
import { totalRevenue, formatRevenue } from "../lib/funnelAggregation";
import { SEGMENTS, summarizeSegments } from "../lib/customerSegments";
import { loadCustomerContacts, type HubContact } from "../lib/customerHub.server";

// §R-8 / §S — Customers = a re-engagement HUB (not a contact list): KPI row,
// smart segments (flagship "Recommended → didn't buy"), zero-party profiles,
// and one-click actions (CSV export resource route; Klaviyo/flow sends route to
// the connected integrations). Zero-party data = email/phone + persona +
// answers + matched products + purchase status, from EmailCapture → QuizSession.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const contacts = await loadCustomerContacts(shop.id);
  const total = contacts.length;
  const counts = summarizeSegments(contacts);

  // Attributed revenue across this shop's quizzes (real; "—" until orders map).
  const quizIds = [...new Set(contacts.map((c) => c.quizId))];
  const revRows = quizIds.length
    ? await prisma.event.findMany({
        where: { quizId: { in: quizIds }, eventType: "order_attributed" },
        select: { sessionId: true, eventType: true, payload: true },
      })
    : [];
  const revenue = revRows.length
    ? formatRevenue(totalRevenue(revRows.map((r) => ({ sessionId: r.sessionId, eventType: r.eventType, payload: r.payload }))))
    : null;

  return json({
    total,
    withPhone: contacts.filter((c) => c.phone).length,
    // Every quiz capture is an explicit opt-in, so consented == total.
    consented: total,
    purchasedPct: total > 0 ? Math.round(((counts.purchased ?? 0) / total) * 100) : null,
    revenue,
    counts,
    contacts,
  });
};

type Contact = HubContact;

function statusOf(c: Contact): { label: string; tone: "ok" | "warn" | "draft" } {
  if (c.session?.converted) return { label: "Bought", tone: "ok" };
  if (c.session && !c.session.completed) return { label: "Abandoned", tone: "warn" };
  if (c.session) return { label: "No purchase yet", tone: "draft" };
  return { label: "—", tone: "draft" };
}

function ProfileRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, fontSize: 13.5, alignItems: "baseline" }}>
      <span className="qz-dim" style={{ fontSize: 12 }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export default function StudioCustomers() {
  const { total, withPhone, consented, purchasedPct, revenue, counts, contacts } = useLoaderData<typeof loader>();
  const [seg, setSeg] = useState<string>("all");
  const [open, setOpen] = useState<Contact | null>(null);
  const [segFilterOpen, setSegFilterOpen] = useState(false);

  const rows = useMemo(
    () =>
      seg === "all"
        ? contacts
        : seg.startsWith("persona:")
          ? contacts.filter((c) => c.persona === seg.slice(8))
          : contacts.filter((c) => c.segments.includes(seg)),
    [contacts, seg],
  );

  // Persona segments (auto-built from the shopper's outcome) for the pill row.
  const personaCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of contacts) if (c.persona) m.set(c.persona, (m.get(c.persona) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [contacts]);

  // The 3 flagship money segments as prototype segcards (didn't-buy is "hot").
  const SEG_CARDS = [
    { key: "didnt_buy", label: "Recommended → didn't buy", blurb: "Warm, hyper-specific. Your #1 win-back audience.", action: "Win-back", note: "syncs traits + fires flow; code auto-applies onsite (no email)", hot: true },
    { key: "abandoned", label: "Abandoned before results", blurb: "Never finished the quiz.", action: "Reminder flow", note: "fires a “come finish” flow with their partial answers", hot: false },
    { key: "back_in_stock", label: "Back-in-stock waiting", blurb: "Wanted an out-of-stock match.", action: "Notify on restock", note: "auto-fires when inventory returns", hot: false },
  ] as const;

  // Label for the collapsed segment-filter toggle (shows what's active).
  const segLabel =
    seg === "all" ? "All contacts"
    : seg === "purchased" ? "Purchased · upsell"
    : seg.startsWith("persona:") ? seg.slice(8)
    : SEG_CARDS.find((s) => s.key === seg)?.label ?? "All contacts";

  return (
    <QzPage>
      <QzPageHeader title="Customer Engagement" />

      {/* Global page header pass — the "Suggested play" band is the FIRST element
          below the title (above the channel chips + KPI row), per the locked
          global-header handoff. Still gated on the real didn't-buy count. */}
      {(counts.didnt_buy ?? 0) > 0 ? (
        <div className="qz-play">
          <span className="qz-play-ic" aria-hidden>💡</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="qz-play-eyebrow">Suggested play</div>
            <div className="qz-play-title">
              Win back {counts.didnt_buy} non-buyer{counts.didnt_buy === 1 ? "" : "s"} with the exact product you recommended
            </div>
            <div className="qz-play-sub">
              Sync to Klaviyo with traits + fire the flow; the reward auto-applies onsite when they return — no email required.
            </div>
          </div>
          <button type="button" className="qz-btn qz-btn-primary" onClick={() => setSeg("didnt_buy")}>
            See audience
          </button>
        </div>
      ) : null}

      {/* §S — 5 compact KPI tiles (prototype-v4 kpi5), not big colored widgets. */}
      <div className="qz-kpi5-row">
        <div className="qz-kpi5"><div className="l">Total contacts</div><div className="n">{total}</div></div>
        <div className="qz-kpi5"><div className="l">With phone</div><div className="n">{withPhone}</div></div>
        <div className="qz-kpi5"><div className="l">Consented</div><div className="n" style={{ color: "var(--qz-ok)" }}>{consented}</div></div>
        <div className="qz-kpi5"><div className="l">% purchased</div><div className="n">{purchasedPct != null ? `${purchasedPct}%` : "—"}</div></div>
        <div className="qz-kpi5"><div className="l">Attributed rev</div><div className="n">{revenue ?? "—"}</div></div>
      </div>

      {total === 0 ? (
        <QzCard>
          <p className="qz-muted" style={{ margin: 0 }}>
            No contacts yet. Add an email step to a quiz — captures land here the moment a shopper
            submits, and we&rsquo;ll segment them by persona and purchase intent automatically.
          </p>
        </QzCard>
      ) : (
        <>
          {/* Smart segments — the 3 flagship money segments as cards, then
              persona/attribute segments as pills. All filter the table below. */}
          <div className="qz-label" style={{ fontSize: 11, margin: "8px 0 12px" }}>Smart segments · one-click re-engage</div>
          <div className="qz-segcard-grid">
            {SEG_CARDS.map((s) => (
              <div
                key={s.key}
                role="button"
                tabIndex={0}
                className={`qz-segcard${s.hot ? " is-hot" : ""}${seg === s.key ? " is-active" : ""}`}
                onClick={() => setSeg(s.key)}
                onKeyDown={(e) => { if (e.key === "Enter") setSeg(s.key); }}
              >
                <div className="qz-segcard-label">{s.label}</div>
                <div className="qz-segcard-count">{counts[s.key] ?? 0}</div>
                <div className="qz-segcard-blurb">{s.blurb}</div>
                <div className="qz-segacts" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className={`qz-segact${s.hot ? " is-pri" : ""}`} onClick={() => setSeg(s.key)}>{s.action}</button>
                  <Link to="/studio/integrations" className="qz-segact">Klaviyo</Link>
                  <a href={`/studio/customers/export?segment=${s.key}`} className="qz-segact">CSV</a>
                </div>
                <div className="qz-segcard-note">→ {s.note}</div>
              </div>
            ))}
          </div>
          {/* Re-engagement channels (incl. onsite recognition) sit directly above
              the collapsible segment filter. */}
          <div className="qz-chanrow">
            <Link to="/studio/integrations" className="qz-chan">Klaviyo</Link>
            <Link to="/studio/integrations" className="qz-chan">Onsite recognition</Link>
            <Link to="/studio/integrations" className="qz-chan">Shopify tags &amp; segments</Link>
            <Link to="/studio/integrations" className="qz-chan">Ad audiences</Link>
            <a href="/studio/customers/export?segment=all" className="qz-chan">CSV export</a>
          </div>

          {/* §S — onsite recognition (re-engage with no email). Illustrative
              preview of what a returning shopper sees. Sits above the filter. */}
          <div className="qz-label" style={{ fontSize: 11, margin: "6px 0 10px" }}>Onsite recognition · re-engage with no email</div>
          <QzCard style={{ marginBottom: 18 }}>
            <div className="qz-onsite">
              <div className="qz-onsite-preview">
                <div className="qz-onsite-top">
                  <div style={{ fontSize: 10 }}>Welcome back 👋</div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>You&rsquo;re a Glow Chaser</div>
                </div>
                <div className="qz-onsite-btm">Your matches, saved. <span style={{ color: "var(--qz-ok)", fontWeight: 600 }}>15% still applied ✓</span></div>
              </div>
              <div className="qz-onsite-copy">
                A returning quiz-taker is recognized (cookie / customer login) → sees their <b>persona + saved matches + reward re-applied</b>, or it <b>auto-applies at checkout</b>. Zero email. The same recognition feeds <b>ad audiences</b> and writes the persona to the <b>Shopify customer record</b>, so Flow, Shopify Email &amp; Audiences all inherit it.
              </div>
            </div>
          </QzCard>

          {/* Segment filter — collapsed by default, opens on click. */}
          <button type="button" className="qz-segfilter-toggle" aria-expanded={segFilterOpen} onClick={() => setSegFilterOpen((v) => !v)}>
            {segFilterOpen ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
            <span>Filter by segment</span>
            <span className="qz-segfilter-current">{segLabel}</span>
          </button>
          {segFilterOpen ? (
            <div className="qz-segpills">
              <button type="button" className={`qz-segpill${seg === "all" ? " is-active" : ""}`} onClick={() => setSeg("all")}>All contacts · {total}</button>
              <button type="button" className={`qz-segpill${seg === "purchased" ? " is-active" : ""}`} onClick={() => setSeg("purchased")}>Purchased · upsell · {counts.purchased ?? 0}</button>
              {personaCounts.map(([name, n]) => (
                <button key={name} type="button" className={`qz-segpill${seg === `persona:${name}` ? " is-active" : ""}`} onClick={() => setSeg(`persona:${name}`)}>{name} · {n}</button>
              ))}
            </div>
          ) : null}

          {/* One-click actions for the selected segment. */}
          <div className="qz-seg-actions">
            <span className="qz-dim" style={{ fontSize: 12.5 }}>
              {rows.length} contact{rows.length === 1 ? "" : "s"} · act on this segment:
            </span>
            <a className="qz-btn qz-btn-primary qz-btn-sm" href={`/studio/customers/export?segment=${seg}`}>
              Export CSV
            </a>
            <Link to="/studio/integrations" className="qz-btn qz-btn-ghost qz-btn-sm">Push to Klaviyo →</Link>
            <Link to="/studio/email" className="qz-btn qz-btn-ghost qz-btn-sm">Trigger email flow →</Link>
            <span className="qz-dim" style={{ fontSize: 11, marginLeft: "auto" }}>
              Contacts opted in by sharing their details in the quiz.
            </span>
          </div>

          <QzCard>
            <div style={{ overflowX: "auto" }}>
              <table className="qz-cust-table">
                <thead>
                  <tr>
                    {["Contact", "Phone", "Persona", "Recommended", "Status", "Captured"].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const st = statusOf(c);
                    return (
                      <tr
                        key={c.id}
                        className="qz-cust-row"
                        onClick={() => setOpen(c)}
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === "Enter") setOpen(c); }}
                      >
                        <td>
                          <div style={{ fontWeight: 600 }}>{c.firstName || c.email.split("@")[0]}</div>
                          <div className="qz-dim" style={{ fontSize: 12 }}>{c.email}</div>
                        </td>
                        <td>{c.phone || <span className="qz-dim">—</span>}</td>
                        <td>{c.persona || <span className="qz-dim">—</span>}</td>
                        <td>
                          {c.session && c.session.matchedCount > 0 ? (
                            <span title={c.session.recommended.join(", ")}>
                              {c.session.recommended[0] ?? `${c.session.matchedCount} products`}
                              {c.session.matchedCount > 1 ? <span className="qz-dim"> +{c.session.matchedCount - 1}</span> : null}
                            </span>
                          ) : (
                            <span className="qz-dim">—</span>
                          )}
                        </td>
                        <td><QzBadge tone={st.tone}>{st.label}</QzBadge></td>
                        <td style={{ whiteSpace: "nowrap", color: "var(--qz-ink-3)" }}>{formatDate(c.capturedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {rows.length === 0 ? (
              <p className="qz-dim" style={{ fontSize: 13, padding: "12px 4px 0" }}>No contacts in this segment yet.</p>
            ) : null}
          </QzCard>

          <p className="qz-dim" style={{ fontSize: 11, marginTop: 12, display: "flex", alignItems: "center", gap: 6 }}>
            🛡 We hand off the audience + trigger + suggestion; your channel does the send. Consent enforced (§N X6); win-backs capped (§N X7).
          </p>
        </>
      )}

      {/* Zero-party profile drawer. */}
      <QzDrawer open={!!open} onClose={() => setOpen(null)} title={open?.firstName || open?.email || "Contact"} subtitle={open?.email}>
        {open ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="qz-row" style={{ gap: 6, flexWrap: "wrap" }}>
              {open.segments.length ? (
                open.segments.map((k) => (
                  <QzBadge key={k} tone={k === "didnt_buy" ? "warn" : "draft"}>
                    {SEGMENTS.find((s) => s.key === k)?.label ?? k}
                  </QzBadge>
                ))
              ) : (
                <span className="qz-dim" style={{ fontSize: 12 }}>No segment</span>
              )}
            </div>
            <ProfileRow label="Phone" value={open.phone || "—"} />
            <ProfileRow label="Quiz" value={<Link to={`/studio/${open.quizId}`} className="qz-link">{open.quizName}</Link>} />
            <ProfileRow label="Persona" value={open.persona || "—"} />
            <ProfileRow label="Answers given" value={open.session ? `${open.session.answerCount}` : "—"} />
            <ProfileRow
              label="Recommended"
              value={
                open.session && open.session.recommended.length ? (
                  <ul style={{ margin: 0, paddingLeft: 16 }}>{open.session.recommended.map((t, i) => <li key={i}>{t}</li>)}</ul>
                ) : open.session && open.session.matchedCount > 0 ? (
                  `${open.session.matchedCount} products`
                ) : (
                  "—"
                )
              }
            />
            <ProfileRow label="Purchase status" value={<QzBadge tone={statusOf(open).tone}>{statusOf(open).label}</QzBadge>} />
            <ProfileRow label="Captured" value={formatDate(open.capturedAt)} />
            <ProfileRow label="Consent" value="Opted in via quiz" />
            <div className="qz-row" style={{ gap: 8, marginTop: 6 }}>
              <a className="qz-btn qz-btn-primary qz-btn-sm" href={`mailto:${open.email}`}>Email contact</a>
              <Link to="/studio/integrations" className="qz-btn qz-btn-ghost qz-btn-sm">Sync to Klaviyo →</Link>
            </div>
          </div>
        ) : null}
      </QzDrawer>
    </QzPage>
  );
}
