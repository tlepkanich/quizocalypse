import { Link } from "@remix-run/react";
import { useRef, useState, type CSSProperties } from "react";
import type { AccountData } from "../../../lib/billing/account.server";
import {
  PLANS,
  PLAN_ORDER,
  isUpgrade,
  nextPlanUp,
  type Plan,
  type SelfServePlan,
} from "../../../lib/billing/catalog";
import {
  breakEvenMark,
  clampAmount,
  creditFigures,
  creditsCents,
  defaultAmount,
  fmtNum,
  fmtUsd,
  fmtUsdShort,
  type CreditFigures,
} from "../../../lib/billing/creditMath";
import { QzModal } from "../../qz-overlays";
import { useQzToast } from "../../qz-toast";
import { AcctIc } from "./icons";
import { STUDIO_ACCOUNT_PATHS, type AccountPaths } from "./paths";
import {
  addEveryCycleDialog,
  buyCreditsDialog,
  cancelDialog,
  changePlanDialog,
  removeEveryCycleDialog,
  type ConfirmSpec,
} from "./planDialogs";

// Change plan — /studio/account/plan and the embedded /app/account/plan, built to docs/design/settings/billing
// (BILLING-HANDOFF.md, "Change plan page"): the three plans, more credits
// (one time or every cycle), and Cancel — the only place Cancel appears.
//
// SHOPIFY BILLING IS NOT CONNECTED YET. Every plan or credit action is
// confirmed in its dialog and then changes nothing: the hand-off to
// Shopify's approval screen is its own build (see account.server.ts).
// `confirm` below is the one place that hand-off goes.

const NOT_CONNECTED = "Shopify billing isn’t connected yet. Nothing changed.";
const NO_CONTACT_FORM = "The contact form isn’t ready yet. Nothing changed.";

interface PlanContext {
  data: AccountData;
  plan: SelfServePlan;
  figures: CreditFigures;
}

export function ChangePlanScreen({
  data,
  paths = STUDIO_ACCOUNT_PATHS,
}: {
  data: AccountData;
  paths?: AccountPaths;
}) {
  const plan = PLANS[data.planKey];
  const figures = creditFigures(plan, data.credits, data.usage);
  const context: PlanContext = { data, plan, figures };
  const toast = useQzToast();
  const [dialog, setDialog] = useState<ConfirmSpec | null>(null);

  const confirm = () => {
    setDialog(null);
    toast(NOT_CONNECTED);
  };
  const pickPlan = (target: Plan) => {
    if (target.selfServe) setDialog(changePlanDialog(context, target));
    else toast(NO_CONTACT_FORM);
  };

  return (
    <div className="acct">
      <div className="acct-col">
        <header className="hm3-card acct-head">
          <div className="acct-head-back">
            <Link to={paths.account} className="acct-back" aria-label="Back to Account">
              <AcctIc name="back" />
            </Link>
            <h1>Change plan</h1>
          </div>
          <p className="acct-head-now">
            You’re on <b>{plan.name}</b> ·{" "}
            {figures.over > 0 ? `${fmtNum(figures.over)} credits over` : `${fmtNum(figures.left)} credits left`}
          </p>
        </header>
        <PlansCard {...context} onPick={pickPlan} />
        <MoreCreditsCard {...context} onPick={pickPlan} onConfirm={setDialog} />
        <CancelCard {...context} onCancel={() => setDialog(cancelDialog(context))} onKeep={() => toast(NOT_CONNECTED)} />
      </div>
      <ConfirmDialog spec={dialog} onClose={() => setDialog(null)} onConfirm={confirm} />
    </div>
  );
}

/* ── The three plans ─────────────────────────────────────────────────────── */

function PlansCard({ data, plan, onPick }: PlanContext & { onPick: (target: Plan) => void }) {
  const { dates } = data;
  return (
    <section className="hm3-card acct-pad" aria-labelledby="acct-plans">
      <div className="acct-sechead">
        <h2 id="acct-plans">Plans</h2>
        <p className="acct-aside">You confirm every change in Shopify.</p>
      </div>
      <div className="acct-plans">
        {PLAN_ORDER.map((key) => (
          <PlanTile key={key} tile={PLANS[key]} current={plan} onPick={onPick} />
        ))}
      </div>
      <p className="acct-note">
        {data.inTrial
          ? `Change plans during your trial at no cost. Your first bill, on ${dates.billDate}, is for the plan you’re on that day.`
          : `Upgrades start today and you pay only for the days left in this cycle. Downgrades start on your next bill date, ${dates.billDate}.`}
      </p>
    </section>
  );
}

function PlanTile({
  tile,
  current,
  onPick,
}: {
  tile: Plan;
  current: SelfServePlan;
  onPick: (target: Plan) => void;
}) {
  const isCurrent = tile.key === current.key;
  const action = !tile.selfServe ? "Talk to us" : isUpgrade(current.key, tile.key) ? "Upgrade" : "Downgrade";
  return (
    <article className={isCurrent ? "acct-pl is-current" : "acct-pl"}>
      <b className="acct-pl-name">{tile.name}</b>
      <div className="acct-pl-price">
        <b>
          ${tile.price}
          {tile.selfServe ? null : "+"}
        </b>
        <span>a month</span>
      </div>
      <p className="acct-pl-cr">
        {tile.creditsLabel}
        <small>
          {tile.selfServe ? `More credits at ${fmtUsd(creditsCents(1, tile.rate))} each` : "Set with you"}
        </small>
      </p>
      <ul>
        {tile.feats.map((feat) => (
          <li key={feat}>
            <AcctIc name="check" />
            <span>{feat}</span>
          </li>
        ))}
      </ul>
      {isCurrent ? (
        <span className="acct-pl-now">Your plan</span>
      ) : (
        <button
          type="button"
          className={action === "Upgrade" ? "acct-btn is-sm" : "acct-btn is-sm is-quiet"}
          onClick={() => onPick(tile)}
        >
          {action}
        </button>
      )}
    </article>
  );
}

/* ── More credits, without changing plan ─────────────────────────────────── */

type Mode = "once" | "cycle";

function MoreCreditsCard({
  data,
  plan,
  figures,
  onPick,
  onConfirm,
}: PlanContext & { onPick: (target: Plan) => void; onConfirm: (spec: ConfirmSpec) => void }) {
  const context: PlanContext = { data, plan, figures };
  const range = plan.add;
  const [mode, setMode] = useState<Mode>("once");
  const [amount, setAmount] = useState(() => defaultAmount(range, figures.over));
  // The field's own text: it takes any whole number, and is clamped on blur.
  const [fieldText, setFieldText] = useState(String(amount));

  const setBoth = (value: number) => {
    setAmount(value);
    setFieldText(String(value));
  };
  const onFieldChange = (text: string) => {
    setFieldText(text);
    const value = parseInt(text, 10);
    if (value >= range.min && value <= range.max) setAmount(value);
  };
  const onFieldBlur = () => {
    const value = parseInt(fieldText, 10);
    setBoth(clampAmount(range, Number.isNaN(value) ? range.def : value));
  };

  const once = mode === "once";
  const cost = creditsCents(amount, plan.rate);
  const everyCycle = data.credits.everyCycle;
  const next = nextPlanUp(plan.key);
  const mark = breakEvenMark(plan, figures.monthlyCents, next);
  const fill = (((amount - range.min) / (range.max - range.min)) * 100).toFixed(2);
  const markStyle = { "--at": (mark?.at ?? 0).toFixed(4) } as CSSProperties;

  return (
    <section className="hm3-card acct-pad" aria-labelledby="acct-more">
      <div className="acct-sechead">
        <h2 id="acct-more">More credits</h2>
        <p className="acct-aside">
          {fmtUsd(creditsCents(1, plan.rate))} a credit on {plan.name}
        </p>
      </div>
      <div className="acct-mc-row">
        <div className="acct-seg" role="group" aria-label="How often">
          <button type="button" aria-pressed={once} onClick={() => setMode("once")}>
            One time
          </button>
          <button type="button" aria-pressed={!once} onClick={() => setMode("cycle")}>
            Every cycle
          </button>
        </div>
        <p className="acct-sub">
          {once ? "A single top-up, added today." : "Added to your plan on every bill, until you remove it."}
        </p>
      </div>
      <div className="acct-amt">
        <div className="acct-amt-top">
          <div className="acct-amt-num">
            <input
              type="number"
              id="acct-amount"
              inputMode="numeric"
              min={range.min}
              max={range.max}
              step={1}
              value={fieldText}
              onChange={(event) => onFieldChange(event.target.value)}
              onBlur={onFieldBlur}
            />
            <label htmlFor="acct-amount">more credits</label>
          </div>
          <div className="acct-amt-cost">
            <b>{fmtUsd(cost)}</b>
            <span>{once ? "one time" : "a month, added to your plan"}</span>
          </div>
        </div>
        <div className="acct-slide" style={markStyle}>
          <input
            type="range"
            aria-label="How many more credits"
            aria-valuetext={`${fmtNum(amount)} credits, ${fmtUsd(cost)}${once ? "" : " a month"}`}
            min={range.min}
            max={range.max}
            step={range.step}
            value={amount}
            style={{ "--p": `${fill}%` } as CSSProperties}
            onChange={(event) => setBoth(clampAmount(range, Number(event.target.value)))}
          />
          {mark?.shown ? <i className="acct-slide-mark" aria-hidden="true" /> : null}
        </div>
        <div className="acct-slide-ax" style={markStyle}>
          <span>{fmtNum(range.min)}</span>
          {mark?.shown && next ? (
            <b>
              {fmtNum(mark.amount)} · same price as {next.name}
            </b>
          ) : null}
          <span>{fmtNum(range.max)}</span>
        </div>
      </div>
      {everyCycle > 0 ? (
        <div className="acct-mc-have">
          <span>
            You add <b>{fmtNum(everyCycle)} credits</b> every cycle · {fmtUsd(figures.everyCycleCents)} a month
          </span>
          <button type="button" className="acct-link" onClick={() => onConfirm(removeEveryCycleDialog(context))}>
            Remove
          </button>
        </div>
      ) : null}
      <div className="acct-mc-buy">
        <p>
          {once
            ? `${fmtNum(amount)} credits today, charged once. What you don’t use rolls over like the rest.`
            : `Your plan becomes ${fmtUsd(figures.monthlyCents + cost)} a month with ${fmtNum(plan.credits + everyCycle + amount)} credits each cycle.`}
        </p>
        <button
          type="button"
          className="acct-btn"
          onClick={() => onConfirm(once ? buyCreditsDialog(context, amount) : addEveryCycleDialog(context, amount))}
        >
          {once
            ? `Buy ${fmtNum(amount)} credits · ${fmtUsd(cost)}`
            : `Add ${fmtNum(amount)} every cycle · ${fmtUsd(cost)} a month`}
        </button>
      </div>
      {next ? <UpgradeNudge plan={plan} next={next} withCreditsCents={figures.monthlyCents + cost} onPick={onPick} /> : null}
    </section>
  );
}

/** The violet prompt: the next plan is the better deal per credit. */
function UpgradeNudge({
  plan,
  next,
  withCreditsCents,
  onPick,
}: {
  plan: SelfServePlan;
  next: Plan;
  withCreditsCents: number;
  onPick: (target: Plan) => void;
}) {
  return (
    <div className="acct-nudge">
      {next.selfServe ? (
        <p>
          <b>
            {next.name} is {fmtUsdShort(next.price * 100)} a month for {fmtNum(next.credits)} credits.
          </b>{" "}
          That’s {fmtUsd(Math.round((next.price * 100) / next.credits))} a credit instead of{" "}
          {fmtUsd(creditsCents(1, plan.rate))}.
          {withCreditsCents >= next.price * 100
            ? ` ${plan.name} with these credits comes to ${fmtUsd(withCreditsCents)}.`
            : null}
        </p>
      ) : (
        <p>
          <b>Need this many every cycle?</b> {next.name} starts at {fmtNum(next.credits)} credits and a lower price
          per credit.
        </p>
      )}
      <button type="button" className="acct-btn is-sm" onClick={() => onPick(next)}>
        {next.selfServe ? `Upgrade to ${next.name}` : "Talk to us"}
      </button>
    </div>
  );
}

/* ── Cancel: the last card, and the only place it appears ────────────────── */

function CancelCard({
  data,
  plan,
  onCancel,
  onKeep,
}: PlanContext & { onCancel: () => void; onKeep: () => void }) {
  const { dates, inTrial, ending } = data;
  const text = ending
    ? `${inTrial ? "Your trial is cancelled." : `${plan.name} is cancelled and ends on ${dates.lastDay}.`} Changed your mind?`
    : inTrial
      ? `Cancel before ${dates.billDate} and you pay nothing. Your quizzes come off your store when you cancel.`
      : `${plan.name} stays on until ${dates.lastDay} if you cancel. After that your quizzes come off your store.`;
  return (
    <section className="hm3-card acct-cancel" aria-label="Cancel plan">
      <p>{text}</p>
      <button type="button" className="acct-btn is-sm is-quiet" onClick={ending ? onKeep : onCancel}>
        {ending ? `Keep ${plan.name}` : inTrial ? "Cancel trial" : "Cancel plan"}
      </button>
    </section>
  );
}

/* ── The confirm dialog ──────────────────────────────────────────────────── */

function ConfirmDialog({
  spec,
  onClose,
  onConfirm,
}: {
  spec: ConfirmSpec | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const quietRef = useRef<HTMLButtonElement>(null);
  if (!spec) return null;
  return (
    <QzModal
      open
      onClose={onClose}
      size="sm"
      className="acct-dlg"
      title={spec.title}
      destructive={spec.destructive ?? false}
      initialFocusRef={quietRef}
      footer={
        <>
          <button ref={quietRef} type="button" className="acct-btn is-sm is-quiet" onClick={onClose}>
            {spec.no}
          </button>
          <button
            type="button"
            className={spec.destructive ? "acct-btn is-sm is-crit" : "acct-btn is-sm"}
            onClick={onConfirm}
          >
            {spec.yes ?? "Continue in Shopify"}
          </button>
        </>
      }
    >
      <p>{spec.lead}</p>
      {spec.rows?.length ? (
        <dl>
          {spec.rows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {spec.list?.length ? (
        <ul>
          {spec.list.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </QzModal>
  );
}
