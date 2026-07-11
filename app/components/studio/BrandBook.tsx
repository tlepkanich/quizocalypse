import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";
import {
  Fingerprint, MessageSquare, Image as ImageIcon, Palette, Type, Square,
  Camera, ChevronDown, ChevronRight, Lock, Sparkles, Wand2, type LucideIcon,
} from "lucide-react";
import type { BrandIdentity } from "../../lib/brandIdentity";
import { BrandTone, TONE_LABEL, type BrandVoice } from "../../lib/brandGuidelines";
import type { DesignTokens } from "../../lib/quizSchema";
import {
  BRAND_BOOK_SECTIONS,
  BRAND_GROUPS,
  brandBookSummary,
  sectionHealth,
  sectionConfidence,
  type BrandSectionId,
  type SectionHealth,
} from "../../lib/brandBook";

// ════════════════════════════════════════════════════════════════════════════
// Brand book (R-5 redesign) — docs/prototypes/quizocalypse-brand-identity-handoff.md.
// The old flat 10-section accordion (all collapsed, a "What we pulled from" bar,
// cramped scroll-boxes) becomes 6 grouped modules that all start OPEN, a sticky
// grouped checklist with a violet→coral progress bar that fills as the page
// scrolls (+ scroll-spy), and long-form fields shown in full. Three save channels
// via separate fetchers: identity → intent=save · visual tokens → save-tokens ·
// voice → save-voice.
// ════════════════════════════════════════════════════════════════════════════

const SECTION_ICON: Record<BrandSectionId, LucideIcon> = {
  identity: Fingerprint,
  voice: MessageSquare,
  logo: ImageIcon,
  colors: Palette,
  type: Type,
  shape: Square,
  imagery: Camera,
};

const HEALTH_DOT: Record<SectionHealth, string> = { ok: "#28c840", warn: "#e0a116", bad: "#ff5f57" };

// Curated font menu for the Typography dropdowns (all Google-hosted). The stored
// value is appended if it isn't in the list, so an AI-pulled font never vanishes.
const FONT_OPTIONS = [
  "Inter", "Quicksand", "Poppins", "Montserrat", "DM Sans", "Work Sans", "Nunito",
  "Raleway", "Space Grotesk", "Fraunces", "Playfair Display", "Lora", "Merriweather",
  "Roboto", "Open Sans",
];

const IMAGERY_STYLES: { value: NonNullable<BrandIdentity["design"]["imagery_style"]>; label: string }[] = [
  { value: "product_neutral", label: "Product on neutral" },
  { value: "lifestyle", label: "Lifestyle" },
  { value: "editorial", label: "Editorial" },
  { value: "minimal", label: "Minimal" },
];

const COLOR_ROLES: { key: keyof NonNullable<DesignTokens["colors"]>; label: string }[] = [
  { key: "primary", label: "Primary" }, { key: "secondary", label: "Secondary" }, { key: "accent", label: "Accent" },
  { key: "background", label: "Background" }, { key: "surface", label: "Surface" }, { key: "text", label: "Text" }, { key: "muted", label: "Muted" },
];

const EMPTY_VOICE: BrandVoice = { tone_description: "", do_list: [], dont_list: [], sample_phrases: [], forbidden_phrases: [] };

export function BrandBook({
  identity: initialIdentity,
  tokens: initialTokens,
  voice: initialVoice,
}: {
  identity: BrandIdentity | null;
  tokens: DesignTokens;
  voice: BrandVoice | null;
}) {
  const identFetcher = useFetcher();
  const tokFetcher = useFetcher();
  const voiceFetcher = useFetcher();
  const [ident, setIdent] = useState<BrandIdentity | null>(initialIdentity);
  const [tok, setTok] = useState<DesignTokens>(initialTokens);
  const [voice, setVoice] = useState<BrandVoice>(initialVoice ?? EMPTY_VOICE);
  const [active, setActive] = useState<BrandSectionId>("identity");
  // Every module starts OPEN (handoff): the merchant sees the whole book at once.
  const [open, setOpen] = useState<Set<BrandSectionId>>(() => new Set(BRAND_BOOK_SECTIONS.map((s) => s.id)));
  const [fill, setFill] = useState(0); // 0–1 scroll progress for the gradient bar
  const identTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const docRef = useRef<HTMLDivElement | null>(null);

  const summary = useMemo(() => brandBookSummary(ident, tok), [ident, tok]);
  const locked = new Set(ident?.locked_fields ?? []);

  const patchIdent = (fn: (d: BrandIdentity) => BrandIdentity) => {
    if (!ident) return;
    const next = fn(ident);
    setIdent(next);
    if (identTimer.current) clearTimeout(identTimer.current);
    identTimer.current = setTimeout(() => identFetcher.submit({ intent: "save", identity: JSON.stringify(next) }, { method: "post" }), 650);
  };
  const patchTok = (fn: (t: DesignTokens) => DesignTokens) => {
    const next = fn(tok);
    setTok(next);
    if (tokTimer.current) clearTimeout(tokTimer.current);
    tokTimer.current = setTimeout(() => tokFetcher.submit({ intent: "save-tokens", tokens: JSON.stringify(next) }, { method: "post" }), 650);
  };
  const patchVoice = (fn: (v: BrandVoice) => BrandVoice) => {
    const next = fn(voice);
    setVoice(next);
    if (voiceTimer.current) clearTimeout(voiceTimer.current);
    // tone_description is required (min 1) — fall back so a save always validates.
    const payload = { ...next, tone_description: next.tone_description.trim() || "Brand voice" };
    voiceTimer.current = setTimeout(() => voiceFetcher.submit({ intent: "save-voice", voice: JSON.stringify(payload) }, { method: "post" }), 650);
  };

  // Scroll-spy — highlight the section currently nearest the top of the viewport.
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (vis[0]) setActive(vis[0].target.getAttribute("data-sec") as BrandSectionId);
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: [0, 0.5, 1] },
    );
    Object.values(sectionRefs.current).forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, []);

  // Gradient bar fill — reflects how far the module column has scrolled through
  // the viewport. rAF-throttled; the visual transition is disabled under
  // prefers-reduced-motion in CSS (the fill height still tracks position).
  useEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      const el = docRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const span = rect.height - window.innerHeight;
      const frac = span > 4 ? Math.min(1, Math.max(0, -rect.top / span)) : rect.top <= 0 ? 1 : 0;
      setFill(frac);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, []);

  const toggle = (id: BrandSectionId) =>
    setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const jump = (id: BrandSectionId) => {
    setOpen((s) => new Set(s).add(id));
    requestAnimationFrame(() => sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const ed: Editors = { patchIdent, patchTok, patchVoice, locked };

  // §R R-5 — the one place the app celebrates the merchant's colors: a slow
  // flowing gradient built from THEIR palette, reduced-motion-safe (disabled via
  // CSS media query). Doubles as a live read on the saved brand colors.
  const c = tok.colors ?? {};
  const grad = [c.primary, c.accent, c.secondary, c.primary].map((x) => x || "var(--qz-accent)");

  return (
    <>
      <div className="qz-bb-hero" style={{ ["--g1" as string]: grad[0], ["--g2" as string]: grad[1], ["--g3" as string]: grad[2], ["--g4" as string]: grad[3] }}>
        <div className="qz-bb-hero-cap">
          <strong>{summary.ok} of {summary.total} confirmed</strong>
          <span>Your brand, applied to every quiz the AI builds.</span>
        </div>
        {/* Decorative floating brand-icon cluster (right side, animated). */}
        <div className="qz-bb-hero-art" aria-hidden>
          <Palette className="qz-bb-hero-icon i1" size={26} strokeWidth={1.75} />
          <Sparkles className="qz-bb-hero-icon i2" size={20} strokeWidth={1.75} />
          <Type className="qz-bb-hero-icon i3" size={22} strokeWidth={1.75} />
          <Wand2 className="qz-bb-hero-icon i4" size={20} strokeWidth={1.75} />
          <Sparkles className="qz-bb-hero-icon i5" size={14} strokeWidth={1.75} />
        </div>
      </div>

      <div className="qz-bb">
        {/* Left — grouped checklist with a scroll-tracking gradient bar. */}
        <aside className="qz-bb-nav" aria-label="Brand book sections">
          <div className="qz-bb-track" aria-hidden>
            <div className="qz-bb-track-fill" style={{ height: `${Math.round(fill * 100)}%` }} />
          </div>
          <div className="qz-bb-navgroups">
            {BRAND_GROUPS.map((g) => (
              <div key={g.id} className="qz-bb-navgroup">
                <div className="qz-bb-navsub">{g.name}</div>
                {BRAND_BOOK_SECTIONS.filter((s) => s.group === g.id).map((s) => {
                  const h = sectionHealth(s.id, ident, tok);
                  const Icon = SECTION_ICON[s.id];
                  return (
                    <button key={s.id} type="button" className={`qz-bb-navitem${active === s.id ? " is-active" : ""}`} onClick={() => jump(s.id)} aria-current={active === s.id}>
                      <span aria-hidden className="qz-bb-dot" style={{ background: HEALTH_DOT[h] }} />
                      <Icon size={14} strokeWidth={1.75} aria-hidden className="qz-bb-navicon" />
                      <span className="qz-bb-navlabel">{s.name}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </aside>

        {/* Right — the grouped, all-open module column. */}
        <div className="qz-bb-doc" ref={docRef}>
          {BRAND_GROUPS.map((g) => (
            <div key={g.id} className="qz-bb-band">
              <div className="qz-bb-bandhead">
                <span className="qz-bb-bandnum">{g.index}</span>
                <span className="qz-bb-bandname">{g.name}</span>
                <span className="qz-bb-bandtag">— {g.tagline}</span>
              </div>
              {BRAND_BOOK_SECTIONS.filter((s) => s.group === g.id).map((s) => {
                const isOpen = open.has(s.id);
                const Icon = SECTION_ICON[s.id];
                const conf = sectionConfidence(s.id, ident);
                return (
                  <section key={s.id} id={`sec-${s.id}`} data-sec={s.id} ref={(el) => (sectionRefs.current[s.id] = el)} className={`qz-bb-sec${isOpen ? " is-open" : ""}`}>
                    <button type="button" className="qz-bb-sechead" onClick={() => toggle(s.id)} aria-expanded={isOpen}>
                      <span className="qz-bb-secicon" aria-hidden><Icon size={17} strokeWidth={1.75} /></span>
                      <span className="qz-bb-sectitle">
                        <span className="qz-bb-secname">{s.name}</span>
                        {!isOpen ? <span className="qz-bb-sechint">{s.hint}</span> : null}
                      </span>
                      <span className="qz-bb-secmeta">
                        {conf ? <ConfidenceChip c={conf} /> : null}
                        <HealthBadge h={sectionHealth(s.id, ident, tok)} />
                        {isOpen ? <ChevronDown size={16} className="qz-dim" /> : <ChevronRight size={16} className="qz-dim" />}
                      </span>
                    </button>
                    {isOpen ? (
                      <div className="qz-bb-secbody">
                        <p className="qz-bb-usedfor">Used for: {s.usedFor}</p>
                        {renderSection(s.id, ident, tok, voice, ed)}
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          ))}
          <p className="qz-dim qz-bb-presetnote">Style presets are generated automatically from the above.</p>
          <p className="qz-dim qz-bb-foot">
            Applied automatically whenever the AI builds a quiz. Edited fields lock <Lock size={11} style={{ verticalAlign: "-1px" }} /> so a
            re-sync never overwrites them. Saves happen as you type.
          </p>
        </div>
      </div>
    </>
  );
}

function HealthBadge({ h }: { h: SectionHealth }) {
  const label = h === "ok" ? "Confirmed" : h === "warn" ? "Weak" : "Missing";
  return (
    <span className={`qz-bb-badge is-${h}`}>
      <span aria-hidden className="qz-bb-dot" style={{ background: HEALTH_DOT[h] }} />
      {label}
    </span>
  );
}

function ConfidenceChip({ c }: { c: "low" | "medium" | "high" }) {
  return <span className={`qz-bb-conf is-${c}`}>{c} confidence</span>;
}

interface Editors {
  patchIdent: (fn: (d: BrandIdentity) => BrandIdentity) => void;
  patchTok: (fn: (t: DesignTokens) => DesignTokens) => void;
  patchVoice: (fn: (v: BrandVoice) => BrandVoice) => void;
  locked: Set<string>;
}

function renderSection(id: BrandSectionId, ident: BrandIdentity | null, tok: DesignTokens, voice: BrandVoice, ed: Editors) {
  switch (id) {
    case "identity": return <IdentityEditor ident={ident} ed={ed} />;
    case "voice": return <VoiceEditor ident={ident} voice={voice} ed={ed} />;
    case "logo": return <LogoEditor tok={tok} ed={ed} />;
    case "colors": return <ColorsEditor tok={tok} ed={ed} />;
    case "type": return <TypeEditor tok={tok} ed={ed} />;
    case "shape": return <ShapeEditor tok={tok} ed={ed} />;
    case "imagery": return <ImageryEditor ident={ident} ed={ed} />;
  }
}

// ── shared atoms ────────────────────────────────────────────────────────────
function Field({ label, locked, children }: { label: string; locked?: boolean; children: React.ReactNode }) {
  return (
    <label className="qz-bb-fld">
      <span className="qz-bb-lab">{label}{locked ? <Lock size={11} aria-label="locked" /> : null}</span>
      {children}
    </label>
  );
}
function Seg<T extends string>({ options, value, onChange, aria }: { options: readonly { value: T; label: string }[] | readonly T[]; value: T | undefined; onChange: (v: T) => void; aria: string }) {
  const opts = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  return (
    <div className="qz-segmented" role="group" aria-label={aria}>
      {opts.map((o) => <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)} style={{ textTransform: typeof options[0] === "string" ? "capitalize" : "none" }}>{o.label}</button>)}
    </div>
  );
}
function FontSelect({ value, onChange, aria }: { value: string | undefined; onChange: (v: string) => void; aria: string }) {
  const options = value && !FONT_OPTIONS.includes(value) ? [value, ...FONT_OPTIONS] : FONT_OPTIONS;
  return (
    <select className="qz-select qz-bb-fontsel" aria-label={aria} value={value ?? ""} onChange={(e) => onChange(e.target.value)} style={{ fontFamily: value || "inherit" }}>
      <option value="" disabled>Choose a font…</option>
      {options.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
    </select>
  );
}
// Long-form fields render IN FULL (handoff): the textarea auto-grows to fit its
// content so a positioning statement / voice summary is never a scroll-box.
function AutoTextarea({ value, onChange, className, placeholder, minRows = 3 }: { value: string; onChange: (v: string) => void; className?: string; placeholder?: string; minRows?: number }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea ref={ref} className={className} rows={minRows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  );
}
function Chips({ items, onChange, placeholder }: { items: string[]; onChange: (next: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState("");
  const add = () => { const v = draft.trim(); if (v && !items.includes(v)) onChange([...items, v]); setDraft(""); };
  return (
    <div className="qz-bb-chips">
      {items.map((it) => <span key={it} className="qz-bb-chip">{it}<button type="button" aria-label={`Remove ${it}`} onClick={() => onChange(items.filter((x) => x !== it))}>×</button></span>)}
      <input className="qz-bb-chipin" value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} onBlur={add} />
    </div>
  );
}

// ── section editors ─────────────────────────────────────────────────────────
// Identity — merges the old standalone "Positioning" section (industry/vertical/
// price/audience/trends) in with the positioning statement + descriptions.
function IdentityEditor({ ident, ed }: { ident: BrandIdentity | null; ed: Editors }) {
  if (!ident) return <NoIdentity />;
  const desc = ident.descriptions ?? [];
  const pos = ident.positioning;
  const setDesc = (i: number, v: string) =>
    ed.patchIdent((d) => { const next = [...(d.descriptions ?? [])]; next[i] = v; return { ...d, descriptions: next.filter((x, idx) => x.trim().length > 0 || idx === 0) }; });
  const setPos = (patch: Record<string, unknown>) => ed.patchIdent((d) => ({ ...d, positioning: { ...d.positioning, ...patch } }));
  return (
    <>
      <Field label="Positioning statement" locked={ed.locked.has("summary")}>
        <AutoTextarea className="qz-input qz-bb-longtext" minRows={4} value={ident.summary ?? ""} onChange={(val) => ed.patchIdent((d) => ({ ...d, summary: val }))} />
      </Field>
      <Field label="Short description" locked={ed.locked.has("descriptions")}>
        <input className="qz-input" value={desc[0] ?? ""} onChange={(e) => setDesc(0, e.target.value)} />
      </Field>
      <Field label="Long description" locked={ed.locked.has("descriptions")}>
        <AutoTextarea className="qz-input qz-bb-longtext" minRows={3} value={desc[1] ?? ""} onChange={(val) => setDesc(1, val)} />
      </Field>
      <div className="qz-bb-2col">
        <Field label="Industry" locked={ed.locked.has("positioning.industry")}><input className="qz-input" value={pos?.industry ?? ""} onChange={(e) => setPos({ industry: e.target.value })} /></Field>
        <Field label="Vertical" locked={ed.locked.has("positioning.vertical")}><input className="qz-input" value={pos?.vertical ?? ""} onChange={(e) => setPos({ vertical: e.target.value })} /></Field>
      </div>
      <Field label="Price tier" locked={ed.locked.has("positioning.price_tier")}>
        <Seg options={["value", "mid", "premium", "luxury", "mixed"] as const} value={pos?.price_tier} aria="Price tier" onChange={(price_tier) => setPos({ price_tier })} />
      </Field>
      <Field label="Audience" locked={ed.locked.has("positioning.target_demographic")}>
        <Chips items={pos?.target_demographic ?? []} placeholder="add an audience…" onChange={(target_demographic) => setPos({ target_demographic })} />
      </Field>
      <Field label="Category trends" locked={ed.locked.has("positioning.category_trends")}>
        <Chips items={pos?.category_trends ?? []} placeholder="add a trend…" onChange={(category_trends) => setPos({ category_trends })} />
      </Field>
    </>
  );
}

function VoiceEditor({ ident, voice, ed }: { ident: BrandIdentity | null; voice: BrandVoice; ed: Editors }) {
  return (
    <>
      <Field label="Tone">
        <Seg options={BrandTone.options.map((t) => ({ value: t, label: TONE_LABEL[t] }))} value={voice.tone} aria="Tone" onChange={(tone) => ed.patchVoice((v) => ({ ...v, tone }))} />
      </Field>
      <Field label="Voice summary">
        <AutoTextarea className="qz-input qz-bb-longtext" minRows={3} value={voice.tone_description === "Brand voice" ? "" : voice.tone_description} placeholder="e.g. Warm and knowing, never preachy — speaks like a trusted expert." onChange={(val) => ed.patchVoice((v) => ({ ...v, tone_description: val }))} />
      </Field>
      <Field label="Brand adjectives" locked={ed.locked.has("tags")}>
        <Chips items={ident?.tags ?? []} placeholder="add an adjective…" onChange={(tags) => ed.patchIdent((d) => ({ ...d, tags }))} />
      </Field>
      <div className="qz-bb-2col">
        <Field label="Do"><Chips items={voice.do_list} placeholder="add a do…" onChange={(do_list) => ed.patchVoice((v) => ({ ...v, do_list }))} /></Field>
        <Field label="Don't"><Chips items={voice.dont_list} placeholder="add a don't…" onChange={(dont_list) => ed.patchVoice((v) => ({ ...v, dont_list }))} /></Field>
      </div>
      <Field label="Sample copy"><Chips items={voice.sample_phrases} placeholder="add a sample phrase…" onChange={(sample_phrases) => ed.patchVoice((v) => ({ ...v, sample_phrases }))} /></Field>
    </>
  );
}

function LogoEditor({ tok, ed }: { tok: DesignTokens; ed: Editors }) {
  const logo = tok.logo ?? {};
  const setLogo = (patch: Partial<NonNullable<DesignTokens["logo"]>>) => ed.patchTok((t) => ({ ...t, logo: { ...(t.logo ?? {}), ...patch } }));
  return (
    <>
      <Field label="Logo image URL">
        <input className="qz-input" value={logo.url ?? ""} placeholder="https://… or data:image/…" onChange={(e) => setLogo({ url: e.target.value.trim() || undefined })} />
      </Field>
      {logo.url ? <div className="qz-bb-logoprev"><img src={logo.url} alt="Logo preview" /></div> : null}
      <div className="qz-bb-2col">
        <Field label="Size"><Seg options={["sm", "md", "lg"] as const} value={logo.size} aria="Logo size" onChange={(size) => setLogo({ size })} /></Field>
        <Field label="Alignment"><Seg options={["left", "center"] as const} value={logo.align} aria="Logo alignment" onChange={(align) => setLogo({ align })} /></Field>
      </div>
    </>
  );
}

function ColorsEditor({ tok, ed }: { tok: DesignTokens; ed: Editors }) {
  const colors = tok.colors ?? {};
  const setColor = (key: string, v: string) => ed.patchTok((t) => ({ ...t, colors: { ...(t.colors ?? {}), [key]: v } }));
  return (
    <div className="qz-bb-swatches">
      {COLOR_ROLES.map(({ key, label }) => {
        const val = (colors as Record<string, string | undefined>)[key] ?? "";
        return (
          <div key={key} className="qz-bb-swatch">
            <input type="color" aria-label={`${label} color`} value={/^#[0-9a-f]{6}$/i.test(val) ? val : "#000000"} onChange={(e) => setColor(key, e.target.value)} />
            <div><div className="qz-bb-lab" style={{ margin: 0 }}>{label}</div><input className="qz-bb-hex" value={val} placeholder="#______" onChange={(e) => setColor(key, e.target.value)} /></div>
          </div>
        );
      })}
    </div>
  );
}

function TypeEditor({ tok, ed }: { tok: DesignTokens; ed: Editors }) {
  const ty = tok.typography ?? {};
  const base = ty.body?.base_size ?? 16;
  const ratio = ty.body?.scale_ratio ?? 1.25;
  const setHead = (patch: Record<string, unknown>) => ed.patchTok((t) => ({ ...t, typography: { ...(t.typography ?? {}), heading: { source: "google", ...(t.typography?.heading ?? {}), ...patch } } }));
  const setBody = (patch: Record<string, unknown>) => ed.patchTok((t) => ({ ...t, typography: { ...(t.typography ?? {}), body: { source: "google", ...(t.typography?.body ?? {}), ...patch } } }));
  // Derived scale preview (H1/H2/H3 from base × ratio^n) — read-only.
  const levels: { name: string; px: number }[] = [
    { name: "H1", px: Math.round(base * ratio ** 3) },
    { name: "H2", px: Math.round(base * ratio ** 2) },
    { name: "H3", px: Math.round(base * ratio) },
    { name: "Body", px: base },
    { name: "Caption", px: Math.round(base / ratio) },
  ];
  return (
    <>
      <div className="qz-bb-2col">
        <Field label="Heading font"><FontSelect value={ty.heading?.family} aria="Heading font" onChange={(family) => setHead({ family })} /></Field>
        <Field label="Body font"><FontSelect value={ty.body?.family} aria="Body font" onChange={(family) => setBody({ family })} /></Field>
      </div>
      <div className="qz-bb-2col">
        <Field label="Base size (px)"><input className="qz-input" type="number" min={12} max={22} value={ty.body?.base_size ?? ""} onChange={(e) => setBody({ base_size: e.target.value ? Number(e.target.value) : undefined })} /></Field>
        <Field label="Scale ratio"><input className="qz-input" type="number" step="0.05" min={1} max={1.6} value={ty.body?.scale_ratio ?? ""} placeholder="1.25" onChange={(e) => setBody({ scale_ratio: e.target.value ? Number(e.target.value) : undefined })} /></Field>
      </div>
      <div className="qz-bb-2col">
        <Field label="Heading weight"><input className="qz-input" type="number" step={100} min={100} max={900} value={ty.heading?.weight ?? ""} placeholder="700" onChange={(e) => setHead({ weight: e.target.value ? Number(e.target.value) : undefined })} /></Field>
        <Field label="Body weight"><input className="qz-input" type="number" step={100} min={100} max={900} value={ty.body?.weight ?? ""} placeholder="400" onChange={(e) => setBody({ weight: e.target.value ? Number(e.target.value) : undefined })} /></Field>
      </div>
      <div className="qz-bb-scale">
        {levels.map((l) => (
          <div key={l.name} className="qz-bb-scale-row">
            <span className="qz-dim" style={{ fontSize: 11, width: 54 }}>{l.name} · {l.px}px</span>
            <span style={{ fontSize: Math.min(l.px, 30), fontWeight: l.name.startsWith("H") ? (ty.heading?.weight ?? 700) : (ty.body?.weight ?? 400), lineHeight: 1.1, fontFamily: (l.name.startsWith("H") ? ty.heading?.family : ty.body?.family) || "inherit" }}>Aa</span>
          </div>
        ))}
      </div>
    </>
  );
}

// Shape & spacing — merges the old "Shape" (corners/button/elevation) + "Spacing"
// (density) modules into one Look & feel block.
function ShapeEditor({ tok, ed }: { tok: DesignTokens; ed: Editors }) {
  return (
    <>
      <Field label="Corner radius"><Seg options={["square", "rounded", "pill"] as const} value={tok.radius} aria="Corner radius" onChange={(radius) => ed.patchTok((t) => ({ ...t, radius }))} /></Field>
      <Field label="Button style"><Seg options={["filled", "outline", "ghost"] as const} value={tok.button_style} aria="Button style" onChange={(button_style) => ed.patchTok((t) => ({ ...t, button_style }))} /></Field>
      <Field label="Elevation"><Seg options={["none", "soft", "elevated"] as const} value={tok.shadow} aria="Elevation" onChange={(shadow) => ed.patchTok((t) => ({ ...t, shadow }))} /></Field>
      <Field label="Content density"><Seg options={["compact", "normal", "spacious"] as const} value={tok.spacing} aria="Content density" onChange={(spacing) => ed.patchTok((t) => ({ ...t, spacing }))} /></Field>
    </>
  );
}

function ImageryEditor({ ident, ed }: { ident: BrandIdentity | null; ed: Editors }) {
  if (!ident) return <NoIdentity />;
  const style = ident.design?.imagery_style;
  const notes = ident.design?.imagery_notes ?? "";
  const setDesign = (patch: Record<string, unknown>) => ed.patchIdent((d) => ({ ...d, design: { ...d.design, ...patch } }));
  return (
    <>
      <Field label="Style">
        <Seg options={IMAGERY_STYLES} value={style} aria="Imagery style" onChange={(imagery_style) => setDesign({ imagery_style })} />
      </Field>
      <Field label="Notes">
        <AutoTextarea className="qz-input qz-bb-longtext" minRows={2} value={notes} placeholder="e.g. Always on a clean neutral background, ingredient-forward, lots of negative space." onChange={(val) => setDesign({ imagery_notes: val })} />
      </Field>
      {ident.design?.aesthetic?.length ? (
        <Field label="Aesthetic (AI-derived)"><div className="qz-bb-chips">{ident.design.aesthetic.map((a) => <span key={a} className="qz-bb-chip is-ro">{a}</span>)}</div></Field>
      ) : null}
    </>
  );
}

function NoIdentity() {
  return <p className="qz-dim" style={{ fontSize: 13, margin: 0 }}>No brand identity yet — run <strong>Build identity</strong> above to pull from your store, then edit here.</p>;
}
