// functions/refresh.js — Phase 4 auto price lookup: Firestore + HTTP side.
// Pure matching / math lives in pricing.js; this file:
//   • calls The Card API (GET /api/v1/market/sales, header x-market-api-key),
//     reserving each query's rows against the daily budget first
//     (system/priceUsage, server-only, keyed by UTC day — the free tier's
//     5,000 sales/day resets at 00:00 UTC);
//   • stores matched sales in cards/{cardId}/sales/{saleId} (deduped by id,
//     pruned past SALES_WINDOW_DAYS) — accumulating these nightly is what gets
//     past the free tier's 3-day lookback;
//   • writes the api* fields and, under the ownership rule, estimatedValue +
//     valueSource "api" + a valueHistory snapshot atomically (the same pair of
//     writes CV.updateCardValue batches on the client). It runs as a
//     transaction so valueSource is re-read at commit: a manual value saved
//     mid-run is never overwritten.
// The API key only ever lives here (Secret Manager CARD_API_KEY).

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";

import * as P from "./pricing.js";

const USAGE_DOC = "system/priceUsage";

export class BudgetError extends Error {
  constructor(message) {
    super(message || "Daily price-lookup budget used up.");
    this.name = "BudgetError";
  }
}

export class CardApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "CardApiError";
    this.status = status || 0;
  }
}

function tsMs(v) {
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (v.seconds != null) return v.seconds * 1000;
  const d = new Date(v);
  return isNaN(d) ? 0 : d.getTime();
}

// ---- Daily budget (system/priceUsage) -----------------------------------------
// Reserve `n` rows before a query; settle with the real row count afterwards.
// A transaction keeps concurrent lookups (pool of 3, plus on-demand) honest.
async function reserveSales(db, n, cap) {
  const ref = db.doc(USAGE_DOC);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data() : {};
    const day = P.utcDay();
    const sameDay = d.day === day;
    const used = sameDay ? d.salesUsed || 0 : 0;
    if (used + n > cap) return { ok: false, day, used };
    tx.set(
      ref,
      {
        day,
        salesUsed: used + n,
        requests: (sameDay ? d.requests || 0 : 0) + 1,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { ok: true, day, used: used + n };
  });
}

async function settleSales(db, day, delta) {
  if (!delta) return;
  const ref = db.doc(USAGE_DOC);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().day !== day) return; // day rolled over; nothing to adjust
    tx.update(ref, { salesUsed: Math.max(0, (snap.data().salesUsed || 0) + delta) });
  });
}

// The provider said stop (429): treat today's quota as spent.
async function markExhausted(db, day) {
  await db.doc(USAGE_DOC).set({ day, salesUsed: P.FREE_TIER_DAILY_SALES, exhaustedAt: FieldValue.serverTimestamp() }, { merge: true });
}

// ---- The Card API -----------------------------------------------------------------
async function fetchSales(apiKey, q) {
  const url = new URL(P.API_BASE);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(P.PER_QUERY_LIMIT));
  url.searchParams.set("date_from", P.utcDay(Date.now() - P.API_LOOKBACK_DAYS * 86400000));
  let res;
  try {
    res = await fetch(url, {
      headers: { "x-market-api-key": apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    throw new CardApiError("Card API unreachable: " + ((e && e.message) || "network error"), 0);
  }
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.text()).slice(0, 200); } catch (e) {}
    throw new CardApiError("Card API " + res.status + (detail ? ": " + detail : ""), res.status);
  }
  const body = await res.json();
  // Documented shape is { data: [...], pagination: { next_cursor } }. We read one
  // page only (PER_QUERY_LIMIT rows); the cursor is deliberately not followed.
  const rows = Array.isArray(body) ? body : body.data || body.sales || body.results || [];
  return Array.isArray(rows) ? rows : [];
}

// One budgeted query → raw rows. Throws BudgetError before spending anything.
async function runQuery(db, apiKey, q, cap) {
  const r = await reserveSales(db, P.PER_QUERY_LIMIT, cap);
  if (!r.ok) throw new BudgetError();
  let rows;
  try {
    rows = await fetchSales(apiKey, q);
  } catch (e) {
    await settleSales(db, r.day, -P.PER_QUERY_LIMIT).catch(() => {});
    if (e && e.status === 429) await markExhausted(db, r.day).catch(() => {});
    throw e;
  }
  await settleSales(db, r.day, rows.length - P.PER_QUERY_LIMIT).catch(() => {});
  return rows;
}

// ---- One card -----------------------------------------------------------------------
// opts: { primary: bool, graded: bool, cap: number }
//   primary → the card's own query (raw, or its slab grade)
//   graded  → the four graded-preview queries (skipping one equal to primary)
// Returns a summary; throws BudgetError only when not even the first query fit.
export async function refreshCard(db, apiKey, cardId, opts) {
  opts = opts || {};
  const cardRef = db.doc(`cards/${cardId}`);
  const snap = await cardRef.get();
  if (!snap.exists) return { cardId, skipped: "missing" };
  const card = snap.data();
  const primaryKey = P.cardGradeKey(card);

  const queries = [];
  if (opts.primary !== false && primaryKey !== "graded") queries.push({ key: primaryKey, q: P.buildQuery(card) });
  if (opts.graded) {
    P.GRADED_PREVIEW_GRADES.forEach((g) => {
      if (g !== primaryKey) queries.push({ key: g, q: P.buildQuery(card, g) });
    });
  }

  const matched = new Map();
  let rowsReturned = 0;
  let ran = 0;
  let gradedComplete = !!opts.graded;
  for (const item of queries) {
    let rows;
    try {
      rows = await runQuery(db, apiKey, item.q, opts.cap);
    } catch (e) {
      if (ran === 0) throw e; // nothing done yet — let the caller decide
      if (item.key !== primaryKey) gradedComplete = false;
      if (e instanceof BudgetError || (e && e.status === 429)) break;
      logger.warn(`price query failed for ${cardId} (${item.key}): ${e && e.message}`);
      continue;
    }
    ran++;
    rowsReturned += rows.length;
    rows.forEach((raw) => {
      const s = P.parseSale(raw);
      if (s && s.gradeKey === item.key && P.matchTitle(card, s.title, item.key).ok) matched.set(s.id, s);
    });
  }

  // Store new matches (set() on the sale id = dedupe).
  const salesCol = cardRef.collection("sales");
  if (matched.size) {
    const batch = db.batch();
    matched.forEach((s) => {
      batch.set(salesCol.doc(s.id), {
        price: s.price,
        date: Timestamp.fromMillis(s.dateMs),
        platform: s.platform,
        listingType: s.listingType,
        url: s.url,
        title: s.title,
        gradeKey: s.gradeKey,
      });
    });
    await batch.commit();
  }

  // Read the whole store back, prune old sales, and recompute from what still
  // matches the card as it is now (so an edited card drops stale sales).
  const nowMs = Date.now();
  const cutoff = nowMs - P.SALES_WINDOW_DAYS * 86400000;
  const stored = await salesCol.get();
  const stale = [];
  const sales = [];
  stored.forEach((d) => {
    const s = d.data();
    const dateMs = tsMs(s.date);
    if (!dateMs || dateMs < cutoff) {
      stale.push(d.ref);
      return;
    }
    if (P.matchTitle(card, s.title, s.gradeKey).ok) sales.push({ price: Number(s.price), dateMs, gradeKey: s.gradeKey });
  });
  for (let i = 0; i < stale.length; i += 400) {
    const b = db.batch();
    stale.slice(i, i + 400).forEach((ref) => b.delete(ref));
    await b.commit();
  }

  const primary = P.computeApiValue(sales, primaryKey, nowMs);
  const gradedValues = P.computeGradedValues(sales, nowMs);

  let wroteValue = false;
  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(cardRef);
    if (!fresh.exists) return;
    const c = fresh.data();
    const now = FieldValue.serverTimestamp();
    const upd = {
      apiValue: primary.value,
      apiValueMeta: {
        sampleSize: primary.meta.sampleSize,
        low: primary.meta.low,
        high: primary.meta.high,
        lastSaleAt: primary.meta.lastSaleAt ? Timestamp.fromMillis(primary.meta.lastSaleAt) : null,
        windowDays: primary.meta.windowDays,
      },
      apiValueUpdatedAt: now,
      apiGradedValues: gradedValues,
    };
    if (opts.graded && gradedComplete) upd.apiGradedUpdatedAt = now;
    const decision = P.decideValueWrite(c, primary.value, primary.meta.sampleSize);
    if (decision.write) {
      upd.estimatedValue = primary.value;
      upd.valueSource = "api";
      upd.valueUpdatedAt = now;
      upd.updatedAt = now;
      tx.set(cardRef.collection("valueHistory").doc(), {
        date: now,
        value: primary.value,
        source: "api",
        compsUrl: null,
        note: `Market median of ${primary.meta.sampleSize} sale${primary.meta.sampleSize === 1 ? "" : "s"} (The Card API)`,
      });
      wroteValue = true;
    }
    tx.update(cardRef, upd);
  });

  return {
    cardId,
    queries: ran,
    rowsReturned,
    newMatches: matched.size,
    pruned: stale.length,
    apiValue: primary.value,
    sampleSize: primary.meta.sampleSize,
    wroteValue,
  };
}

// ---- Nightly run ---------------------------------------------------------------------
async function runPoolLimited(items, size, worker) {
  let i = 0;
  const runners = [];
  for (let k = 0; k < Math.min(size, items.length); k++) {
    runners.push(
      (async () => {
        while (i < items.length) {
          const item = items[i++];
          await worker(item);
        }
      })()
    );
  }
  await Promise.all(runners);
}

// Pass 1: every card's own price, oldest lookup first, until DAILY_SALES_BUDGET.
// Pass 2: weekly graded previews for cards whose previews are ≥7 days old,
// oldest first, with whatever budget is left. Tomorrow's run resumes with the
// cards that were skipped, because their apiValueUpdatedAt is now the oldest.
export async function runNightly(db, apiKey, isAllowlisted) {
  const started = Date.now();
  const allowed = new Map();
  const cards = [];
  const all = await db.collection("cards").get();
  for (const d of all.docs) {
    const c = d.data();
    if (!allowed.has(c.ownerId)) allowed.set(c.ownerId, await isAllowlisted(c.ownerId));
    if (allowed.get(c.ownerId)) cards.push({ id: d.id, card: c });
  }
  cards.sort((a, b) => tsMs(a.card.apiValueUpdatedAt) - tsMs(b.card.apiValueUpdatedAt));

  const stats = { cards: cards.length, primaryDone: 0, gradedDone: 0, autofilled: 0, errors: 0, stoppedReason: null };
  let stop = null;
  const handle = (e, cardId) => {
    if (e instanceof BudgetError) stop = stop || "budget";
    else if (e && e.status === 429) stop = stop || "rate-limited";
    else if (e && (e.status === 401 || e.status === 403)) stop = stop || "auth";
    else {
      stats.errors++;
      logger.warn(`nightly price refresh failed for ${cardId}: ${e && e.message}`);
    }
  };
  const pastDeadline = () => Date.now() - started > P.NIGHTLY_SOFT_DEADLINE_MS;

  await runPoolLimited(cards, P.NIGHTLY_POOL, async (x) => {
    if (stop) return;
    if (pastDeadline()) { stop = "deadline"; return; }
    try {
      const r = await refreshCard(db, apiKey, x.id, { primary: true, graded: false, cap: P.DAILY_SALES_BUDGET });
      stats.primaryDone++;
      if (r.wroteValue) stats.autofilled++;
    } catch (e) {
      handle(e, x.id);
    }
  });

  if (!stop) {
    const dueBefore = Date.now() - P.GRADED_PREVIEW_INTERVAL_DAYS * 86400000;
    const due = cards
      .filter((x) => P.cardGradeKey(x.card) !== "graded" && tsMs(x.card.apiGradedUpdatedAt) < dueBefore)
      .sort((a, b) => tsMs(a.card.apiGradedUpdatedAt) - tsMs(b.card.apiGradedUpdatedAt));
    await runPoolLimited(due, P.NIGHTLY_POOL, async (x) => {
      if (stop) return;
      if (pastDeadline()) { stop = "deadline"; return; }
      try {
        await refreshCard(db, apiKey, x.id, { primary: false, graded: true, cap: P.DAILY_SALES_BUDGET });
        stats.gradedDone++;
      } catch (e) {
        handle(e, x.id);
      }
    });
  }

  stats.stoppedReason = stop;
  stats.ms = Date.now() - started;
  await db
    .doc(USAGE_DOC)
    .set({ lastNightly: Object.assign({ finishedAt: FieldValue.serverTimestamp() }, stats) }, { merge: true })
    .catch(() => {});
  logger.info("nightly price refresh", stats);
  return stats;
}
