// Theme app extension identity (extensions/quizocalypse-block): the uid from
// shopify.extension.toml + the block's liquid filename. Used to deep-link the
// Shopify theme editor with the Wiskr quiz block pre-added, replacing the old
// "find the block yourself and paste two fields" flow. Pure — safe on client
// and server.
export const THEME_EXTENSION_UID = "83292ef3-2d13-bd59-035d-1846fa2ecdd8f98f630f";
export const THEME_BLOCK_HANDLE = "quiz";

// The standard Shopify one-click "Add to theme" link: opens the live theme in
// the editor with our app block already inserted into the chosen template
// (target=newAppsSection falls back gracefully to the Apps section if the
// block can't be auto-inserted). The merchant still pastes the Quiz ID into
// the block's settings — the App URL is prefilled by the block schema.
export function themeEditorAddBlockUrl(shopDomain: string, template = "index"): string {
  return (
    `https://${shopDomain}/admin/themes/current/editor` +
    `?template=${encodeURIComponent(template)}` +
    `&addAppBlockId=${THEME_EXTENSION_UID}/${THEME_BLOCK_HANDLE}` +
    `&target=newAppsSection`
  );
}

// Only real Shopify shops can deep-link (the standalone studio may run with a
// synthetic shop record).
export function isShopifyShopDomain(domain: string | null | undefined): domain is string {
  return typeof domain === "string" && domain.endsWith(".myshopify.com");
}
