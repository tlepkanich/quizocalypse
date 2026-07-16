/**
 * Optional generated-campaign styling. These rules are mounted only when a
 * decider document carries `design_tokens.art_direction`, so legacy runtime
 * markup and CSS stay untouched.
 *
 * Visual layers never use pseudo-elements or decorative background images:
 * generated copy, controls, and focus rings always own a clear content plane.
 * Responsive rules key off the runtime breakpoint class because builder
 * previews can be narrow while the surrounding browser viewport is wide.
 */
export const GENERATED_ART_DIRECTION_CSS = `
  [data-qz-art-direction]:not([data-qz-art-direction="alpine-afterglow"]) .qz-runtime-page {
    min-height: 640px;
    position: relative;
    overflow: hidden;
  }
  [data-qz-art-direction]:not([data-qz-art-direction="alpine-afterglow"]) .qz-runtime-shell {
    position: relative;
    width: min(1040px, 100%);
  }
  [data-qz-art-direction]:not([data-qz-art-direction="alpine-afterglow"]) .qz-runtime-content {
    align-items: stretch !important;
  }
  [data-qz-art-direction]:not([data-qz-art-direction="alpine-afterglow"]) h1,
  [data-qz-art-direction]:not([data-qz-art-direction="alpine-afterglow"]) h2 {
    letter-spacing: -.028em;
    overflow-wrap: anywhere;
    text-wrap: balance;
  }
  [data-qz-art-direction]:not([data-qz-art-direction="alpine-afterglow"])[data-qz-node-type="question"] h2 {
    font-size: clamp(32px, 4.1cqw, 54px) !important;
    line-height: 1.02 !important;
    max-width: 760px;
    text-align: left !important;
  }
  [data-qz-art-direction]:not([data-qz-art-direction="alpine-afterglow"]) .qz-answer-opt {
    text-align: left !important;
    transition: border-color 180ms ease-out, background-color 180ms ease-out, color 180ms ease-out;
  }
  [data-qz-art-direction]:not([data-qz-art-direction="alpine-afterglow"]) .qz-answer-opt:hover {
    border-color: var(--qz-color-primary) !important;
  }
  [data-qz-art-direction]:not([data-qz-art-direction="alpine-afterglow"])[data-qz-node-type="message"] h1,
  [data-qz-art-direction]:not([data-qz-art-direction="alpine-afterglow"])[data-qz-node-type="message"] h2,
  [data-qz-art-direction]:not([data-qz-art-direction="alpine-afterglow"])[data-qz-node-type="message"] p {
    color: #FFF !important;
  }
  [data-qz-art-direction]:not([data-qz-art-direction="alpine-afterglow"])[data-qz-art-treatment="ruled"] .qz-runtime-page,
  [data-qz-art-direction]:not([data-qz-art-direction="alpine-afterglow"])[data-qz-art-treatment="bands"] .qz-runtime-page {
    background-image: none !important;
  }
  [data-qz-art-composition="poster_grid"][data-qz-node-type="intro"] .qz-runtime-page {
    background: var(--qz-color-primary) !important;
    justify-content: flex-end !important;
  }
  [data-qz-art-composition="poster_grid"][data-qz-node-type="intro"] .qz-runtime-content > div {
    max-width: 860px !important;
    padding-bottom: 36px !important;
    text-align: left !important;
  }
  [data-qz-art-composition="poster_grid"][data-qz-node-type="intro"] h1 {
    color: #FFF !important;
    font-size: clamp(46px, 5.5cqw, 72px) !important;
    line-height: .96 !important;
    max-width: 860px;
  }
  [data-qz-art-composition="poster_grid"][data-qz-node-type="intro"] p {
    color: color-mix(in srgb, #FFF 82%, transparent) !important;
    margin-left: 0 !important;
    max-width: 520px !important;
  }
  [data-qz-art-composition="poster_grid"][data-qz-node-type="intro"] button {
    background: #FFF !important;
    color: var(--qz-color-primary) !important;
  }
  [data-qz-art-composition="poster_grid"][data-qz-node-type="question"] .qz-runtime-content {
    margin: auto;
    max-width: 900px;
  }
  [data-qz-art-composition="field_guide"][data-qz-node-type="intro"] .qz-runtime-content > div {
    max-width: 860px !important;
    text-align: left !important;
  }
  [data-qz-art-composition="field_guide"][data-qz-node-type="intro"] h1 {
    font-size: clamp(44px, 5.2cqw, 68px) !important;
    line-height: .98 !important;
  }
  [data-qz-art-composition="field_guide"][data-qz-node-type="intro"] p {
    margin-left: 0 !important;
    max-width: 540px !important;
  }
  [data-qz-art-composition="field_guide"][data-qz-node-type="question"] .qz-runtime-content {
    margin: auto;
    max-width: 820px;
  }
  [data-qz-art-composition="quiet_form"] .qz-runtime-shell {
    width: min(760px, 100%) !important;
  }
  [data-qz-art-composition="quiet_form"][data-qz-node-type="intro"] .qz-runtime-content > div {
    max-width: 660px !important;
  }
  [data-qz-art-composition="quiet_form"][data-qz-node-type="intro"] h1 {
    font-size: clamp(42px, 5.2cqw, 64px) !important;
    line-height: 1 !important;
  }
  [data-qz-art-composition="quiet_form"][data-qz-node-type="question"] h2 {
    font-size: clamp(30px, 3.8cqw, 48px) !important;
  }
  [data-qz-art-composition="product_led_editorial"][data-qz-node-type="intro"] .qz-runtime-content > div {
    margin-left: 0 !important;
    max-width: 860px !important;
    text-align: left !important;
  }
  [data-qz-art-composition="product_led_editorial"][data-qz-node-type="intro"] h1 {
    font-size: clamp(46px, 5.5cqw, 72px) !important;
    line-height: .96 !important;
    max-width: 860px;
  }
  [data-qz-art-composition="product_led_editorial"][data-qz-node-type="intro"] p {
    margin-left: 0 !important;
    max-width: 520px !important;
  }
  [data-qz-art-direction]:not([data-qz-art-direction="alpine-afterglow"]) .qz-art-result {
    max-width: 1080px !important;
    text-align: left !important;
  }
  [data-qz-art-direction]:not([data-qz-art-direction="alpine-afterglow"]) .qz-art-result > h2 {
    font-size: clamp(42px, 5.4cqw, 70px) !important;
    line-height: .98 !important;
    max-width: 760px;
  }
  .qz-bp-mobile[data-qz-art-direction]:not([data-qz-art-direction="alpine-afterglow"]) .qz-runtime-page {
    min-height: 600px;
  }
  .qz-bp-mobile[data-qz-art-direction]:not([data-qz-art-direction="alpine-afterglow"])[data-qz-node-type="intro"] .qz-runtime-content > div {
    padding-bottom: 16px !important;
  }
  .qz-bp-mobile[data-qz-art-direction]:not([data-qz-art-direction="alpine-afterglow"])[data-qz-node-type="intro"] h1 {
    font-size: 42px !important;
    line-height: 1 !important;
  }
  .qz-bp-mobile[data-qz-art-direction]:not([data-qz-art-direction="alpine-afterglow"])[data-qz-node-type="question"] h2 {
    font-size: 32px !important;
  }
`;

export const ALPINE_ART_DIRECTION_CSS = `
  [data-qz-art-direction="alpine-afterglow"] .qz-runtime-page {
    min-height: 680px;
  }
  .qz-bp-desktop[data-qz-art-direction="alpine-afterglow"][data-qz-node-type="intro"] .qz-runtime-page {
    justify-content: center !important;
  }
  .qz-bp-desktop[data-qz-art-direction="alpine-afterglow"][data-qz-node-type="intro"] .qz-runtime-shell {
    box-sizing: border-box;
    margin-right: 50%;
    padding: 32px clamp(32px, 5cqw, 72px);
    width: 50%;
  }
  [data-qz-art-direction="alpine-afterglow"][data-qz-node-type="intro"] .qz-runtime-content {
    align-items: flex-start !important;
  }
  [data-qz-art-direction="alpine-afterglow"][data-qz-node-type="intro"] .qz-runtime-content > div {
    max-width: 560px !important;
    text-align: left !important;
  }
  [data-qz-art-direction="alpine-afterglow"][data-qz-node-type="intro"] h1 {
    color: #F4F0E7 !important;
    font-family: "Barlow Condensed", sans-serif !important;
    font-size: clamp(48px, 5.2cqw, 72px) !important;
    font-weight: 700 !important;
    letter-spacing: -.028em;
    line-height: .92 !important;
    max-width: 560px;
    overflow-wrap: normal;
    text-transform: uppercase;
    word-break: normal;
  }
  [data-qz-art-direction="alpine-afterglow"][data-qz-node-type="intro"] p {
    color: rgba(244, 240, 231, .82) !important;
    font-size: 16px !important;
    margin-left: 0 !important;
    max-width: 470px !important;
  }
  [data-qz-art-direction="alpine-afterglow"][data-qz-node-type="intro"] button,
  [data-qz-art-direction="alpine-afterglow"][data-qz-node-type="message"] button {
    font-size: 12px !important;
    letter-spacing: .1em;
    text-transform: uppercase;
  }
  [data-qz-art-direction="alpine-afterglow"][data-qz-node-type="message"] .qz-runtime-shell {
    width: min(940px, 100%);
  }
  [data-qz-art-direction="alpine-afterglow"][data-qz-node-type="message"] p {
    color: #F1EEE5 !important;
    font-family: "Barlow Condensed", sans-serif !important;
    font-size: clamp(36px, 5cqw, 64px) !important;
    line-height: 1 !important;
    text-transform: uppercase;
  }
  .qz-bp-desktop[data-qz-art-direction="alpine-afterglow"][data-qz-node-type="question"] .qz-runtime-page {
    justify-content: center !important;
  }
  .qz-bp-desktop[data-qz-art-direction="alpine-afterglow"][data-qz-node-type="question"] .qz-runtime-shell {
    box-sizing: border-box;
    margin-left: 46%;
    padding: 28px clamp(28px, 5cqw, 72px);
    width: 54%;
  }
  [data-qz-art-direction="alpine-afterglow"][data-qz-node-type="question"] .qz-runtime-content {
    align-items: stretch !important;
    margin: auto;
    max-width: 620px;
  }
  [data-qz-art-direction="alpine-afterglow"][data-qz-node-type="question"] h2 {
    font-family: "Barlow Condensed", sans-serif !important;
    font-size: clamp(36px, 4cqw, 54px) !important;
    font-weight: 700 !important;
    letter-spacing: -.024em;
    line-height: .96 !important;
    overflow-wrap: anywhere;
    text-align: left !important;
    text-transform: uppercase;
  }
  [data-qz-art-direction="alpine-afterglow"][data-qz-node-type="question"] .qz-answer-opt {
    background: transparent !important;
    border: 1px solid rgba(20, 35, 28, .22) !important;
    border-radius: 0 !important;
    text-align: left !important;
  }
  [data-qz-art-direction="alpine-afterglow"][data-qz-node-type="question"] .qz-answer-opt:hover {
    border-color: var(--qz-color-primary) !important;
  }
  [data-qz-art-direction="alpine-afterglow"][data-qz-node-type="result"] .qz-runtime-shell {
    width: min(1120px, 100%);
  }
  [data-qz-art-direction="alpine-afterglow"][data-qz-node-type="result"] .qz-runtime-content {
    margin: auto;
    max-width: 1080px;
  }
  [data-qz-art-direction="alpine-afterglow"][data-qz-node-type="result"] h2 {
    font-family: "Barlow Condensed", sans-serif !important;
    font-size: clamp(48px, 6.2cqw, 80px) !important;
    font-weight: 700 !important;
    line-height: .94 !important;
    text-transform: uppercase;
  }
  [data-qz-art-direction="alpine-afterglow"][data-qz-node-type="result"] img {
    border-radius: 0 !important;
  }
  [data-qz-art-direction="alpine-afterglow"] .qz-art-result {
    max-width: 1080px !important;
    text-align: left !important;
  }
  [data-qz-art-direction="alpine-afterglow"] .qz-art-result > h2 {
    max-width: 620px;
  }
  [data-qz-art-direction="alpine-afterglow"] .qz-art-result > p {
    line-height: 1.65;
    max-width: 680px;
  }
  [data-qz-art-direction="alpine-afterglow"] .qz-art-result .qz-rev-1 {
    align-items: start;
    display: grid;
    gap: 24px;
    grid-template-columns: minmax(0, 1.35fr) minmax(280px, .65fr);
  }
  [data-qz-art-direction="alpine-afterglow"] .qz-art-result .qz-rev-1 > div:last-child {
    grid-column: 1 / -1;
  }
  [data-qz-art-direction="alpine-afterglow"] .qz-art-result .qz-rev-2 {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  }
  .qz-bp-mobile[data-qz-art-direction="alpine-afterglow"] .qz-runtime-page {
    min-height: 680px;
  }
  .qz-bp-mobile[data-qz-art-direction="alpine-afterglow"][data-qz-node-type="intro"] .qz-runtime-page,
  .qz-bp-mobile[data-qz-art-direction="alpine-afterglow"][data-qz-node-type="question"] .qz-runtime-page {
    background-position: top !important;
    background-size: 100% 220px !important;
  }
  .qz-bp-mobile[data-qz-art-direction="alpine-afterglow"][data-qz-node-type="intro"] .qz-runtime-shell,
  .qz-bp-mobile[data-qz-art-direction="alpine-afterglow"][data-qz-node-type="question"] .qz-runtime-shell {
    box-sizing: border-box;
    margin: 220px 0 0;
    padding: 28px 20px;
    width: 100%;
  }
  .qz-bp-mobile[data-qz-art-direction="alpine-afterglow"][data-qz-node-type="intro"] h1 {
    font-size: 48px !important;
  }
  .qz-bp-mobile[data-qz-art-direction="alpine-afterglow"][data-qz-node-type="question"] h2 {
    font-size: 34px !important;
  }
  .qz-bp-mobile[data-qz-art-direction="alpine-afterglow"] .qz-art-result .qz-rev-1,
  .qz-bp-mobile[data-qz-art-direction="alpine-afterglow"] .qz-art-result .qz-rev-2 {
    grid-template-columns: 1fr !important;
  }
`;
