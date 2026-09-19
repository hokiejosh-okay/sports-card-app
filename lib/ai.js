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

  return { fieldsToCard, runPool, pairPhotos };
})();
