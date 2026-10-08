// The contacts panel (ANALYTICS-HANDOFF.md "The contacts panel"): opens from
// answer bars, result rows and boxes, the Customers figures and bars, always
// on the exact number that was clicked. Everything it lists is counted on the
// server (quizContacts.server.ts) over every contact in the range; the page
// only ever sees masked emails. Export and Copy emails fetch the full list.

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "@remix-run/react";
import type { ContactsPanelData } from "../../../lib/quizContacts.server";
import { c, DASH, dmy, Icon, num, orderValue, saveBlob, Cut, type Facet } from "./kit";
import { Scrim, useEscape } from "./chrome";

const STATUS: Record<"bought" | "added" | "no-purchase", [string, string]> = {
  bought: ["Bought", "info"],
  added: ["Added, not bought", "warn"],
  "no-purchase": ["No purchase yet", "draft"],
};
const CHIPS: Array<["all" | "no-purchase" | "added" | "bought", string]> = [
  ["all", "All"],
  ["no-purchase", "No purchase yet"],
  ["added", "Added, not bought"],
  ["bought", "Bought"],
];

/** The range params the page is on, so the panel counts the same shoppers. */
function rangeQuery(sp: URLSearchParams): URLSearchParams {
  const q = new URLSearchParams();
  for (const k of ["r", "from", "to"]) {
    const v = sp.get(k);
    if (v) q.set(k, v);
  }
  return q;
}

type Kl = null | "form" | { sent: number; name: string } | { error: string };

export function ContactsPanel({
  base,
  initial,
  klaviyoConnected,
  integrationsHref,
  onClose,
  say,
}: {
  /** The surface's contacts resource route. */
  base: string;
  initial: Facet;
  klaviyoConnected: boolean;
  integrationsHref: string;
  onClose: () => void;
  say: (m: string) => void;
}) {
  const [sp] = useSearchParams();
  const [status, setStatus] = useState(initial.status ?? "all");
  const [consent, setConsent] = useState(Boolean(initial.consent));
  const [data, setData] = useState<ContactsPanelData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kl, setKl] = useState<Kl>(null);
  const [busy, setBusy] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const query = useCallback(
    (extra: Record<string, string>) => {
      const q = rangeQuery(sp);
      q.set("facet", initial.facet);
      if (initial.id) q.set("id", initial.id);
      q.set("status", status);
      if (consent) q.set("consent", "1");
      for (const [k, v] of Object.entries(extra)) q.set(k, v);
      return `${base}?${q.toString()}`;
    },
    [sp, base, initial.facet, initial.id, status, consent],
  );

  useEffect(() => {
    let live = true;
    setError(null);
    fetch(query({ limit: "40" }))
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as ContactsPanelData;
      })
      .then((d) => live && setData(d))
      .catch(() => live && setError("The contacts didn't load. Try again in a moment."));
    return () => {
      live = false;
    };
  }, [query]);
  useEffect(() => closeRef.current?.focus(), []);
  useEffect(() => {
    if (kl === "form") nameRef.current?.focus();
  }, [kl]);
  useEscape(onClose, true);

  const exportCsv = async () => {
    setBusy(true);
    try {
      const r = await fetch(query({ format: "csv" }));
      if (!r.ok) throw new Error();
      saveBlob(`contacts-${new Date().toISOString().slice(0, 10)}.csv`, await r.blob());
    } catch {
      say("The export didn't download. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };
  const copyEmails = async () => {
    setBusy(true);
    try {
      const r = await fetch(query({ format: "emails" }));
      if (!r.ok) throw new Error();
      const { emails } = (await r.json()) as { emails: string[] };
      await navigator.clipboard.writeText(emails.join("\n"));
      say(`${num(emails.length)} emails copied, one per line.`);
    } catch {
      say("Copying is blocked here. Export gives you the same list.");
    } finally {
      setBusy(false);
    }
  };
  const createSegment = async (name: string) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.set("intent", "klaviyo-segment");
      form.set("name", name);
      const r = await fetch(query({}), { method: "POST", body: form });
      const out = (await r.json()) as { ok: boolean; error?: string; name?: string };
      if (out.ok) setKl({ sent: data?.segment.matchToday ?? 0, name: out.name ?? name });
      else setKl({ error: out.error ?? "Klaviyo didn't create the segment." });
    } catch {
      setKl({ error: "Klaviyo didn't answer. Try again in a moment." });
    } finally {
      setBusy(false);
    }
  };

  const d = data;
  let acts: JSX.Element;
  if (kl === "form" && d) {
    acts = (
      <form
        className={c("kl")}
        onSubmit={(e) => {
          e.preventDefault();
          void createSegment(nameRef.current?.value.trim() || d.segment.defaultName);
        }}
      >
        <p className={c("lbl")}>Create a segment in Klaviyo</p>
        <label htmlFor="an-klname">Segment name</label>
        <input ref={nameRef} id="an-klname" type="text" defaultValue={d.segment.defaultName} autoComplete="off" maxLength={120} />
        <p>Klaviyo will include everyone who matches all of these:</p>
        <ul className={c("kl-r")}>
          {d.segment.rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <p>
          About <b>{num(d.segment.matchToday)} people</b> match today. Klaviyo keeps the segment up to date by itself, so
          shoppers who match later are added and shoppers who buy drop out. Purchase and add-to-cart rules use Klaviyo’s
          own activity, so its count can differ slightly from ours.
        </p>
        <div className={c("aud-acts")}>
          <button type="submit" className={c("btn btn-sm")} disabled={busy}>
            {busy ? "Creating…" : "Create segment"}
          </button>
          <button type="button" className={c("lnk")} onClick={() => setKl(null)}>
            Cancel
          </button>
        </div>
      </form>
    );
  } else if (kl && typeof kl === "object" && "sent" in kl) {
    acts = (
      <div className={c("kl is-done")}>
        <i>
          <Icon name="check" />
        </i>
        <div>
          <b>Segment created in Klaviyo</b>
          <p>
            “{kl.name}” has about {num(kl.sent)} people today and stays up to date by itself. Use it in a flow or a
            campaign.
          </p>
          <div className={c("aud-acts")}>
            <a className={c("lnk")} href="https://www.klaviyo.com/lists" target="_blank" rel="noreferrer">
              Open your segments in Klaviyo
            </a>
            <button type="button" className={c("lnk is-quiet")} onClick={() => setKl(null)}>
              Done
            </button>
          </div>
        </div>
      </div>
    );
  } else {
    const empty = !d || d.total === 0;
    acts = (
      <>
        <div className={c("aud-acts")}>
          {klaviyoConnected ? (
            <button type="button" className={c("btn btn-sm")} onClick={() => setKl("form")} disabled={!d}>
              Create Klaviyo segment <Icon name="arrow" />
            </button>
          ) : (
            <Link className={c("btn btn-sm")} to={integrationsHref}>
              Connect Klaviyo <Icon name="arrow" />
            </Link>
          )}
          <button type="button" className={c("btn btn-sm btn-quiet")} onClick={exportCsv} disabled={empty || busy}>
            Export
          </button>
          <button type="button" className={c("btn btn-sm btn-quiet")} onClick={copyEmails} disabled={empty || busy}>
            Copy emails
          </button>
        </div>
        {kl && typeof kl === "object" && "error" in kl ? <p className={c("aud-note err")}>{kl.error}</p> : null}
        {klaviyoConnected ? null : (
          <p className={c("aud-note")}>Connect Klaviyo once to turn any group here into a segment that keeps itself up to date.</p>
        )}
      </>
    );
  }

  const ordersNote =
    d && d.resultOrders ? (
      <p className={c("aud-note")}>
        {num(d.resultOrders)} order{d.resultOrders === 1 ? "" : "s"} came from this result: {num(d.facts.bought)} from
        shoppers who left an email (listed here)
        {d.resultOrders > d.facts.bought ? ` and ${num(d.resultOrders - d.facts.bought)} from shoppers who didn’t.` : "."}
      </p>
    ) : null;

  return (
    <>
      <Scrim onClose={onClose} />
      <aside className={c("drawer aud")} role="dialog" aria-modal="true" aria-labelledby="an-aud-h">
        <header>
          <div>
            <p className={c("lbl")}>{d?.title.eyebrow ?? " "}</p>
            <h2 id="an-aud-h">{d?.title.name ?? "Loading…"}</h2>
          </div>
          <button ref={closeRef} type="button" className={c("x")} aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>
        {error ? <p className={c("aud-empty err")}>{error}</p> : null}
        {d ? (
          <>
            <div className={c("ev")}>
              {d.stat ? (
                <span>
                  {d.stat.label}
                  <b>{num(d.stat.value)}</b>
                </span>
              ) : null}
              <span>
                Left an email<b>{num(d.facts.contacts)}</b>
              </span>
              <span>
                Marketing consent<b>{num(d.facts.consent)}</b>
              </span>
              <span>
                Bought<b>{num(d.facts.bought)}</b>
              </span>
            </div>
            {ordersNote}
            {d.facts.contacts === 0 ? (
              <p className={c("aud-empty")}>
                Nobody in this group has left an email yet, so there is no one to contact. They show up here as soon as
                they do.
              </p>
            ) : (
              <>
                <div className={c("aud-acts")}>
                  <div className={c("seg")} role="group" aria-label="Narrow by what they did next">
                    {CHIPS.map(([k, label]) => (
                      <button
                        key={k}
                        type="button"
                        aria-pressed={status === k}
                        onClick={() => {
                          setStatus(k);
                          setKl(null);
                        }}
                      >
                        {label} <b>{num(d.statusCounts[k])}</b>
                      </button>
                    ))}
                  </div>
                </div>
                <div className={c("aud-acts")}>
                  <button
                    type="button"
                    className={c("cmp")}
                    aria-pressed={consent}
                    onClick={() => {
                      setConsent((v) => !v);
                      setKl(null);
                    }}
                  >
                    <Icon name="check" />
                    Marketing consent only
                  </button>
                  <span className={c("aud-note")}>
                    {num(d.facts.consent)} of {num(d.facts.contacts)} said yes to marketing
                  </span>
                </div>
                {acts}
                {d.rows.length ? (
                  <div className={c("twrap")}>
                    <table className={c("aud-t")}>
                      <colgroup>
                        <col style={{ width: "29%" }} />
                        <col style={{ width: "22%" }} />
                        <col style={{ width: "24%" }} />
                        <col style={{ width: "11%" }} />
                        <col style={{ width: "14%" }} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>Contact</th>
                          <th>Result</th>
                          <th>Status</th>
                          <th>Consent</th>
                          <th className={c("r")}>Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.rows.map((r) => {
                          const st = STATUS[r.status];
                          return (
                            <tr key={r.id}>
                              <td>
                                <Cut>{r.emailMasked}</Cut>
                                <small>{dmy(r.capturedAt)}</small>
                              </td>
                              <td>
                                {r.noMatch ? (
                                  <span style={{ color: "var(--an-ink4)" }}>no match</span>
                                ) : r.result ? (
                                  <Cut>{r.result}</Cut>
                                ) : (
                                  <span style={{ color: "var(--an-ink4)" }}>left before a result</span>
                                )}
                              </td>
                              <td>
                                <span className={c(`tag is-${st[1]}`)}>{st[0]}</span>
                              </td>
                              <td>{r.consent ? "Yes" : <span style={{ color: "var(--an-ink4)" }}>{r.consent === false ? "No" : "Not asked"}</span>}</td>
                              <td className={c("r")}>{orderValue(r.value, 0) ?? DASH}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className={c("aud-empty")}>No contacts match.</p>
                )}
                {d.total > d.rows.length ? (
                  <p className={c("aud-more")}>
                    Showing {num(d.rows.length)} of {num(d.total)}. The export and the copy include all of them.
                  </p>
                ) : null}
              </>
            )}
            <p className={c("aud-foot")}>
              Emails are masked on screen; the export and the copy carry them in full, with each contact’s answers,
              result, recommended products and consent. A Klaviyo segment only ever includes people Klaviyo is allowed to
              email. Only shoppers who left an email can appear here.
            </p>
          </>
        ) : null}
      </aside>
    </>
  );
}
