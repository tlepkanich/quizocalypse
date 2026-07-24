# App chrome — top bar + stepper

The shared frame that wraps **every** quiz-builder screen. Adopt it so all
screens share one back affordance, one progress stepper, one Continue button,
and an optional sub-bar. The reference implementation (exact markup + CSS +
data-driven renderer) is [`app-chrome.html`](app-chrome.html) — copy from there;
this file is the contract.

---

## Anatomy

```
┌─────────────────────────────────────────────────────────────────────┐
│ [‹]   ◦ Recs ── ◦ Shape ── ● Questions ── ○ Results ── ○ Design  [Continue ›] │  ← top bar (always)
├─────────────────────────────────────────────────────────────────────┤
│  [ Tabs ]                              hint text        [ Primary ▾ ] │  ← sub-bar (optional)
│                                                                       │
│  … screen content …                                                   │
└─────────────────────────────────────────────────────────────────────┘
```

A screen is an `.app` card. The **top bar** is mandatory and identical on every
screen. The **sub-bar** is per-screen and optional.

---

## 1 · The step model

Five steps, fixed order, one canonical label each:

```
Recs → Shape → Questions → Results → Design
```

The chrome takes a single input: the **current step index** (0–4). Everything
else is derived from it — no per-screen state.

| Position vs. current | State class | Dot | Label |
|---|---|---|---|
| before current | `.done` | `✓` on `--accent-wash` fill, `--accent-ink` ink | `--ink-4`, weight 500 |
| current | `.cur` | zero-padded number (`03`) on solid `--accent`, white, 4px `--accent-wash` halo | `--ink`, weight 600 |
| after current | *(none)* | zero-padded number on `--cream-2`, `--ink-4` | `--ink-4`, weight 500 |

Connector `.link` between nodes is `--rule`; segments **before** the current
step get `.link.done` (`--accent-wash`). The current node carries
`data-cur` (the ignite hook) and, when igniting, three `.spark` glyphs.

Numbers are zero-padded to two digits and shown in `--mono`. Done nodes replace
the number with `✓`.

---

## 2 · The 3-second "ignite"

When a screen is **entered**, the current pill plays a one-shot flourish for
**~3000 ms**, then settles to the static current state:

- `.dot` halo pulses (`qzHalo`, 2.3s loop while active),
- a conic sheen sweeps the ring (`qzSpin`),
- three sparks twinkle (`qzTwinkle`).

It is driven by adding `.igniting` to the `.cur` node and removing it after 3s.
Re-running requires a reflow (`void node.offsetWidth`) between remove and add so
the animation restarts.

Rules:
- Fire **once per entry**, not on every re-render. Advancing to a new step is a
  new entry → ignite the new current pill.
- It draws attention to *where you are now* — never fire it on `done` or
  upcoming pills.
- **`prefers-reduced-motion: reduce` disables it entirely** (no halo, no spin,
  no sparks). This is mandatory, not optional.

---

## 3 · Back arrow

`.iconbtn` on the far left. Goes to the **previous step**, or — from the first
step — out to the quizzes home. Destroys nothing on its own; if the screen has
unsaved intent, confirm before leaving (that's the screen's job, not the
chrome's). `title` should name the destination ("Back to Shape", "Back to all
quizzes").

---

## 4 · Continue button

`.continue`, far right, solid `--accent`. Advances to the next step. The label is
overridable per screen — default **"Continue"**, but e.g. **"Publish"** on the
last step (Design). Forward chevron `i-fwd` trails the label. It can be hidden
(`showContinue: false`) on screens that own their own advance affordance.

The top bar is **only** back · stepper · continue. No titles, no actions, no
tabs live in it — those belong to the sub-bar.

---

## 5 · The optional sub-bar

Sits inside `.content`, above the screen body. Left-to-right:

- **Tabs** (`.qtabs`) — segmented control for in-screen views (e.g. Questions /
  Overview). Omit if the screen has a single view. Active tab = `.on`.
- **`.sp`** spacer, then an optional **`.hint`** (muted helper text).
- **Primary action**, right-aligned. Either a plain `.newbtn` or a **split
  button** (`.newsplit`: a main `.nb-main` + a caret `.nb-caret` that opens a
  `.newmenu`). The split form is for "one obvious action + related variants"
  (e.g. **+ Question** with **Content block** in the menu).

Any of these may be absent. A screen may render the sub-bar with only a primary
action, only tabs, etc.

---

## 6 · Tokens

The chrome depends on these and nothing else. Copy the `:root` block from
`app-chrome.html` or import the app's token sheet.

| Token | Value | Used for |
|---|---|---|
| `--accent` | `#6D5AE6` | current dot, Continue, primary action |
| `--accent-2` | `#6B4FD8` | Continue / primary hover |
| `--accent-ink` | `#3C3489` | done-dot ink, active tab ink |
| `--accent-wash` | `#EDEBFC` | current-dot halo, done fills, done links |
| `--ink` / `--ink-4` / `--ink-25` | `#2E2740` / `#7C7791` / `#B6B0C8` | labels, hint, muted |
| `--rule` / `--rule-2` | `#E9E7EF` / `#F1EFF6` | borders, connector track, sub-bar divider |
| `--cream-2` | `#F2F1F5` | upcoming dot, tab track, icon-button hover |
| `--mono` | ui-monospace stack | step numbers |
| `--sans` | system stack | everything else |

---

## 7 · Adopting it

```js
import  // (or copy) the tokens + chrome CSS, then:
mountChrome(el, current, { continueLabel, showContinue });
```

- `mountChrome(el, current, opts)` renders the top bar into `el` and fires
  ignite. Call it on screen entry and whenever `current` changes.
- The sub-bar is plain markup the screen owns (see Variant A in the reference);
  wire its tabs / menu locally.

Constraints:
- **`STEPS` is canonical** — same five labels, same order, everywhere. Don't
  relabel or reorder per screen.
- Never put screen-specific controls in the top bar; use the sub-bar.
- The stepper scrolls horizontally on narrow widths (`.flow{overflow-x:auto}`);
  the `10px` padding / `-10px` margin trick preserves the current dot's halo
  without changing bar height — keep it.
- Keep class names (`.top`, `.node`, `.dot`, `.link`, `.continue`, `.subhead`,
  `.qtabs`, `.newbtn`, `.newsplit`) so adoption is copy-paste and future edits
  land in one place.

---

## Related

- [`../phone-preview/`](../phone-preview/) — the device-preview primitive, same
  extract-and-share pattern.
