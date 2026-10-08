import { useFetcher } from "@remix-run/react";
import { QzButton, QzCard, QzField, QzInput } from "./qz";

// ANALYTICS-HANDOFF §8 — the shop's ONE Klaviyo connection. Shared by the
// standalone (studio.integrations) and embedded (app.integrations) pages; both
// route the form to handleKlaviyoForm (klaviyo.server.ts). The key goes in and
// never comes back out: the page only ever shows the account name.
export interface KlaviyoCardState {
  connected: boolean;
  accountName: string | null;
  connectedAt: string | null;
  quizKeys: Array<{ quizId: string; quizName: string }>;
}

export function KlaviyoConnectionCard({ status }: { status: KlaviyoCardState }) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const busy = fetcher.state !== "idle";
  const error = fetcher.data && !fetcher.data.ok ? fetcher.data.error : null;
  return (
    <QzCard>
      <div className="qz-col qz-gap-12">
        <div>
          <div className="qz-label">Email marketing</div>
          <h2 className="qz-h2" style={{ marginTop: 6 }}>
            Klaviyo
          </h2>
        </div>
        {status.connected ? (
          <>
            <p style={{ margin: 0 }}>
              Connected{status.accountName ? <> to <strong>{status.accountName}</strong></> : null}. Every quiz’s
              Klaviyo step and “Create Klaviyo segment” in Analytics use this connection.
            </p>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="klaviyo-disconnect" />
              <QzButton size="sm" variant="ghost" type="submit" disabled={busy}>
                Disconnect
              </QzButton>
            </fetcher.Form>
          </>
        ) : (
          <>
            <p style={{ margin: 0 }}>
              Connect once and every quiz can send its answers, results and contacts to Klaviyo. Create a private API
              key in Klaviyo (Settings › API keys) with <strong>full access</strong>, so profiles, lists, events,
              subscriptions and segments all work.
            </p>
            <fetcher.Form method="post" className="qz-col qz-gap-8">
              <input type="hidden" name="intent" value="klaviyo-connect" />
              <QzField label="Private API key" hint="Stored encrypted. It is never shown again.">
                <QzInput name="apiKey" type="password" placeholder="pk_…" autoComplete="off" required />
              </QzField>
              <div>
                <QzButton size="sm" variant="primary" type="submit" disabled={busy}>
                  {busy ? "Connecting…" : "Connect Klaviyo"}
                </QzButton>
              </div>
            </fetcher.Form>
            {status.quizKeys.length > 0 ? (
              <fetcher.Form method="post" className="qz-col qz-gap-8">
                <input type="hidden" name="intent" value="klaviyo-move" />
                <p className="qz-muted" style={{ margin: 0 }}>
                  {status.quizKeys.length === 1
                    ? `“${status.quizKeys[0]!.quizName}” has its own Klaviyo key.`
                    : `${status.quizKeys.length} quizzes have their own Klaviyo key.`}{" "}
                  Use it as the shop’s connection instead of pasting one.
                </p>
                <div>
                  <QzButton size="sm" type="submit" disabled={busy}>
                    Use the quiz’s key
                  </QzButton>
                </div>
              </fetcher.Form>
            ) : null}
          </>
        )}
        {error ? (
          <p role="alert" style={{ margin: 0, color: "var(--qz-crit)" }}>
            {error}
          </p>
        ) : null}
      </div>
    </QzCard>
  );
}
