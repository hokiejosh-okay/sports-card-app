// data/lists.js — controlled value lists (spec §5)
// All categorical fields validated against these in the UI and in Firestore rules.
window.CV = window.CV || {};

CV.lists = {
  // sport (controlled)
  sports: [
    { value: "baseball", label: "Baseball" },
    { value: "basketball", label: "Basketball" },
    { value: "football", label: "Football" },
    { value: "hockey", label: "Hockey" },
    { value: "soccer", label: "Soccer" },
    { value: "golf", label: "Golf" },
    { value: "wrestling", label: "Wrestling" },
    { value: "mma-boxing", label: "MMA / Boxing" },
    { value: "racing", label: "Racing" },
    { value: "other", label: "Other" },
  ],

  // brand (controlled) — manufacturer; Bowman listed separately (collectors search it that way)
  brands: ["Topps", "Panini", "Upper Deck", "Bowman", "Fleer", "Donruss", "Leaf", "Score", "Other"],

  // parallel — suggested list, free entry allowed. "Base" = not a parallel.
  parallels: [
    "Base", "Refractor", "X-Fractor", "Silver Prizm", "Silver", "Holo", "Chrome",
    "Gold", "Orange", "Red", "Blue", "Green", "Purple", "Pink", "Black", "Sepia",
    "Mojo", "Wave", "Disco", "Cracked Ice", "Shimmer", "Atomic", "Superfractor",
  ],

  // grading.company (controlled)
  gradingCompanies: ["PSA", "BGS", "SGC", "CGC", "CSG", "HGA", "TAG", "Other"],

  // grading.grade — numeric 1–10 in 0.5 steps
  grades: (function () {
    const out = [];
    for (let g = 10; g >= 1; g -= 0.5) out.push(g);
    return out;
  })(),

  // condition (raw cards only) — 8-step hobby scale
  conditions: [
    "Gem Mint", "Mint", "Near Mint-Mint", "Near Mint",
    "Excellent", "Very Good", "Good", "Poor",
  ],

  // flags — booleans, each individually queryable
  flags: [
    { key: "rookie", label: "RC" },
    { key: "auto", label: "Auto" },
    { key: "relic", label: "Relic" },
    { key: "patch", label: "Patch" },
    { key: "shortPrint", label: "SP" },
  ],

  // valueSource
  valueSources: ["manual", "api"],
};

// Fast membership checks used by validation / display.
CV.lists.sportValues = CV.lists.sports.map((s) => s.value);
CV.lists.sportLabel = (v) => (CV.lists.sports.find((s) => s.value === v) || {}).label || v || "";
