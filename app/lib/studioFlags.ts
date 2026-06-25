// Standalone studio feature flags.
//
// SHOW_OTHER_BUILD_PATHS — when false, "Create with AI" (the /studio/onboarding
// funnel) is the ONLY way to build a quiz. The Import / Start-from-Scratch cards,
// the Inspiration template gallery, and the /studio/new blank/template route are
// all hidden (and /studio/new redirects into the AI funnel). Every path is still
// wired — flip this to true to bring them back in one line.
//
// Typed as `boolean` (not the literal `false`) on purpose, so call sites like
// `SHOW_OTHER_BUILD_PATHS || x` don't trip no-unnecessary-condition lint.
export const SHOW_OTHER_BUILD_PATHS: boolean = false;
