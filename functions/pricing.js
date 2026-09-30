// functions/pricing.js — Phase 4 auto price lookup: the PURE half (no Firebase,
// no network), so it can be exercised by a plain node script.
//   • buildQuery   — The Card API search text, mirroring the simplified eBay
//                    search in lib/comps.js (year, brand, player, RC/Auto/Jersey,
//                    grade term). Negative words are NOT sent; the title matcher
//                    below drops lots/reprints/digital/breaks instead.
//   • matchTitle   — decides whether a returned sale's title is the same card.
//   • gradeKeyOf / parseSale / median / computeApiValue / computeGradedValues /
//     decideValueWrite — sale normalization, the median math and the ownership
//     rule (who may write estimatedValue).
// The Firestore + HTTP orchestration lives in functions/refresh.js.

import { createHash } from "node:crypto";

// ---- Tunable thresholds -----------------------------------------------------
export const API_BASE = "https://thecardapi.com/api/v1/market/sales";
export const PER_QUERY_LIMIT = 10; // sales rows asked for per query (each returned row counts against the free tier)
export const API_LOOKBACK_DAYS = 3; // free-tier lookback, sent as date_from
export const FREE_TIER_DAILY_SALES = 5000; // rows returned per UTC day on the free tier
export const DAILY_SALES_BUDGET = 4000; // nightly job stops here, leaving headroom for on-demand refreshes
export const ON_DEMAND_SALES_CAP = 4900; // on-demand refreshes may use the headroom up to here (100-row safety margin)
export const SALES_WINDOW_DAYS = 90; // stored sales older than this are pruned
export const MEDIAN_MAX_SALES = 10; // median of the most recent N matched sales
export const MIN_SALES_AUTOFILL = 2; // a card with no value is auto-filled only at this sample size
export const MIN_SALES_GRADED = 1; // a graded preview value needs at least this many sales
export const REFRESH_COOLDOWN_MS = 10 * 60 * 1000; // per-card on-demand cooldown
export const GRADED_PREVIEW_INTERVAL_DAYS = 7; // graded previews refresh weekly per card (nightly job)
export const GRADED_PREVIEW_GRADES = ["PSA 10", "PSA 9", "BGS 9.5", "SGC 10"]; // same set as lib/comps.js
export const NIGHTLY_POOL = 3; // concurrent card lookups in the nightly run
export const NIGHTLY_SOFT_DEADLINE_MS = 480 * 1000; // stop starting new cards before the 540 s timeout

// Query words for the card's attribute flags (tunable; the eBay link uses the
// long forms Rookie/Autograph/Jersey — sellers mostly write RC/Auto/Jersey).
const QUERY_FLAG_WORDS = { rookie: "RC", autograph: "Auto", jersey: "Jersey" };

// Titles containing any of these are never the single card we're pricing.
const EXCLUDE_WORDS = [
  "lot", "lots", "reprint", "reprints", "digital", "break", "breaks",
  "you pick", "u pick", "pick your", "team set", "complete set",
];

// Grading companies. TAG only counts when followed by a grade ("Tag Team" is a
// wrestling phrase), so it's handled in the grade regex, not here.
const SLAB_WORDS = ["psa", "bgs", "bvg", "beckett", "sgc", "cgc", "csg", "hga", "ksa", "gma", "graded", "slab", "slabbed"];

// Parallel / variant words. A Base card's title must contain none of these once
// the card's own player, team, brand, set and subset text is removed. Superset
// of CV.lists.parallels (minus "Base") plus common hobby terms.
const PARALLEL_WORDS = [
  "refractor", "x-fractor", "xfractor", "superfractor", "silver", "holo", "chrome", "gold",
  "orange", "red", "blue", "green", "purple", "pink", "black", "sepia", "mojo", "wave",
  "disco", "cracked ice", "shimmer", "atomic", "parallel", "rainbow", "foil", "sparkle",
  "speckle", "camo", "tie-dye", "tie dye", "neon", "pulsar", "hyper", "scope", "shock",
  "lazer", "laser", "velocity", "prism", "lava", "ssp", "short print", "variation",
];

// Team names / award inserts that contain parallel or memorabilia words; removed
// from the title before the parallel and memorabilia checks.
const SAFE_PHRASES = [
  "red sox", "white sox", "red wings", "red bulls", "red stars", "blue jays", "blue jackets",
  "green bay", "new jersey", "golden state", "gold glove", "silver slugger", "black hawks",
];

const AUTO_WORDS = ["auto", "autos", "autograph", "autographed", "autographs", "signed", "signature", "on card auto"];
const MEM_WORDS = [
  "jersey", "patch", "relic", "swatch", "memorabilia", "game used", "game-used", "game worn",
  "player worn", "materials", "rpa", "bat", "fabric",
];

const NAME_SUFFIXES = ["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"];

// ---- Text helpers -------------------------------------------------------------
// Lower-case, strip accents, keep letters/digits and the few symbols that carry
// meaning in card titles (# / . -), collapse whitespace.
export function normText(s) {
  return String(s == null ? "" : s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9#/.\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Pattern for a phrase: spaces and hyphens inside it are interchangeable/optional.
function phrasePattern(phrase) {
  return normText(phrase)
    .split(/[\s-]+/)
    .filter(Boolean)
    .map(esc)
    .join("[\\s-]?");
}

// Whole-word (whole-phrase) test on an already-normalized title.
export function hasWord(t, phrase) {
  const p = phrasePattern(phrase);
  if (!p) return false;
  return new RegExp("(^|[^a-z0-9])" + p + "(?=$|[^a-z0-9])").test(t);
}

function removePhrase(t, phrase) {
  const p = phrasePattern(phrase);
  if (!p) return t;
  return t.replace(new RegExp("(^|[^a-z0-9])" + p + "(?=$|[^a-z0-9])", "g"), "$1 ");
}

// Server copy of CV.normalizeFlags (data/lists.js): old or new flag map → the
// five-key shape. Keep in step with the client.
export function normalizeFlags(flags) {
  const f = flags || {};
  const isNew = "autograph" in f || "limited" in f || "jersey" in f;
  const pick = (v, fallback) => (v != null ? !!v : !!fallback);
  return {
    rookie: !!f.rookie,
    autograph: pick(f.autograph, f.auto),
    limited: pick(f.limited, f.shortPrint),
    jersey: pick(f.jersey, isNew ? f.patch : f.relic || f.patch),
    relic: isNew ? !!f.relic : false,
  };
}

// ---- Grades -------------------------------------------------------------------
const COMPANY_CANON = { psa: "PSA", bgs: "BGS", bvg: "BGS", beckett: "BGS", sgc: "SGC", cgc: "CGC", csg: "CSG", hga: "HGA", tag: "TAG", ksa: "KSA", gma: "GMA" };
const GRADE_RE = new RegExp(
  "(?:^|[^a-z0-9])(psa|bgs|bvg|beckett|sgc|cgc|csg|hga|tag|ksa|gma)" +
    "(?:[\\s\\-:/]*(?:gem|mint|mt|nm|nm-mt|pristine|black|gold|label|dna|auto|graded|slab)\\.?)*" +
    "[\\s\\-:#]*(10|[1-9](?:\\.5)?)(?![0-9.])"
);

function fmtGrade(g) {
  const n = Number(g);
  if (!isFinite(n)) return String(g);
  return String(Math.round(n * 2) / 2);
}

// The card's own grade key: "raw", or "PSA 10" / "BGS 9.5" … for a slab.
export function cardGradeKey(card) {
  const g = (card && card.grading) || {};
  if (card && card.graded) {
    if (g.company && g.grade != null && g.grade !== "") return g.company + " " + fmtGrade(g.grade);
    return "graded";
  }
  return "raw";
}

// The grade term used in the query (same as lib/comps.js gradeTermOf), or null.
function gradeTermOf(card) {
  const k = cardGradeKey(card);
  return k === "raw" || k === "graded" ? null : k;
}

// A sale title's grade key: "PSA 10" etc. when a company + grade is readable,
// "graded" when it looks slabbed but the grade isn't, else "raw".
export function gradeKeyOf(title) {
  const t = normText(title);
  const m = t.match(GRADE_RE);
  if (m) return COMPANY_CANON[m[1]] + " " + fmtGrade(m[2]);
  if (SLAB_WORDS.some((w) => hasWord(t, w))) return "graded";
  return "raw";
}

// ---- Serials --------------------------------------------------------------------
// Denominators of every "/NN"-style serial in a title ("12/99", "/25", "1/1",
// "#'d to 50"). Season years like "2023/24" are ignored.
export function serialDenoms(title) {
  const t = normText(title);
  const out = [];
  const re = /(?<![0-9])(\d{1,4})?\s?\/\s?(\d{1,4})(?![0-9])/g;
  let m;
  while ((m = re.exec(t))) {
    if (m[1] && m[1].length === 4 && /^(19|20)/.test(m[1])) continue; // 2023/24 season
    out.push(Number(m[2]));
  }
  const re2 = /(?:#\s?d|numbered|serial numbered)\s*(?:to\s*)?(\d{1,4})(?![0-9])/g;
  while ((m = re2.exec(t))) out.push(Number(m[1]));
  return out;
}

export function cardSerialDenom(card) {
  const m = String((card && card.serialNumber) || "").match(/\/\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

// ---- Query builder --------------------------------------------------------------
// year brand(unless "Other") player [RC] [Auto] [Jersey] [grade term].
export function buildQuery(card, gradeTerm) {
  card = card || {};
  const flags = normalizeFlags(card.flags);
  const bits = [];
  if (card.year) bits.push(String(card.year));
  if (card.brand && card.brand !== "Other") bits.push(card.brand);
  if (card.player) bits.push(String(card.player).trim());
  if (flags.rookie) bits.push(QUERY_FLAG_WORDS.rookie);
  if (flags.autograph) bits.push(QUERY_FLAG_WORDS.autograph);
  if (flags.jersey) bits.push(QUERY_FLAG_WORDS.jersey);
  const g = gradeTerm === undefined ? gradeTermOf(card) : gradeTerm;
  if (g) bits.push(g);
  return bits.join(" ").replace(/\s+/g, " ").trim();
}

// ---- Title matcher --------------------------------------------------------------
function surnameOf(player) {
  const toks = normText(player).split(" ").filter((w) => w && NAME_SUFFIXES.indexOf(w) === -1);
  const last = toks.length ? toks[toks.length - 1] : "";
  return last.replace(/\.+$/, "");
}

function cardNumberPattern(num) {
  const segs = normText(String(num).replace(/^#/, "")).split(/[^a-z0-9]+/).filter(Boolean);
  if (!segs.length) return null;
  return new RegExp("(?<![a-z0-9/])#?\\s?" + segs.map(esc).join("[\\s-]?") + "(?![a-z0-9/])");
}

// Is this sale title the same card (at targetGradeKey — the card's own grade
// for its value, or a preview grade like "PSA 10")? Returns { ok, reason }.
export function matchTitle(card, title, targetGradeKey) {
  card = card || {};
  const t = normText(title);
  const target = targetGradeKey || cardGradeKey(card);
  const flags = normalizeFlags(card.flags);
  if (!t) return { ok: false, reason: "empty title" };

  for (const w of EXCLUDE_WORDS) if (hasWord(t, w)) return { ok: false, reason: "excluded: " + w };

  const sur = surnameOf(card.player);
  if (!sur || !hasWord(t, sur)) return { ok: false, reason: "no surname" };
  if (card.year && !hasWord(t, String(card.year))) return { ok: false, reason: "no year" };

  if (card.cardNumber) {
    const re = cardNumberPattern(card.cardNumber);
    if (re && !re.test(t)) return { ok: false, reason: "no card #" };
  }

  // Grade: raw target drops anything slabbed; graded target needs the exact grade.
  const gk = gradeKeyOf(title);
  if (target === "raw") {
    if (gk !== "raw") return { ok: false, reason: "slabbed" };
  } else if (gk !== target) {
    return { ok: false, reason: "grade " + gk + " ≠ " + target };
  }

  // The card's own words (player, team, brand, set, subset) and known team
  // phrases are removed before the parallel / memorabilia checks, so "Jalen
  // Green", "Red Sox", "Topps Chrome" or "New Jersey" don't trip them.
  let rest = t;
  const own = [card.player, card.team, card.brand, card.set, card.subset]
    .concat(card.additionalPlayers || [])
    .concat(SAFE_PHRASES)
    .filter(Boolean)
    .sort((a, b) => String(b).length - String(a).length);
  own.forEach((p) => { rest = removePhrase(rest, p); });

  // Parallel must agree.
  const parallel = normText(card.parallel || "Base");
  if (!parallel || parallel === "base") {
    const hit = PARALLEL_WORDS.find((w) => hasWord(rest, w));
    if (hit) return { ok: false, reason: "parallel word: " + hit };
  } else {
    const toks = parallel.split(/\s+/).filter(Boolean);
    const miss = toks.find((w) => !hasWord(t, w));
    if (miss) return { ok: false, reason: "parallel missing: " + miss };
  }

  // Serial must agree: a numbered card needs its denominator; an unnumbered,
  // non-limited card rejects any serial. A limited card with no known serial
  // (an unnumbered SP) isn't filtered on serial.
  const denoms = serialDenoms(title);
  const cardDen = cardSerialDenom(card);
  if (cardDen != null) {
    if (denoms.indexOf(cardDen) === -1) return { ok: false, reason: "serial ≠ /" + cardDen };
  } else if (!flags.limited && denoms.length) {
    return { ok: false, reason: "numbered /" + denoms[0] };
  }

  // Autograph and memorabilia must agree both ways (an auto sells for many
  // times the base card; the query alone can't keep them apart).
  // Presence is checked on the full title (the word may be part of the card's
  // own subset, e.g. "Rookie Autographs"); absence on the stripped title.
  const anyIn = (s, words) => words.some((w) => hasWord(s, w));
  if (flags.autograph && !anyIn(t, AUTO_WORDS)) return { ok: false, reason: "not an auto" };
  if (!flags.autograph && anyIn(rest, AUTO_WORDS)) return { ok: false, reason: "auto" };
  const wantMem = flags.jersey || flags.relic;
  if (wantMem && !anyIn(t, MEM_WORDS)) return { ok: false, reason: "no memorabilia" };
  if (!wantMem && anyIn(rest, MEM_WORDS)) return { ok: false, reason: "memorabilia" };

  return { ok: true, reason: "" };
}

// ---- Sales ------------------------------------------------------------------------
function parsePrice(v) {
  if (typeof v === "number") return v;
  const n = Number(String(v == null ? "" : v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : NaN;
}

function parseDateMs(v) {
  if (v == null || v === "") return NaN;
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  const s = String(v);
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + "T12:00:00Z" : s);
  return d.getTime();
}

// Firestore-safe doc id: the API sale id when usable, else a stable hash.
export function saleDocId(raw) {
  const id = raw && raw.id != null ? String(raw.id) : "";
  if (id && id.length <= 200 && !/[/]/.test(id) && id !== "." && id !== ".." && !/^__.*__$/.test(id)) return id;
  const basis = [raw && raw.title, raw && raw.sale_price, raw && raw.sale_date, raw && raw.listing_url].join("|");
  return "h_" + createHash("sha1").update(basis).digest("hex").slice(0, 32);
}

// One API row → the stored shape (dateMs is converted to a Timestamp on write).
// Returns null for rows without a usable price or date.
export function parseSale(raw) {
  if (!raw) return null;
  const price = parsePrice(raw.sale_price != null ? raw.sale_price : raw.price);
  const dateMs = parseDateMs(raw.sale_date != null ? raw.sale_date : raw.date);
  if (!isFinite(price) || price <= 0 || !isFinite(dateMs)) return null;
  const title = String(raw.title || "");
  return {
    id: saleDocId(raw),
    price: Math.round(price * 100) / 100,
    dateMs: dateMs,
    platform: raw.platform != null ? String(raw.platform) : null,
    listingType: raw.listing_type != null ? String(raw.listing_type) : null,
    url: raw.listing_url != null ? String(raw.listing_url) : null,
    title: title,
    gradeKey: gradeKeyOf(title),
  };
}

// ---- Median math --------------------------------------------------------------------
export function median(nums) {
  const a = nums.filter((n) => isFinite(n)).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  const v = a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  return Math.round(v * 100) / 100;
}

// Value for one grade key from stored sales [{ price, dateMs, gradeKey }]:
// median of the most recent MEDIAN_MAX_SALES inside the window.
export function computeApiValue(sales, gradeKey, nowMs) {
  const since = nowMs - SALES_WINDOW_DAYS * 86400000;
  const used = (sales || [])
    .filter((s) => s.gradeKey === gradeKey && s.dateMs >= since && isFinite(s.price))
    .sort((a, b) => b.dateMs - a.dateMs)
    .slice(0, MEDIAN_MAX_SALES);
  if (!used.length) {
    return { value: null, meta: { sampleSize: 0, low: null, high: null, lastSaleAt: null, windowDays: SALES_WINDOW_DAYS } };
  }
  const prices = used.map((s) => s.price);
  const oldest = used[used.length - 1].dateMs;
  return {
    value: median(prices),
    meta: {
      sampleSize: used.length,
      low: Math.min.apply(null, prices),
      high: Math.max.apply(null, prices),
      lastSaleAt: used[0].dateMs,
      // days spanned by the sales used (1..SALES_WINDOW_DAYS)
      windowDays: Math.min(SALES_WINDOW_DAYS, Math.max(1, Math.ceil((nowMs - oldest) / 86400000))),
    },
  };
}

// { "PSA 10": n, … } for the preview grades that have enough stored sales.
export function computeGradedValues(sales, nowMs) {
  const out = {};
  GRADED_PREVIEW_GRADES.forEach((g) => {
    const r = computeApiValue(sales, g, nowMs);
    if (r.value != null && r.meta.sampleSize >= MIN_SALES_GRADED) out[g] = r.value;
  });
  return out;
}

// Ownership rule. "manual" is never touched. An unvalued card is auto-filled at
// MIN_SALES_AUTOFILL; an "api"-owned card follows the market whenever there is
// a market value. No write when the value wouldn't change (keeps history clean).
export function decideValueWrite(card, apiValue, sampleSize) {
  card = card || {};
  if (card.valueSource === "manual") return { write: false, reason: "manual" };
  if (apiValue == null) return { write: false, reason: "no market value" };
  const cur = card.estimatedValue;
  const unvalued = cur == null || cur === "" || isNaN(Number(cur));
  if (card.valueSource === "api") {
    if (!unvalued && Number(cur) === apiValue) return { write: false, reason: "unchanged" };
    return { write: true, reason: "api-owned" };
  }
  if (unvalued && sampleSize >= MIN_SALES_AUTOFILL) return { write: true, reason: "autofill" };
  return { write: false, reason: unvalued ? "sample too small" : "valued, not api-owned" };
}

// "YYYY-MM-DD" for the UTC day (the free tier's quota resets at 00:00 UTC).
export function utcDay(ms) {
  return new Date(ms == null ? Date.now() : ms).toISOString().slice(0, 10);
}
