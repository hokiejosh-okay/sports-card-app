// lib/format.js — display + model helpers shared across screens.
window.CV = window.CV || {};

CV.fmt = (function () {
  function money(n) {
    if (n === null || n === undefined || n === "" || isNaN(Number(n))) return "—";
    return "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
  }

  function money2(n) {
    if (n === null || n === undefined || n === "" || isNaN(Number(n))) return "—";
    return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // "2023 Topps Chrome · Silver Prizm" style secondary line.
  function setLine(card) {
    const bits = [];
    if (card.year) bits.push(String(card.year));
    const bs = [card.brand, card.set].filter(Boolean).join(" ").trim();
    if (bs) bits.push(bs);
    let line = bits.join(" ");
    if (card.parallel && card.parallel !== "Base") line += " · " + card.parallel;
    return line.trim();
  }

  // "2023 · Topps Chrome · #150" title line for detail.
  function titleLine(card) {
    const bits = [];
    if (card.year) bits.push(String(card.year));
    const bs = [card.brand, card.set].filter(Boolean).join(" ").trim();
    if (bs) bits.push(bs);
    if (card.cardNumber) bits.push("#" + card.cardNumber);
    return bits.join(" · ");
  }

  function gradeTag(card) {
    if (card.graded && card.grading && card.grading.company) {
      const g = card.grading.grade != null ? " " + card.grading.grade : "";
      return card.grading.company + g;
    }
    return "Raw";
  }

  // Firestore Timestamp | Date | null → "Sep 15, 2026"
  function date(ts) {
    if (!ts) return "—";
    let d = ts;
    if (ts.toDate) d = ts.toDate();
    else if (typeof ts === "number") d = new Date(ts);
    else if (typeof ts === "string") d = new Date(ts);
    if (!(d instanceof Date) || isNaN(d)) return "—";
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  }

  // <input type="date"> value ("YYYY-MM-DD") from a Firestore Timestamp/Date.
  function dateInputValue(ts) {
    if (!ts) return "";
    let d = ts;
    if (ts.toDate) d = ts.toDate();
    else if (typeof ts === "number" || typeof ts === "string") d = new Date(ts);
    if (!(d instanceof Date) || isNaN(d)) return "";
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mm}-${dd}`;
  }

  // Collection total = sum of estimatedValue × quantity over valued cards.
  function collectionTotals(cards) {
    let total = 0;
    let valued = 0;
    cards.forEach((c) => {
      const q = c.quantity || 1;
      if (c.estimatedValue != null && !isNaN(Number(c.estimatedValue))) {
        total += Number(c.estimatedValue) * q;
        valued += 1;
      }
    });
    return { total, valued, count: cards.length };
  }

  return { money, money2, setLine, titleLine, gradeTag, date, dateInputValue, collectionTotals };
})();
