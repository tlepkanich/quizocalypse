import { Link, useFetcher } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import type { AccountData, AccountIntentResult } from "../../../lib/billing/account.server";
import { PLANS, aiRateRange, nextPlanUp, type SelfServePlan } from "../../../lib/billing/catalog";
import {
  creditFigures,
  creditSignal,
  creditsCents,
  fmtNum,
  fmtUsd,
  fmtUsdShort,
  nextPlanWasCheaper,
  quizUsageRows,
  type CreditFigures,
} from "../../../lib/billing/creditMath";
import { useQzToast } from "../../qz-toast";
import { AcctIc, daysLeftText } from "./icons";

// Account — /studio/account, built to docs/design/settings/billing
// (BILLING-HANDOFF.md, "Account page"): your plan and the next bill, the
// credit meter, bill emails, past bills. Every figure comes from the pure
// creditMath functions, so rows and columns add up to the totals beside them.

const PLAN_PATH = "/studio/account/plan";

interface CardProps {
  data: AccountData;
  plan: SelfServePlan;
  figures: CreditFigures;
}

export function AccountScreen({ data }: { data: AccountData }) {
  const plan = PLANS[data.planKey];
  const figures = creditFigures(plan, data.credits, data.usage);
  return (
    <div className="acct">
      <div className="acct-col">
        <header className="hm3-card acct-head">
          <h1>Account</h1>
          <p className="acct-head-now">{data.shopDomain}</p>
        </header>
        <PlanCard data={data} plan={plan} figures={figures} />
        <CreditsCard data={data} plan={plan} figures={figures} />
        <BillEmailsCard data={data} plan={plan} />
        <PastBillsCard data={data} />
      </div>
    </div>
  );
}

/* ── Your plan and the next bill ─────────────────────────────────────────── */

function PlanCard({ data, plan, figures }: CardProps) {
  const pending = data.pendingPlanKey ? PLANS[data.pendingPlanKey] : null;
  const changeTag = data.ending
    ? `Ends ${data.inTrial ? "today" : data.dates.lastDay}`
    : pending
      ? `${pending.name} from ${data.dates.billDate}`
      : null;
  const billLabel = data.ending ? "Last bill" : data.inTrial ? "First bill" : "Next bill";
  return (
    <section className="hm3-card" aria-labelledby="acct-plan">
      <div className="acct-plan">
        <div className="acct-plan-me">
          <p className="hm3-lbl" id="acct-plan">
            Your plan
          </p>
          <div className="acct-plan-name">
            <b>{plan.name}</b>
            <span className={`acct-tag ${data.inTrial ? "is-trial" : "is-live"}`}>
              {data.inTrial ? `Free trial · ${daysLeftText(data.dates.daysLeft)}` : "Active"}
            </span>
            {changeTag ? <span className="acct-tag is-quiet">{changeTag}</span> : null}
          </div>
          <p className="acct-sub">
            {fmtUsdShort(figures.monthlyCents)} a month · {fmtNum(plan.credits + data.credits.everyCycle)} credits
            each cycle
          </p>
          <div className="acct-plan-acts">
            <Link to={PLAN_PATH} className="acct-btn is-sm">
              Change plan
            </Link>
          </div>
        </div>
        <div className="acct-bill">
          <p className="hm3-lbl">{billLabel}</p>
          <b>
            {fmtUsd(figures.nextBillCents)}
            {figures.over > 0 ? <small> so far</small> : null}
          </b>
          <p className="acct-bill-when">{data.dates.billDateLong}</p>
          <div className="acct-bill-how">
            <span>
              {plan.name}
              <i>{fmtUsd(plan.price * 100)}</i>
            </span>
            {data.credits.everyCycle > 0 ? (
              <span>
                {fmtNum(data.credits.everyCycle)} added credits
                <i>{fmtUsd(figures.everyCycleCents)}</i>
              </span>
            ) : null}
            {figures.over > 0 ? (
              <span>
                {fmtNum(figures.over)} extra credits
                <i>{fmtUsd(figures.overCents)}</i>
              </span>
            ) : null}
            {data.inTrial ? <span>Cancel before then and you pay nothing.</span> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Credits ─────────────────────────────────────────────────────────────── */

function CreditsCard({ data, plan, figures }: CardProps) {
  const over = figures.over > 0;
  const { dates, inTrial } = data;
  return (
    <section className="hm3-card acct-pad" aria-labelledby="acct-credits">
      <div className="acct-sechead">
        <div className="acct-h2i">
          <h2 id="acct-credits">Credits</h2>
          <CreditInfo />
        </div>
        <p className="acct-aside">
          {inTrial
            ? `Free trial · ends ${dates.billDate} · ${daysLeftText(dates.daysLeft)}`
            : `${dates.range} · ${daysLeftText(dates.daysLeft)}`}
        </p>
      </div>
      <div className={over ? "acct-fig is-over" : "acct-fig"}>
        <b>{fmtNum(over ? figures.over : figures.left)}</b>
        <span>
          {over
            ? `over your ${fmtNum(figures.available)} credits this cycle`
            : `left of ${fmtNum(figures.available)} ${inTrial ? "in your trial" : "this cycle"}`}
        </span>
      </div>
      <CreditMeter figures={figures} />
      <CreditSignal data={data} plan={plan} figures={figures} />
      <div className="acct-ledger">
        <UsedLedger figures={figures} />
        <CycleLedger data={data} plan={plan} figures={figures} />
      </div>
      <ByQuizTable data={data} figures={figures} />
      <p className="acct-how">
        Product recommendations come from your quiz logic and use no credits. Credits you don’t use roll over once
        and last 30 more days.
      </p>
    </section>
  );
}

/** The "i" beside Credits. Hover and focus are CSS; a click toggles it, and
    Escape or a click elsewhere closes it. */
function CreditInfo() {
  const [state, setState] = useState<"idle" | "open" | "shut">("idle");
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setState("shut");
    };
    const onClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setState("idle");
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, []);

  const className = state === "idle" ? "acct-info" : `acct-info is-${state}`;
  return (
    <span className={className} ref={rootRef} onMouseLeave={() => state === "shut" && setState("idle")}>
      <button
        type="button"
        className="acct-info-btn"
        aria-label="What a credit is"
        aria-expanded={state === "open"}
        aria-controls="acct-credit-info"
        onClick={() => setState(state === "open" ? "shut" : "open")}
        onBlur={() => state === "shut" && setState("idle")}
      >
        i
      </button>
      <span className="acct-info-pop" id="acct-credit-info" role="tooltip">
        <span>
          <b>1 credit</b>
          <i>1 quiz engagement: a shopper starts a quiz</i>
        </span>
        <span>
          <b>{aiRateRange()}</b>
          <i>1 use of an AI feature on a quiz. Each feature has its own rate.</i>
        </span>
      </span>
    </span>
  );
}

function CreditMeter({ figures }: { figures: CreditFigures }) {
  const over = figures.over > 0;
  const percent = (part: number, whole: number) => `${((part / whole) * 100).toFixed(1)}%`;
  return (
    <>
      <div
        className="acct-meter"
        role="img"
        aria-label={`${fmtNum(figures.used)} of ${fmtNum(figures.available)} credits used`}
      >
        {over ? (
          <>
            <i className="is-used" style={{ width: percent(figures.available, figures.used) }} />
            <i className="is-over" style={{ width: percent(figures.over, figures.used) }} />
          </>
        ) : (
          <i className="is-used" style={{ width: `${(figures.share * 100).toFixed(1)}%` }} />
        )}
      </div>
      <div className="acct-meter-ax">
        <span>{over ? `All ${fmtNum(figures.available)} used` : `${Math.round(figures.share * 100)}% used`}</span>
        <span>{over ? `+${fmtNum(figures.over)} extra` : fmtNum(figures.available)}</span>
      </div>
    </>
  );
}

/** The teal banner: nearly out, or over. Teal is only for money on the line. */
function CreditSignal({ data, plan, figures }: CardProps) {
  const signal = creditSignal(figures, data.inTrial);
  if (!signal) return null;
  const next = nextPlanUp(plan.key);
  return (
    <div className="acct-signal">
      {signal === "near" ? (
        <p>
          <b>{Math.round(figures.share * 100)}% of this cycle’s credits are used.</b> When they run out your quizzes
          keep running, and each extra credit is {fmtUsd(creditsCents(1, plan.rate))}.
        </p>
      ) : (
        <p>
          <b>Your quizzes are still running.</b> You’re {fmtNum(figures.over)} credits over, which adds{" "}
          {fmtUsd(figures.overCents)} to your {data.dates.billDate} bill so far.
          {next && nextPlanWasCheaper(figures, next)
            ? ` ${next.name} would have cost ${fmtUsd(next.price * 100)} this cycle.`
            : null}
        </p>
      )}
      <Link to={PLAN_PATH} className="acct-btn is-sm is-teal">
        Get more credits
      </Link>
    </div>
  );
}

function UsedLedger({ figures }: { figures: CreditFigures }) {
  return (
    <div className="acct-lg">
      <p className="hm3-lbl">Used</p>
      <dl>
        <div>
          <dt>
            Quiz engagements
            <small>{fmtNum(figures.engagements)} shoppers started a quiz · 1 credit each</small>
          </dt>
          <dd>{fmtNum(figures.engagements)}</dd>
        </div>
        <div className="has-sub">
          <dt>
            AI features, charged per use
            <small>{fmtNum(figures.aiUses)} uses</small>
          </dt>
          <dd>{fmtNum(figures.aiCredits)}</dd>
        </div>
        {figures.features.map((f, index) => (
          <div key={f.feature.key} className={index === figures.features.length - 1 ? "is-sub is-last" : "is-sub"}>
            <dt>
              {f.feature.name}
              <small>
                {fmtNum(f.uses)} {f.feature.unit} · {f.feature.rate} credit each
              </small>
            </dt>
            <dd>{fmtNum(f.credits)}</dd>
          </div>
        ))}
        <div className="is-total">
          <dt>Used so far</dt>
          <dd>{fmtNum(figures.used)}</dd>
        </div>
      </dl>
    </div>
  );
}

function CycleLedger({ data, plan, figures }: CardProps) {
  const { everyCycle, oneTime, rolledOver } = data.credits;
  return (
    <div className="acct-lg">
      <p className="hm3-lbl">Current cycle</p>
      <dl>
        <div>
          <dt>Included in {plan.name}</dt>
          <dd>{fmtNum(plan.credits)}</dd>
        </div>
        {everyCycle > 0 ? (
          <div>
            <dt>Added every cycle</dt>
            <dd>{fmtNum(everyCycle)}</dd>
          </div>
        ) : null}
        {oneTime > 0 ? (
          <div>
            <dt>Bought one time</dt>
            <dd>{fmtNum(oneTime)}</dd>
          </div>
        ) : null}
        {rolledOver > 0 ? (
          <div>
            <dt>
              Rolled over from last cycle
              <small>Use by {data.dates.lastDay}</small>
            </dt>
            <dd>{fmtNum(rolledOver)}</dd>
          </div>
        ) : null}
        <div className="is-total">
          <dt>Total</dt>
          <dd>{fmtNum(figures.available)}</dd>
        </div>
      </dl>
    </div>
  );
}

/** One row per quiz with usage in the cycle; "All quizzes" equals Used. */
function ByQuizTable({ data, figures }: { data: AccountData; figures: CreditFigures }) {
  const rows = quizUsageRows(data.quizzes, figures);
  return (
    <div className="acct-byq">
      <p className="hm3-lbl">By quiz</p>
      <div className="acct-twrap">
        <table>
          <thead>
            <tr>
              <th>Quiz</th>
              <th className="is-r">Engagements</th>
              {figures.features.map((f) => (
                <th key={f.feature.key} className="is-r">
                  {f.feature.short}
                </th>
              ))}
              <th className="is-r">Credits</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.quizId}>
                <td>{row.name}</td>
                <td className="is-r">{fmtNum(row.engagements)}</td>
                {row.ai.map((cell, index) => (
                  <td key={figures.features[index]?.feature.key ?? index} className="is-r">
                    {cell === null ? <span className="acct-none">—</span> : fmtNum(cell)}
                  </td>
                ))}
                <td className="is-r is-total">{fmtNum(row.credits)}</td>
              </tr>
            ))}
            <tr className="is-sum">
              <td>All quizzes</td>
              <td className="is-r">{fmtNum(figures.engagements)}</td>
              {figures.features.map((f) => (
                <td key={f.feature.key} className="is-r">
                  {fmtNum(f.credits)}
                </td>
              ))}
              <td className="is-r is-total">{fmtNum(figures.used)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Bill emails ─────────────────────────────────────────────────────────── */

type SwitchKey = keyof AccountData["switches"];

/** A fetcher for an Account intent that says its result in a toast, once.
    A refusal is said too when the caller has no place of its own to show it. */
function useAccountFetcher({ sayRefusals = false }: { sayRefusals?: boolean } = {}) {
  const fetcher = useFetcher<AccountIntentResult>();
  const toast = useQzToast();
  const said = useRef<AccountIntentResult | undefined>(undefined);
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || said.current === fetcher.data) return;
    said.current = fetcher.data;
    if (fetcher.data.ok || sayRefusals) toast(fetcher.data.message);
  }, [fetcher.state, fetcher.data, toast, sayRefusals]);
  return fetcher;
}

function BillEmailsCard({ data, plan }: { data: AccountData; plan: SelfServePlan }) {
  const addFetcher = useAccountFetcher();
  const editFetcher = useAccountFetcher();
  const inputRef = useRef<HTMLInputElement>(null);
  const added = addFetcher.state === "idle" ? addFetcher.data : undefined;

  // Save adds the address to the list and clears the field; an error keeps
  // the text and returns focus to it.
  useEffect(() => {
    if (!added || !inputRef.current) return;
    if (added.ok) inputRef.current.value = "";
    else inputRef.current.focus();
  }, [added]);

  const pending = editFetcher.formData;
  const switchOn = (key: SwitchKey) =>
    pending?.get("intent") === "set-switch" && pending.get("key") === key
      ? pending.get("on") === "true"
      : data.switches[key];
  const setSwitch = (key: SwitchKey, on: boolean) =>
    editFetcher.submit({ intent: "set-switch", key, on: String(on) }, { method: "post" });

  const switches: { key: SwitchKey; label: string; sub: string }[] = [
    { key: "receipt", label: "Receipt on every bill", sub: "Your plan, credits used and the total, on each bill date." },
    { key: "near", label: "Alert at 80% of your credits", sub: "Time to add credits or upgrade." },
    {
      key: "out",
      label: "Alert when your credits run out",
      sub: `From then on, each extra credit is ${fmtUsd(creditsCents(1, plan.rate))}.`,
    },
  ];

  return (
    <section className="hm3-card acct-pad" aria-labelledby="acct-mail">
      <div className="acct-sechead">
        <h2 id="acct-mail">Bill emails</h2>
      </div>
      <addFetcher.Form method="post" className="acct-mail-to" noValidate>
        <input type="hidden" name="intent" value="add-email" />
        <div className="acct-field">
          <label htmlFor="acct-bill-email">Send to</label>
          <input
            ref={inputRef}
            type="email"
            id="acct-bill-email"
            name="email"
            placeholder="name@yourstore.com"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <button type="submit" className="acct-btn is-sm is-quiet">
          Save
        </button>
      </addFetcher.Form>
      {added && !added.ok ? (
        <p className="acct-mail-err" role="alert">
          {added.message}
        </p>
      ) : null}
      {data.emails.length > 0 ? (
        <ul className="acct-mail-list" aria-label="Saved bill emails">
          {data.emails.map((email) => (
            <li key={email}>
              <span>{email}</span>
              <button
                type="button"
                aria-label={`Remove ${email}`}
                onClick={() => editFetcher.submit({ intent: "remove-email", email }, { method: "post" })}
              >
                <AcctIc name="cross" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="acct-mail-none">No email saved. Receipts and alerts aren’t being sent.</p>
      )}
      <div className="acct-sws">
        {switches.map((item) => (
          <label key={item.key} className="acct-swrow">
            <span>
              {item.label}
              <small>{item.sub}</small>
            </span>
            <input
              type="checkbox"
              className="acct-sw"
              checked={switchOn(item.key)}
              onChange={(event) => setSwitch(item.key, event.target.checked)}
            />
          </label>
        ))}
      </div>
    </section>
  );
}

/* ── Past bills ──────────────────────────────────────────────────────────── */

function PastBillsCard({ data }: { data: AccountData }) {
  const receiptFetcher = useAccountFetcher({ sayRefusals: true });
  const sendingBillId = receiptFetcher.state !== "idle" ? receiptFetcher.formData?.get("billId") : null;
  return (
    <section className="hm3-card acct-pad" aria-labelledby="acct-bills">
      <div className="acct-sechead">
        <h2 id="acct-bills">Past bills</h2>
      </div>
      {data.bills.length > 0 ? (
        <div className="acct-twrap">
          <table>
            <thead>
              <tr>
                <th>Bill date</th>
                <th>Plan</th>
                <th className="is-r">Available credits</th>
                <th className="is-r">Credits used</th>
                <th className="is-r">Total cost</th>
                <th className="is-r">
                  <span className="qz-sr-only">Receipt</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.bills.map((bill) => (
                <tr key={bill.id}>
                  <td>{bill.billDate}</td>
                  <td>{bill.planName}</td>
                  <td className="is-r">{fmtNum(bill.creditsAvailable)}</td>
                  <td className="is-r">{fmtNum(bill.creditsUsed)}</td>
                  <td className="is-r is-total">{fmtUsd(bill.totalCents)}</td>
                  <td className="is-r">
                    <button
                      type="button"
                      className="acct-link"
                      disabled={sendingBillId === bill.id}
                      onClick={() =>
                        receiptFetcher.submit({ intent: "email-receipt", billId: bill.id }, { method: "post" })
                      }
                    >
                      Email receipt
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="acct-empty">No bills yet. Your first bill is on {data.dates.billDateLong}.</p>
      )}
      <div className="acct-hist-foot">
        <span>Credits used past what was available are a separate line on that bill.</span>
        {data.shopifyBillingUrl ? (
          <a className="acct-link" href={data.shopifyBillingUrl} target="_blank" rel="noreferrer">
            Invoices in Shopify <AcctIc name="external" />
          </a>
        ) : null}
      </div>
    </section>
  );
}
