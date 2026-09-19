// lib/comps.js — eBay sold-comps deep links (spec §8, §11 Phase 2).
//
// getComps builds a precise link to eBay's SOLD + COMPLETED listings search from
// a card's attributes. It runs in the browser on purpose: a search URL needs no
// API key or secret, so there is nothing to hide behind a Cloud Function, and the
// spec (§8) explicitly blesses building the URL client-side — "keeping it in a
// Function just means the query recipe can change without a frontend deploy."
// For a single-user app with no build step, the recipe living here is simplest.
//
// The owner taps through to the real recent sold prices (eBay requires being
// signed in, per the Aug-2026 login wall — a non-issue when tapping through),
// eyeballs the comps, and types the number back via "update value" — that write
// is valueSource "manual". A pricing API can overwrite it later (Phase 4, §8).
window.CV = window.CV || {};

CV.comps = (function () {
  const EBAY = "https://www.ebay.com/sch/i.html";
  // Negative keywords keep lots, reprints, digital cards and repack "breaks" out
  // of the sold results (spec §8).
  const NEG = ["-lot", "-reprint", "-digital", "-break"];
  // Standard "what's it worth graded" comparison grades (spec §8 graded-value row).
  const GRADE_SET = ["PSA 10", "PSA 9", "BGS 9.5", "SGC 10"];

  // "12/99" → "/99": the print-run denominator narrows the search to the right
  // numbered parallel without demanding the exact serial (each of which is unique).
  function serialDenominator(s) {
    if (!s) return null;
    const m = String(s).match(/\/\s*(\d+)/);
    return m ? "/" + m[1] : null;
  }

  // The grade term for a graded card, e.g. "PSA 9.5", or null when raw / unknown.
  function gradeTermOf(card) {
    const g = (card && card.grading) || {};
    if (card && card.graded && g.company && g.grade != null && g.grade !== "") {
      return g.company + " " + g.grade;
    }
    return null;
  }

  // Keyword string a collector would actually search by (spec §8):
  // year brand set player cardNumber + subset + parallel(non-Base) + /denominator
  // + grade (when present) + negative keywords.
  function keywords(card, gradeTerm) {
    card = card || {};
    const bits = [];
    if (card.year) bits.push(String(card.year));
    if (card.brand && card.brand !== "Other") bits.push(card.brand);
    if (card.set) bits.push(card.set);
    if (card.player) bits.push(card.player);
    if (card.cardNumber) bits.push(String(card.cardNumber));
    if (card.subset) bits.push(card.subset);
    if (card.parallel && card.parallel !== "Base") bits.push(card.parallel);
    const denom = serialDenominator(card.serialNumber);
    if (denom) bits.push(denom);
    if (gradeTerm) bits.push(gradeTerm);
    const terms = bits.filter(Boolean).concat(NEG);
    return terms.join(" ").replace(/\s+/g, " ").trim();
  }

  // Full eBay sold-listings URL. _sacat=212 = Sports Trading Cards; _sop=13 =
  // most recent first; LH_Sold + LH_Complete = sold/completed only (spec §8).
  function url(card, gradeTerm) {
    const params = new URLSearchParams({
      _nkw: keywords(card, gradeTerm),
      _sacat: "212",
      LH_Sold: "1",
      LH_Complete: "1",
      _sop: "13",
    });
    return EBAY + "?" + params.toString();
  }

  // The link that matches the card as it is now (graded → its slab grade; raw → raw).
  function primaryUrl(card) {
    return url(card, gradeTermOf(card));
  }

  // Graded-value comparison links (spec §8): the same sold search with each common
  // grade appended, so even a raw card shows what graded copies fetch. The card's
  // own grade leads the row when it isn't already one of the standard four.
  function gradedLinks(card) {
    const own = gradeTermOf(card);
    const terms = own && GRADE_SET.indexOf(own) === -1 ? [own].concat(GRADE_SET) : GRADE_SET.slice();
    return terms.map((term) => ({ label: term, url: url(card, term) }));
  }

  return { keywords, url, primaryUrl, gradeTermOf, gradedLinks, serialDenominator };
})();

// getComps(card): the Phase 2 comps bundle for one card.
//   { query, primaryUrl, gradedLinks: [{ label, url }] }
CV.getComps = function (card) {
  card = card || {};
  return {
    query: CV.comps.keywords(card, CV.comps.gradeTermOf(card)),
    primaryUrl: CV.comps.primaryUrl(card),
    gradedLinks: CV.comps.gradedLinks(card),
  };
};
