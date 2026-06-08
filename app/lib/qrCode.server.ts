import QRCode from "qrcode";

// Server-side QR generation for the shareable quiz link (Phase E). Returns a
// PNG data URL (renderable as <img src=…>), or null on failure — the QR is a
// nice-to-have, so a generation error must never block the editor. Kept in a
// .server module so the `qrcode` dependency stays out of the client bundle.
export async function qrDataUrl(text: string): Promise<string | null> {
  if (!text) return null;
  try {
    return await QRCode.toDataURL(text, {
      margin: 1,
      width: 240,
      errorCorrectionLevel: "M",
    });
  } catch {
    return null;
  }
}
