import { useFetcher } from "@remix-run/react";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import type { action as goalAction } from "../../routes/studio.goal";

// HOME-3 (first-run handoff §5, §9) — THE goal box. Every place the app asks
// "what should this quiz do" mounts this one component and asks for three
// things only: the goal, the number of questions, the intro screen. It posts
// to /studio/goal's action (FLOW-1; /app/goal on the embedded Home), which
// claims the decider draft and redirects into onboarding; a too-short goal
// renders that action's 400 copy.
//
// Densities:  dialog — the first-open pop-up (21px goal)
//             page   — Home with no quiz, the goal page (20px)
//             card   — Home's full create card once a quiz exists (18px)
//             row    — Home's two-row module under the reminder (16px, arrow)

export type GoalBrief = { goal: string; count: string; intro: boolean };
export const EMPTY_GOAL_BRIEF: GoalBrief = { goal: "", count: "auto", intro: true };
export const GOAL_PLACEHOLDER = "Help our first time customers with.....";

const COUNT_OPTIONS = ["auto", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];

/** The form payload for /studio/goal. Auto sends no length; intro on sends nothing. */
export function goalBriefFields(brief: GoalBrief): Record<string, string> {
  const fields: Record<string, string> = { goal: brief.goal.trim() };
  if (brief.count !== "auto") fields.length = brief.count;
  if (!brief.intro) fields.intro = "0";
  return fields;
}

/** `action` is the surface's goal route: /studio/goal, or /app/goal when
    embedded (Shopify auth — the studio route would reject it). */
export function useGoalCreate(action = "/studio/goal") {
  const fetcher = useFetcher<typeof goalAction>();
  return {
    create: (brief: GoalBrief) => fetcher.submit(goalBriefFields(brief), { method: "post", action }),
    busy: fetcher.state !== "idle",
    error: fetcher.data && !fetcher.data.ok ? fetcher.data.error : null,
  };
}

export function GoalIc({ children, size }: { children: ReactNode; size?: number }) {
  return (
    <svg
      className="hm3-ic"
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={size ? { width: size, height: size } : undefined}
    >
      {children}
    </svg>
  );
}

const ARROW = (
  <>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </>
);

/* The art (§6): an answer picked, a data point added to a profile, a match
   found. Never the merchant's own quiz. CSS only; frozen under reduced motion. */
export function GoalArt({ mini = false }: { mini?: boolean }) {
  return (
    <div className={mini ? "hm3-mart is-mini" : "hm3-mart"}>
      <span className="hm3-mart-glow" />
      <div className="hm3-mq">
        <span className="hm3-mq-bar" />
        <span className="hm3-mq-opt o1"><i /><b /></span>
        <span className="hm3-mq-opt o2"><i /><b /></span>
        <span className="hm3-mq-opt o3"><i /><b /></span>
      </div>
      <div className="hm3-pf">
        <span className="hm3-pf-row r1" />
        <span className="hm3-pf-row r2" />
        <span className="hm3-pf-row r3" />
        <span className="hm3-pf-match">
          <GoalIc>
            <path d="M20 6 9 17l-5-5" />
          </GoalIc>
          <i />
        </span>
      </div>
      <span className="hm3-fly f1" />
      <span className="hm3-fly f2" />
      <span className="hm3-fly f3" />
    </div>
  );
}

export function GoalBox({
  id,
  density,
  brief,
  setBrief,
  onCreate,
  busy,
  error,
  inputRef,
}: {
  id: string;
  density: "dialog" | "page" | "card" | "row";
  brief: GoalBrief;
  setBrief: (next: Partial<GoalBrief>) => void;
  onCreate: () => void;
  busy: boolean;
  error: string | null;
  /** Pass a ref when a parent must focus or select the goal (dialogs, chips). */
  inputRef?: RefObject<HTMLTextAreaElement>;
}) {
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const taRef = inputRef ?? ownRef;
  const minHeight = density === "row" ? 44 : density === "card" ? 92 : 96;

  // Grow with the goal — including when a starter or example writes it.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, minHeight)}px`;
  }, [brief.goal, minHeight, taRef]);

  const submit = () => {
    if (busy) return;
    if (!brief.goal.trim()) {
      taRef.current?.focus();
      return;
    }
    onCreate();
  };

  const controls = (
    <div className="hm3-ctrls">
      <span className="hm3-qsel">
        <label htmlFor={`${id}-count`}>Questions</label>
        <span className="hm3-selwrap">
          <select
            id={`${id}-count`}
            value={brief.count}
            onChange={(e) => setBrief({ count: e.target.value })}
          >
            {COUNT_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {v === "auto" ? "Auto" : v}
              </option>
            ))}
          </select>
          <GoalIc>
            <path d="m6 9 6 6 6-6" />
          </GoalIc>
        </span>
      </span>
      <label className="hm3-swlabel">
        <input
          type="checkbox"
          className="hm3-sw"
          checked={brief.intro}
          onChange={(e) => setBrief({ intro: e.target.checked })}
        />
        Intro screen
      </label>
    </div>
  );

  const field = (
    <>
      <label className="qz-sr-only" htmlFor={`${id}-goal`}>
        Your goal
      </label>
      <textarea
        id={`${id}-goal`}
        ref={taRef}
        rows={density === "row" ? 1 : 3}
        value={brief.goal}
        placeholder={GOAL_PLACEHOLDER}
        onChange={(e) => setBrief({ goal: e.target.value })}
        onKeyDown={(e) => {
          // Enter creates; Shift+Enter is a newline.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
    </>
  );

  const errorLine = error ? (
    <p className="hm3-error" role="alert">
      {error}
    </p>
  ) : null;

  if (density === "row") {
    return (
      <div className="hm3-goal is-row">
        {field}
        <div className="hm3-rowbar">
          {controls}
          <button
            type="button"
            className="hm3-go"
            aria-label={busy ? "Creating your quiz…" : "Create quiz"}
            aria-busy={busy}
            disabled={busy}
            onClick={submit}
          >
            <GoalIc>{ARROW}</GoalIc>
          </button>
        </div>
        {errorLine}
      </div>
    );
  }
  return (
    <div className={`hm3-goal is-${density}`}>
      <div className="hm3-box">
        {field}
        <div className="hm3-boxbar">
          {controls}
          <button type="button" className="hm3-btn" aria-busy={busy} disabled={busy} onClick={submit}>
            {busy ? "Creating…" : "Create quiz"} <GoalIc>{ARROW}</GoalIc>
          </button>
        </div>
      </div>
      {errorLine}
    </div>
  );
}
