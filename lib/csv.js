// lib/csv.js — Phase 3 CSV export (no library). Namespaced under CV.csv.
// Builds one row per card for the WHOLE collection (ignores the active Collection
// filters), a header row, each of the five flags as its own column, and both
// photo URLs. The aiSuggested / aiConfidence provenance blobs are omitted on
// purpose (spec §5). Download is triggered client-side via a Blob + object URL.
window.CV = window.CV || {};

CV.csv = (function () {
  function bool(v) {
    return v ? "Yes" : "No";
  }

  // Firestore Timestamp | Date | number | string → "YYYY-MM-DD" (blank when none).
  function dateStr(ts) {
    if (!ts) return "";
    let d = ts;
    if (ts.toDate) d = ts.toDate();
    else if (ts.seconds != null) d = new Date(ts.seconds * 1000);
    else if (typeof ts === "number" || typeof ts === "string") d = new Date(ts);
    if (!(d instanceof Date) || isNaN(d)) return "";
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + mm + "-" + dd;
  }

  // [header, accessor] pairs — the column order of the export.
  const COLUMNS = [
    ["id", (c) => c.id],
    ["player", (c) => c.player],
    ["additionalPlayers", (c) => (c.additionalPlayers || []).join("; ")],
    ["sport", (c) => CV.lists.sportLabel(c.sport)],
    ["team", (c) => c.team],
    ["year", (c) => c.year],
    ["brand", (c) => c.brand],
    ["set", (c) => c.set],
    ["subset", (c) => c.subset],
    ["cardNumber", (c) => c.cardNumber],
    ["parallel", (c) => c.parallel],
    ["serialNumber", (c) => c.serialNumber],
    ["rookie", (c) => bool(c.flags && c.flags.rookie)],
    ["auto", (c) => bool(c.flags && c.flags.auto)],
    ["relic", (c) => bool(c.flags && c.flags.relic)],
    ["patch", (c) => bool(c.flags && c.flags.patch)],
    ["shortPrint", (c) => bool(c.flags && c.flags.shortPrint)],
    ["graded", (c) => bool(c.graded)],
    ["gradingCompany", (c) => c.grading && c.grading.company],
    ["grade", (c) => c.grading && c.grading.grade],
    ["gradeLabel", (c) => c.grading && c.grading.gradeLabel],
    ["certNumber", (c) => c.grading && c.grading.certNumber],
    ["condition", (c) => c.condition],
    ["quantity", (c) => (c.quantity == null ? 1 : c.quantity)],
    ["estimatedValue", (c) => c.estimatedValue],
    ["valueSource", (c) => c.valueSource],
    ["valueUpdatedAt", (c) => dateStr(c.valueUpdatedAt)],
    ["pricePaid", (c) => c.acquisition && c.acquisition.pricePaid],
    ["acquiredDate", (c) => dateStr(c.acquisition && c.acquisition.date)],
    ["acquiredSource", (c) => c.acquisition && c.acquisition.source],
    ["notes", (c) => c.notes],
    ["compsUrl", (c) => c.compsUrl],
    ["frontPhotoUrl", (c) => c.photos && c.photos.front && c.photos.front.url],
    ["backPhotoUrl", (c) => c.photos && c.photos.back && c.photos.back.url],
    ["createdAt", (c) => dateStr(c.createdAt)],
    ["updatedAt", (c) => dateStr(c.updatedAt)],
  ];

  // RFC-4180-ish escaping: quote when the value has a comma, quote, newline, or
  // leading/trailing whitespace; double any embedded quotes.
  function cell(v) {
    if (v == null) return "";
    let s = String(v);
    if (/[",\n\r]/.test(s) || s !== s.trim()) {
      s = '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  // Pure builder — one header row + one row per card. CRLF line endings (Excel).
  function build(cards) {
    const header = COLUMNS.map((col) => col[0]).join(",");
    const rows = (cards || []).map((c) => COLUMNS.map((col) => cell(col[1](c))).join(","));
    return [header].concat(rows).join("\r\n");
  }

  function filename() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return "cardvault-collection-" + d.getFullYear() + "-" + mm + "-" + dd + ".csv";
  }

  // Build the CSV and trigger a download. A ﻿ BOM makes Excel read UTF-8.
  function exportCollection(cards) {
    const csv = "﻿" + build(cards);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return { build: build, exportCollection: exportCollection, filename: filename };
})();
