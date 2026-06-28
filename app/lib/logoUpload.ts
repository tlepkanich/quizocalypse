// Design Settings spec §1 — brand LOGO upload validation (client-safe, pure).
// The uploaded image is stored as a base64 data URL in DesignTokens.logo.url
// (no external object store — works standalone; <img src> renders data: and
// https: identically). These helpers gate type/size/url; the funnel intent does
// the Buffer→base64 conversion server-side. Kept Buffer-free so the panel can
// import ALLOWED/ACCEPT for its file input without breaking the client bundle.

export const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB hard cap (per spec)

export const ALLOWED_LOGO_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/svg+xml",
  "image/webp",
  "image/gif",
] as const;

// The <input type="file"> accept attribute (mirror of ALLOWED_LOGO_TYPES).
export const LOGO_ACCEPT = ".png,.jpg,.jpeg,.svg,.webp,.gif,image/*";

export const LOGO_SIZES = ["sm", "md", "lg"] as const;
export const LOGO_ALIGNS = ["left", "center"] as const;

export function isAllowedLogoType(type: string | undefined | null): boolean {
  return !!type && (ALLOWED_LOGO_TYPES as readonly string[]).includes(type.toLowerCase());
}

// A logo.url may be an uploaded data URL OR a pasted https asset. Reject anything
// else (http, javascript:, relative) so a stored url can be rendered without a
// re-validation pass and never carries an active scheme.
export function isSafeLogoUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  const u = url.trim();
  if (u.length > 3_500_000) return false; // ~2.6MB base64 ceiling guard
  return /^https:\/\/.+/i.test(u) || /^data:image\/[a-z0-9.+-]+;base64,/i.test(u);
}
