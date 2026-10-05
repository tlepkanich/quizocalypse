import { Link } from "@remix-run/react";

// The embedded /app before the first catalog sync has made the Shop row:
// there is no plan record to show yet. Home runs that sync when it opens.
export function AccountNotReady({ title }: { title: string }) {
  return (
    <div className="acct">
      <div className="acct-col">
        <header className="hm3-card acct-head">
          <h1>{title}</h1>
          <p className="acct-head-now">
            Your store isn’t set up in Wiskr yet.{" "}
            <Link to="/app" className="acct-link">
              Open Home
            </Link>{" "}
            first, then come back.
          </p>
        </header>
      </div>
    </div>
  );
}
