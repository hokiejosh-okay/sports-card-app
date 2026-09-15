// components/Badges.js — the badge row shown on card detail (spec §3).
window.CV = window.CV || {};

CV.BadgeRow = function BadgeRow(props) {
  const card = props.card;
  const badges = [];

  if (card.flags) {
    if (card.flags.rookie) badges.push({ t: "RC", cls: "badge badge-rc" });
    if (card.flags.auto) badges.push({ t: "Auto", cls: "badge" });
    if (card.flags.relic) badges.push({ t: "Relic", cls: "badge" });
    if (card.flags.patch) badges.push({ t: "Patch", cls: "badge" });
    if (card.flags.shortPrint) badges.push({ t: "SP", cls: "badge" });
  }
  if (card.parallel && card.parallel !== "Base") badges.push({ t: card.parallel, cls: "badge badge-parallel" });
  if (card.serialNumber) badges.push({ t: "/" + serialDen(card.serialNumber), cls: "badge badge-serial" });

  if (card.graded && card.grading && card.grading.company) {
    const label = card.grading.gradeLabel ? " · " + card.grading.gradeLabel : "";
    badges.push({
      t: card.grading.company + " " + (card.grading.grade != null ? card.grading.grade : "") + label,
      cls: "badge badge-grade",
    });
  } else {
    badges.push({ t: "Raw · ungraded", cls: "badge badge-raw" });
  }

  return (
    <div className="badge-row">
      {badges.map((b, i) => (
        <span key={i} className={b.cls}>{b.t}</span>
      ))}
    </div>
  );
};

// "12/99" → "99"; "99" → "99"
function serialDen(s) {
  if (!s) return "";
  const parts = String(s).split("/");
  return parts.length > 1 ? parts[1].trim() : String(s).trim();
}
CV.serialDen = serialDen;
