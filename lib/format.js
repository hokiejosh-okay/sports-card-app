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

  // ---- Phase 3: derived value metrics (pure functions; testable by eye) ------

  // Coerce a Firestore Timestamp | Date | number | string to epoch ms (or null).
  function toMs(v) {
    if (v == null) return null;
    if (typeof v === "number") return v;
    if (v.toMillis) return v.toMillis();
    if (v.seconds != null) return v.seconds * 1000;
    const d = v instanceof Date ? v : new Date(v);
    return isNaN(d) ? null : d.getTime();
  }

  function isNum(v) {
    return v != null && v !== "" && !isNaN(Number(v));
  }

  function qtyOf(c) {
    return c.quantity || 1;
  }

  function paidOf(c) {
    return c.acquisition && c.acquisition.pricePaid;
  }

  // Cost basis = Σ (pricePaid × quantity) over cards with a numeric pricePaid.
  function costBasis(cards) {
    let sum = 0;
    (cards || []).forEach((c) => {
      const paid = paidOf(c);
      if (isNum(paid)) sum += Number(paid) * qtyOf(c);
    });
    return sum;
  }

  // Unrealized gain = Σ ((estimatedValue − pricePaid) × quantity) over cards that
  // have BOTH a numeric value AND a numeric paid price. Returns the gain plus the
  // matched/total counts so the UI can label that it excludes cards missing
  // either number.
  function unrealizedGain(cards) {
    let gain = 0;
    let matched = 0;
    (cards || []).forEach((c) => {
      const val = c.estimatedValue;
      const paid = paidOf(c);
      if (isNum(val) && isNum(paid)) {
        gain += (Number(val) - Number(paid)) * qtyOf(c);
        matched += 1;
      }
    });
    return { gain, matched, count: (cards || []).length };
  }

  // Per-card gain = (estimatedValue − pricePaid) × quantity, but ONLY when the
  // card has BOTH a numeric value and a numeric paid price. Returns null when
  // either number is missing, so callers (e.g. the Collection "Gain vs. paid"
  // sort) can push unmatched cards to the end regardless of sort direction.
  function cardGain(card) {
    if (!card) return null;
    const val = card.estimatedValue;
    const paid = paidOf(card);
    if (!isNum(val) || !isNum(paid)) return null;
    return (Number(val) - Number(paid)) * qtyOf(card);
  }

  // Best mover = the single card with the largest (estimatedValue − pricePaid) ×
  // quantity among cards with both numbers. Returns { card, gain } or null.
  function bestMover(cards) {
    let best = null;
    (cards || []).forEach((c) => {
      const val = c.estimatedValue;
      const paid = paidOf(c);
      if (isNum(val) && isNum(paid)) {
        const g = (Number(val) - Number(paid)) * qtyOf(c);
        if (best === null || g > best.gain) best = { card: c, gain: g };
      }
    });
    return best;
  }

  // Value by sport = Σ (estimatedValue × quantity) per sport, in the controlled
  // order, only for sports present in the collection with a positive total.
  function sportBreakdown(cards) {
    const bySport = {};
    (cards || []).forEach((c) => {
      if (!c.sport || !isNum(c.estimatedValue)) return;
      bySport[c.sport] = (bySport[c.sport] || 0) + Number(c.estimatedValue) * qtyOf(c);
    });
    const order = (CV.lists && CV.lists.sports) || [];
    return order
      .filter((s) => bySport[s.value] > 0)
      .map((s) => ({ sport: s.value, label: CV.lists.sportLabel(s.value), value: bySport[s.value] }));
  }

  // ---- AI accuracy (PRD §7) --------------------------------------------------
  // Per-field match rate of Claude's original suggestion (card.aiSuggested, the
  // untouched vision output) vs. the value actually saved on the card, over the
  // cards that have an aiSuggested. Pure/in-memory — no writes, no reads. The
  // caller notes that normalized fields (sport, brand) can differ from the raw
  // suggestion even when the read was right.
  const AI_ACC_FIELDS = [
    "player", "year", "brand", "set", "subset",
    "cardNumber", "parallel", "serialNumber", "sport", "graded",
  ];

  function aiAccNorm(key, v) {
    if (key === "graded") return v ? "true" : "false";
    if (key === "year") {
      if (v == null || v === "") return "";
      const n = Number(v);
      return isNaN(n) ? "" : String(n);
    }
    if (v == null) return "";
    return String(v).trim().toLowerCase();
  }

  function aiAccuracy(cards) {
    const analyzed = (cards || []).filter((c) => c && c.aiSuggested != null);
    const fields = AI_ACC_FIELDS.map((key) => {
      let match = 0;
      analyzed.forEach((c) => {
        if (aiAccNorm(key, c.aiSuggested[key]) === aiAccNorm(key, c[key])) match += 1;
      });
      const total = analyzed.length;
      return { key: key, match: match, total: total, rate: total ? match / total : 0 };
    });
    return { analyzed: analyzed.length, fields: fields };
  }

  // The latest snapshot value at or before asOfMs (history is [{date, value}]).
  function snapshotValueAsOf(history, asOfMs) {
    let val = null;
    (history || []).forEach((s) => {
      const d = toMs(s.date);
      if (d != null && d <= asOfMs && isNum(s.value)) val = Number(s.value);
    });
    return val;
  }

  // Collection value as of a moment: Σ over cards that existed by then
  // (createdAt ≤ asOf) of their latest snapshot ≤ asOf × quantity. Returns null
  // when no card contributes — i.e. there's no history to anchor a prior value.
  function collectionTotalAsOf(cards, histories, asOfMs) {
    let sum = 0;
    let any = false;
    (cards || []).forEach((c) => {
      const created = toMs(c.createdAt);
      if (created != null && created > asOfMs) return; // card didn't exist yet
      const v = snapshotValueAsOf(histories && histories[c.id], asOfMs);
      if (v == null) return;
      sum += v * qtyOf(c);
      any = true;
    });
    return any ? sum : null;
  }

  // Header delta: current total − total as of `days` ago. hasPrior is false when
  // there isn't enough history to anchor a meaningful prior value (hide the chip).
  function collectionDelta(cards, histories, days) {
    const current = collectionTotals(cards || []).total;
    const asOf = Date.now() - (days || 30) * 24 * 60 * 60 * 1000;
    const prior = collectionTotalAsOf(cards, histories, asOf);
    if (prior == null) return { hasPrior: false, current: current, prior: 0, delta: 0 };
    return { hasPrior: true, current: current, prior: prior, delta: current - prior };
  }

  // ~monthly points across the trailing `months` window (default 6), ending now.
  // Each point value = collection total as of that point (0 when nothing existed
  // yet). `enough` reports whether there's enough history to draw a line at all.
  function collectionValueSeries(cards, histories, months) {
    months = months || 6;
    const now = new Date();
    const points = [];
    for (let k = months; k >= 1; k--) {
      // Last instant of the month k months before now.
      const d = new Date(now.getFullYear(), now.getMonth() - k + 1, 0, 23, 59, 59, 999);
      const ms = d.getTime();
      const total = collectionTotalAsOf(cards, histories, ms);
      points.push({
        date: ms,
        label: d.toLocaleDateString("en-US", { month: "short" }),
        value: total == null ? 0 : total,
        has: total != null,
      });
    }
    const nowMs = Date.now();
    const totalNow = collectionTotalAsOf(cards, histories, nowMs);
    points.push({ date: nowMs, label: "Now", value: totalNow == null ? 0 : totalNow, has: totalNow != null });

    let snapCount = 0;
    Object.keys(histories || {}).forEach((id) => {
      snapCount += ((histories[id]) || []).length;
    });
    const withValue = points.filter((p) => p.has && p.value > 0).length;
    const enough = snapCount >= 2 && withValue >= 2;
    return { points: points, enough: enough };
  }

  return {
    money, money2, setLine, titleLine, gradeTag, date, dateInputValue, collectionTotals,
    // Phase 3 derived values
    costBasis, unrealizedGain, cardGain, bestMover, sportBreakdown, aiAccuracy,
    snapshotValueAsOf, collectionTotalAsOf, collectionDelta, collectionValueSeries,
  };
})();
