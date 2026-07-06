// Builder Re-work Step 1 — the funnel's loader + action, lifted out of the
// route so the studio (cookie) and embedded (Shopify admin) routes are thin
// wrappers over ONE shop-scoped implementation. Mirrors the `*ForShop`
// editor-IO seam: each route resolves its own shop + builder URL, the logic
// lives here.
//
// BIC-2 C3b split the implementation into focused modules; this file is the
// stable re-export barrel so the four funnel routes keep their paths:
//   funnelDraft.server.ts   — resume-or-seed front door + draft load/write
//   bucketPersist.server.ts — bucket-resolution input loading
//   funnelLoader.server.ts  — the FunnelData loader payload
//   funnelIntents.server.ts — the action (every stage-transition intent)
export { MIN_GOAL_CHARS, findOrCreateStep1Draft } from "./funnelDraft.server";
export { loadStep1FunnelData } from "./funnelLoader.server";
export { runStep1FunnelAction } from "./funnelIntents.server";
