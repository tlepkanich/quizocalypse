import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Form } from "@remix-run/react";
import { Database, Eye, Folder, Hand, Tag, X } from "lucide-react";
import { QzModal } from "../qz-overlays";
import {
  emptyMembership,
  resolveMembership,
  type Membership,
  type ResolvableProduct,
} from "../../lib/groupMembership";

// P3 Edit 2 (§16) — the 3-step "New group" wizard: Define (mix 4 sources) →
// Name & note → Persona. Live preview resolves membership client-side. Submits
// to the /studio/groups create action. Reuses QzModal (Phase 2 Edit 3).
export type WizProduct = ResolvableProduct & { title: string; imageUrl: string | null };
type SrcKey = keyof Membership; // "tags" | "collections" | "metafields" | "manual"

const SOURCES: { key: SrcKey; label: string; src: "tag" | "col" | "meta" | "man"; icon: ReactNode; empty: string }[] = [
  { key: "tags", label: "Tags", src: "tag", icon: <Tag size={15} aria-hidden />, empty: "No tags yet" },
  { key: "collections", label: "Collections", src: "col", icon: <Folder size={15} aria-hidden />, empty: "No collections yet" },
  { key: "metafields", label: "Metafields", src: "meta", icon: <Database size={15} aria-hidden />, empty: "No metafields yet" },
  { key: "manual", label: "Manual products", src: "man", icon: <Hand size={15} aria-hidden />, empty: "None hand-picked" },
];

export function GroupWizard({
  open,
  onClose,
  tags,
  collections,
  metafieldConditions,
  products,
}: {
  open: boolean;
  onClose: () => void;
  tags: string[];
  collections: { id: string; title: string }[];
  metafieldConditions: string[];
  products: WizProduct[];
}) {
  const [step, setStep] = useState(1);
  const [mem, setMem] = useState<Membership>(emptyMembership());
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [personaOn, setPersonaOn] = useState(false);
  const [personaName, setPersonaName] = useState("");
  const [personaDesc, setPersonaDesc] = useState("");
  const [personaImage, setPersonaImage] = useState("");
  const [picker, setPicker] = useState<SrcKey | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const colTitle = useMemo(() => new Map(collections.map((c) => [c.id, c.title])), [collections]);
  const productTitle = useMemo(() => new Map(products.map((p) => [p.id, p.title])), [products]);
  const matchedIds = useMemo(() => resolveMembership(mem, products), [mem, products]);
  const previewThumbs = matchedIds.slice(0, 6).map((id) => products.find((p) => p.id === id)?.imageUrl ?? null);

  const reset = () => {
    setStep(1);
    setMem(emptyMembership());
    setName("");
    setDescription("");
    setPersonaOn(false);
    setPersonaName("");
    setPersonaDesc("");
    setPersonaImage("");
    setPicker(null);
  };
  const close = () => {
    onClose();
    reset();
  };

  const labelFor = (key: SrcKey, v: string): string =>
    key === "collections" ? colTitle.get(v) ?? v : key === "manual" ? productTitle.get(v) ?? v : v;

  const removeFrom = (key: SrcKey, v: string) =>
    setMem((m) => ({ ...m, [key]: m[key].filter((x) => x !== v) }));

  const pickerOptions = (key: SrcKey): { id: string; label: string; img?: string | null }[] => {
    if (key === "tags") return tags.map((t) => ({ id: t, label: t }));
    if (key === "collections") return collections.map((c) => ({ id: c.id, label: c.title }));
    if (key === "metafields") return metafieldConditions.map((m) => ({ id: m, label: m }));
    return products.map((p) => ({ id: p.id, label: p.title, img: p.imageUrl }));
  };

  const steps = ["Define", "Name & note", "Persona"];
  const next = () => {
    if (step === 3) {
      formRef.current?.requestSubmit();
      return;
    }
    setStep((s) => Math.min(3, s + 1));
  };

  return (
    <>
      <Form method="post" ref={formRef} style={{ display: "none" }}>
        <input type="hidden" name="intent" value="create-group" />
        <input type="hidden" name="name" value={name} />
        <input type="hidden" name="description" value={description} />
        <input type="hidden" name="membership" value={JSON.stringify(mem)} />
        <input
          type="hidden"
          name="persona"
          value={
            personaOn
              ? JSON.stringify({ name: personaName, description: personaDesc, image: personaImage || null })
              : ""
          }
        />
      </Form>

      <QzModal
        open={open}
        onClose={close}
        size="md"
        title="Create a group"
        footer={
          <div className="qz-row" style={{ width: "100%", gap: 10 }}>
            <button type="button" className="qz-btn qz-btn-sm" onClick={close}>Cancel</button>
            <span style={{ marginLeft: "auto" }} />
            {step > 1 ? (
              <button type="button" className="qz-btn qz-btn-sm" onClick={() => setStep((s) => s - 1)}>Back</button>
            ) : null}
            <button type="button" className="qz-btn qz-btn-primary qz-btn-sm" onClick={next}>
              {step === 3 ? "Create group" : "Next"}
            </button>
          </div>
        }
      >
        <div className="qz-wsteps" aria-hidden>
          {steps.map((s, i) => (
            <div key={s} className={`qz-wstep${i + 1 === step ? " is-active" : ""}${i + 1 < step ? " is-done" : ""}`}>
              {i + 1} · {s}
            </div>
          ))}
        </div>

        {step === 1 ? (
          <div className="qz-wpanel">
            <div className="qz-klabel">Membership — mix any of these</div>
            {SOURCES.map((s) => (
              <div key={s.key} className="qz-wsrc">
                <div className="qz-wsrc-head">
                  <span className={`qz-wsrc-icon src-${s.src}`}>{s.icon}</span>
                  <span className="qz-wsrc-name">{s.label}</span>
                  <button type="button" className="qz-wsrc-add" onClick={() => setPicker(s.key)}>+ Add</button>
                </div>
                <div className="qz-row" style={{ flexWrap: "wrap", gap: 7 }}>
                  {mem[s.key].length === 0 ? (
                    <span className="qz-dim" style={{ fontSize: 12 }}>{s.empty}</span>
                  ) : (
                    mem[s.key].map((v) => (
                      <span key={v} className={`qz-src-chip src-${s.src}`}>
                        {labelFor(s.key, v)}
                        <button type="button" className="qz-chip-x" aria-label="Remove" onClick={() => removeFrom(s.key, v)}>
                          <X size={12} aria-hidden />
                        </button>
                      </span>
                    ))
                  )}
                </div>
              </div>
            ))}
            <div className="qz-wpreview">
              <div className="qz-row" style={{ gap: 7, fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
                <Eye size={15} style={{ color: "var(--qz-accent)" }} aria-hidden />
                {matchedIds.length} products in this group
              </div>
              <div className="qz-gmosaic">
                {matchedIds.length === 0 ? (
                  <span className="qz-dim" style={{ fontSize: 12 }}>Add criteria to see matching products</span>
                ) : (
                  <>
                    {previewThumbs.map((src, i) =>
                      src ? (
                        <img key={i} src={src} alt="" loading="lazy" className="qz-gthumb" />
                      ) : (
                        <span key={i} className="qz-gthumb" aria-hidden>◫</span>
                      ),
                    )}
                    {matchedIds.length > previewThumbs.length ? (
                      <span className="qz-gthumb qz-gthumb-more">+{matchedIds.length - previewThumbs.length}</span>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="qz-wpanel">
            <div className="qz-field">
              <label className="qz-field-label">Group name</label>
              <input className="qz-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="The Glow Chaser" autoFocus />
            </div>
            <div className="qz-field" style={{ marginTop: 12 }}>
              <label className="qz-field-label">Note / description</label>
              <textarea className="qz-textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Who this group is for…" />
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="qz-wpanel">
            <button type="button" className={`qz-wtoggle${personaOn ? " is-on" : ""}`} onClick={() => setPersonaOn((p) => !p)}>
              <span className="qz-wswitch" aria-hidden /> Show this group as a shopper-facing persona
            </button>
            {personaOn ? (
              <div style={{ marginTop: 16 }}>
                <div className="qz-field">
                  <label className="qz-field-label">Persona name (shopper sees this)</label>
                  <input className="qz-input" value={personaName} onChange={(e) => setPersonaName(e.target.value)} placeholder="You're a Glow Chaser" />
                </div>
                <div className="qz-field" style={{ marginTop: 12 }}>
                  <label className="qz-field-label">Persona description</label>
                  <textarea className="qz-textarea" rows={2} value={personaDesc} onChange={(e) => setPersonaDesc(e.target.value)} placeholder="Your routine is all about radiance…" />
                </div>
                <div className="qz-field" style={{ marginTop: 12 }}>
                  <label className="qz-field-label">Persona image URL (optional)</label>
                  <input className="qz-input" type="url" value={personaImage} onChange={(e) => setPersonaImage(e.target.value)} placeholder="https://…/persona.jpg" />
                </div>
              </div>
            ) : (
              <p className="qz-muted" style={{ fontSize: 13, marginTop: 12 }}>
                Optional — turn on to give shoppers a named result. You can add this later.
              </p>
            )}
          </div>
        ) : null}
      </QzModal>

      {/* Source picker (nested modal) */}
      {picker ? (
        <SourcePicker
          title={`Add ${SOURCES.find((s) => s.key === picker)?.label.toLowerCase() ?? ""}`}
          options={pickerOptions(picker)}
          selected={mem[picker]}
          onConfirm={(ids) => {
            setMem((m) => ({ ...m, [picker]: ids }));
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </>
  );
}

// P3 Edit 2 — reusable source picker: searchable checkbox list over Shopify data.
function SourcePicker({
  title,
  options,
  selected,
  onConfirm,
  onClose,
}: {
  title: string;
  options: { id: string; label: string; img?: string | null }[];
  selected: string[];
  onConfirm: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string[]>(selected);
  const filtered = options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <QzModal
      open
      onClose={onClose}
      size="sm"
      title={title}
      footer={
        <div className="qz-row" style={{ width: "100%", gap: 10 }}>
          <span className="qz-muted" style={{ fontSize: 12 }}>{sel.length} selected</span>
          <span style={{ marginLeft: "auto" }} />
          <button type="button" className="qz-btn qz-btn-sm" onClick={onClose}>Cancel</button>
          <button type="button" className="qz-btn qz-btn-primary qz-btn-sm" onClick={() => onConfirm(sel)}>Add selected</button>
        </div>
      }
    >
      <input className="qz-input" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus style={{ marginBottom: 10 }} />
      <div className="qz-picklist">
        {filtered.length === 0 ? (
          <p className="qz-dim" style={{ fontSize: 13, padding: "8px 2px" }}>Nothing to pick here yet.</p>
        ) : (
          filtered.map((o) => {
            const on = sel.includes(o.id);
            return (
              <button type="button" key={o.id} className={`qz-prow${on ? " is-sel" : ""}`} onClick={() => toggle(o.id)}>
                <span className="qz-prow-cb" aria-hidden>{on ? "✓" : ""}</span>
                {o.img !== undefined ? (
                  o.img ? <img src={o.img} alt="" className="qz-prow-img" /> : <span className="qz-prow-img" aria-hidden>◫</span>
                ) : null}
                <span className="qz-prow-label">{o.label}</span>
              </button>
            );
          })
        )}
      </div>
    </QzModal>
  );
}
