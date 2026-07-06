// §4 per-quiz question image. position none → hidden; top (default) → today's
// full-width image above the question (BYTE-IDENTICAL to the prior inline render);
// side → desktop float-right (content wraps left; the answer grid clears below),
// mobile falls back to the top layout via the breakpoint CSS classes.
export function QuestionImage({
  url,
  position,
}: {
  url?: string;
  position?: "none" | "top" | "side";
}) {
  if (!url || position === "none") return null;
  if (position === "side") {
    return <img src={url} alt="" className="qz-q-img-side" />;
  }
  return (
    <img
      src={url}
      alt=""
      style={{
        width: "100%",
        maxHeight: 280,
        objectFit: "cover",
        borderRadius: "var(--qz-radius)",
        marginBottom: 16,
        display: "block",
      }}
    />
  );
}
