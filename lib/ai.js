// lib/ai.js — client-side helpers for the Phase 1 AI intake flow: mapping the
// vision output onto the shared card form, a throttled work pool (client-side
// concurrency cap), and sequence pairing for bulk upload (spec §2, §7).
window.CV = window.CV || {};

CV.ai = (function () {
  function normSport(v) {
    return CV.lists.sportValues.indexOf(v) >= 0 ? v : "";
  }
  function normBrand(v) {
    return CV.lists.brands.indexOf(v) >= 0 ? v : "Other";
  }

  // Map raw vision output (aiSuggested) to a card-shaped object that CardForm
  // consumes as `initial`. AI field names already match the §5 card model.
  function fieldsToCard(fields, photos) {
    const f = fields || {};
    const g = f.grading || {};
    return {
      player: f.player || "",
      additionalPlayers: Array.isArray(f.additionalPlayers) ? f.additionalPlayers : [],
      year: f.year != null ? f.year : null,
      sport: normSport(f.sport),
      team: f.team || null,
      brand: normBrand(f.brand),
      set: f.set || "",
      subset: f.subset || null,
      parallel: f.parallel && String(f.parallel).trim() ? f.parallel : "Base",
      cardNumber: f.cardNumber || null,
      serialNumber: f.serialNumber || null,
      flags: {
        rookie: !!(f.flags && f.flags.rookie),
        auto: !!(f.flags && f.flags.auto),
        relic: !!(f.flags && f.flags.relic),
        patch: !!(f.flags && f.flags.patch),
        shortPrint: !!(f.flags && f.flags.shortPrint),
      },
      graded: !!f.graded,
      grading: f.graded
        ? {
            company: g.company || "PSA",
            grade: g.grade != null ? g.grade : "",
            gradeLabel: g.gradeLabel || "",
            certNumber: g.certNumber || "",
          }
        : { company: "PSA", grade: "", gradeLabel: "", certNumber: "" },
      condition: f.graded ? "" : f.condition || "",
      photos: photos || undefined,
    };
  }

  // Strict "only fill empty" merge for re-analyzing an EXISTING card. Start from
  // the card's own values and overlay an AI value ONLY where the card field is
  // genuinely empty (null, "", or []). Identity fields the owner may already have
  // curated — player, sport, brand, parallel, flags, graded, grading, quantity —
  // and any money/notes field are NEVER touched, even when they still hold a
  // default like "Base" or "Topps". Photos are never touched. Returns the merged
  // card-shaped object CardForm consumes as `initial`, plus `filled`: the set of
  // field keys actually taken from AI, so confidence flags can be scoped to them.
  function fillEmpty(existingCard, aiFields) {
    const card = existingCard || {};
    const ai = fieldsToCard(aiFields || {}, undefined); // normalize AI values only
    const out = Object.assign({}, card); // preserve everything (photos included)
    const filled = {};

    const isEmpty = (v) =>
      v == null || v === "" || (Array.isArray(v) && v.length === 0);

    // Simple identity fields, filled only when the card's slot is empty.
    ["year", "set", "team", "subset", "cardNumber", "serialNumber"].forEach((k) => {
      if (isEmpty(card[k]) && !isEmpty(ai[k])) {
        out[k] = ai[k];
        filled[k] = true;
      }
    });

    // Condition only applies to a raw card; graded cards carry a grade instead.
    if (!card.graded && isEmpty(card.condition) && !isEmpty(ai.condition)) {
      out.condition = ai.condition;
      filled.condition = true;
    }

    // Additional players only when the card has none yet.
    if (isEmpty(card.additionalPlayers) && Array.isArray(ai.additionalPlayers) && ai.additionalPlayers.length) {
      out.additionalPlayers = ai.additionalPlayers.slice();
      filled.additionalPlayers = true;
    }

    return { card: out, filled: filled };
  }

  // Scoped confidence map for the confirm form: flag ONLY fields we actually
  // filled from AI, and only when their confidence is "low". A field left alone
  // is never flagged (spec: re-analyze confirm is a scan of what changed).
  function scopedConfidence(filled, aiConfidence) {
    const conf = aiConfidence || {};
    const out = {};
    Object.keys(filled || {}).forEach((k) => {
      if (conf[k] === "low") out[k] = "low";
    });
    return out;
  }

  // Throttled pool — caps how many analyses/retries the client kicks at once,
  // complementing the Function's server-side concurrency cap.
  async function runPool(items, worker, size) {
    size = size || 3;
    let i = 0;
    const runners = [];
    const n = Math.min(size, items.length);
    for (let s = 0; s < n; s++) {
      runners.push(
        (async () => {
          while (i < items.length) {
            const idx = i++;
            try {
              await worker(items[idx], idx);
            } catch (e) {
              /* the worker records its own error state */
            }
          }
        })()
      );
    }
    await Promise.all(runners);
  }

  // Pair an ordered photo list into front/back pairs (shoot-in-order, spec §2).
  // offset=1 shifts by one when the sequence starts on a back.
  function pairPhotos(list, offset) {
    const arr = offset ? list.slice(offset) : list.slice();
    const pairs = [];
    for (let k = 0; k < arr.length; k += 2) {
      pairs.push({ front: arr[k], back: arr[k + 1] || null });
    }
    return pairs;
  }

  return { fieldsToCard, fillEmpty, scopedConfidence, runPool, pairPhotos };
})();
