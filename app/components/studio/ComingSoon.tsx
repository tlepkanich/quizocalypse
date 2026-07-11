import { QzPage, QzPageHeader, QzCard } from "../qz";

// Placeholder for sidebar destinations that get their real screens in later QD
// phases (Products → QD-5, the rest → QD-8). Keeps the nav 404-free meanwhile.
export function ComingSoon({ title, blurb }: { title: string; blurb?: string }) {
  return (
    <QzPage>
      <QzPageHeader title={title} />
      <QzCard dashed style={{ textAlign: "center", padding: "56px 28px" }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Coming soon</div>
        <p className="qz-muted" style={{ margin: "0 auto", maxWidth: "44ch", fontSize: 14 }}>
          {blurb ?? `The ${title} screen is being built in this milestone.`}
        </p>
      </QzCard>
    </QzPage>
  );
}
