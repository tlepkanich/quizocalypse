import { useState } from "react";
import type { ResolvedRecPageConfig } from "../../../lib/recommendDecider";
import type { stylesFor } from "../runtimeStyles";
import { DeciderCaptureView } from "./DeciderViews";
export function InlineDeciderCapture({
  config,
  styles,
  quizId,
  sessionId,
  shopDomain,
  storeName,
  onCaptured,
}: {
  config: ResolvedRecPageConfig;
  styles: ReturnType<typeof stylesFor>;
  quizId: string;
  sessionId: string;
  shopDomain: string;
  storeName?: string;
  onCaptured?: (email: string) => void;
}) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);
  if (done) return <p role="status">Your details have been saved.</p>;
  return (
    <section aria-label="Email capture" style={{ marginTop: 28 }}>
      <DeciderCaptureView
        config={{
          ...config,
          captureHeadline: config.captureHeadline || "Save your details",
          captureSubtext:
            config.captureSubtext ||
            "Share your contact details with the store.",
          captureCta: config.captureCta || "Save my details",
        }}
        styles={styles}
        quizId={quizId}
        sessionId={sessionId}
        shopDomain={shopDomain}
        storeName={storeName}
        inline
        onDone={(contact, saved) => {
          if (saved && contact?.email) onCaptured?.(contact.email);
          setDone(Boolean(saved));
          setError(!saved);
        }}
      />
      {error && (
        <p role="alert">We couldn’t save your details. Please try again.</p>
      )}
    </section>
  );
}
