import {
  FONTS, QUARTZ_TOKENS, QUARTZ_DARK, QUARTZ_CSS, QUARTZ_COLOR, quartzType, FACE,
} from "./quartz.mjs";

const SHAPE = {
  shapeNote: "Identical in all four. 4 / 6 / 8, and one 4px spacing unit.",
  shapeLede:
    "The shape system does not change between layouts — that is the point of the study. Corners never leave 4–8px, spacing is a 4px unit, and depth is spent once on menus. <strong>What changes is where the chrome lives</strong> and how much of the window the work gets.",
  tiles: [
    ["Radius", `<span class="radii-box" style="border-radius:4px"></span><span class="radii-box" style="border-radius:6px"></span><span class="radii-box" style="border-radius:8px"></span>`, "<code>4</code> ticks and tags · <code>6</code> buttons, fields, chips, pills · <code>8</code> cards. No full pills anywhere."],
    ["Spacing", `<span class="space-bar" style="height:4px"></span><span class="space-bar" style="height:8px"></span><span class="space-bar" style="height:12px"></span><span class="space-bar" style="height:16px"></span><span class="space-bar" style="height:24px"></span>`, "4 / 8 / 12 / 16 / 24 / 32. Table rows sit at 11px vertical."],
    ["Depth", `<span class="elev-box" style="box-shadow:none"></span><span class="elev-box" style="box-shadow:0 10px 26px -10px rgba(32,28,46,.26),0 1px 2px rgba(32,28,46,.07)"></span>`, "Content is flat with a 1px border. Menus, dialogs and the block toolbar carry the only shadow."],
    ["Motion", `<span class="elev-box" style="display:grid;place-items:center;font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--ink-3)">130ms · ease-out</span>`, "Hover and selection change in 130ms. Washes fade; nothing slides."],
  ],
};

export const variant = ({ id, idx, name, layout, face, title, thesis, facts, ideaNote, lede,
  principles, notes, fixes, risks, extraCss = "", tokens = {} }) => ({
  id, idx, name, layout, fonts: FONTS, fontSwitcher: face, markVariant: "solid",
  badge: `Quartz · layout ${idx} of 4 · ${name}`,
  docTitle: `Quartz ${name} — layout ${idx} of 4`,
  title, thesis, facts, ideaNote, lede, principles,
  ...quartzType(face),
  ...QUARTZ_COLOR,
  ...SHAPE,
  ...notes,
  fixes, risks,
  tokens: { ...QUARTZ_TOKENS, "--font-display": FACE[face], "--font-ui": FACE[face],
            "--font-num": FACE[face], "--font-stat": FACE[face], ...tokens },
  dark: QUARTZ_DARK,
  css: QUARTZ_CSS + extraCss,
});
