// functions/prompt.js — the §7 AI-identification prompt, the controlled value
// lists, and the strict tool schema Claude vision must fill in. Kept in the
// Function (not the frontend) so the model, prompt, and schema can be tuned and
// redeployed without a frontend change (spec §7). The controlled lists mirror
// data/lists.js on the client and §5 of the spec.

export const LISTS = {
  sports: [
    "baseball", "basketball", "football", "hockey", "soccer",
    "golf", "wrestling", "mma-boxing", "racing", "other",
  ],
  brands: ["Topps", "Panini", "Upper Deck", "Bowman", "Fleer", "Donruss", "Leaf", "Score", "Other"],
  parallels: [
    "Base", "Refractor", "X-Fractor", "Silver Prizm", "Silver", "Holo", "Chrome",
    "Gold", "Orange", "Red", "Blue", "Green", "Purple", "Pink", "Black", "Sepia",
    "Mojo", "Wave", "Disco", "Cracked Ice", "Shimmer", "Atomic", "Superfractor",
  ],
  gradingCompanies: ["PSA", "BGS", "SGC", "CGC", "CSG", "HGA", "TAG", "Other"],
  conditions: ["Gem Mint", "Mint", "Near Mint-Mint", "Near Mint", "Excellent", "Very Good", "Good", "Poor"],
  flags: ["rookie", "auto", "relic", "patch", "shortPrint"],
};

// Confidence keys the model must rate. Coarser than the raw field list on
// purpose — the confirm screen flags a whole field group as "check".
export const CONFIDENCE_KEYS = [
  "player", "year", "sport", "brand", "set", "subset", "team",
  "cardNumber", "parallel", "serialNumber", "flags", "graded", "grading", "condition",
];

const CONFIDENCE_LEVELS = ["high", "medium", "low"];

// ---- system prompt (§7) ----------------------------------------------------
export const SYSTEM_PROMPT = `You are an expert sports-card cataloguer. You are given two images of ONE trading card: the first is what the uploader believes is the FRONT, the second the BACK. Read both carefully — the back is usually where the set name, card number, year, and copyright line are printed most legibly — and record the card's attributes by calling the record_card tool exactly once.

Rules:
- Read only what is actually printed on or visible about the card. Do NOT guess. When a field cannot be determined from the images, return null (or the documented default) and mark its confidence "low".
- Give a calibrated confidence for every confidence key: "high" = clearly legible/certain; "medium" = probable but partly inferred; "low" = unreadable, missing, or a guess.
- year: the leading year of the product (e.g. 2023 for a "2023-24" set). Integer, or null.
- brand is the manufacturer; set is the product line (e.g. "Topps Chrome", "Panini Prizm", "Bowman Draft"); subset is an insert/subset within the product (e.g. "Kaboom!", "Downtown", "Color Blast") or null. These matter a lot for value — capture subset explicitly.
- parallel: the specific parallel/finish (e.g. "Silver Prizm", "Gold /10", "Refractor"). Use "Base" when it is the base card and not a parallel. You may return any string, but prefer the suggested names when they apply.
- cardNumber: the number printed on the card, WITHOUT the leading "#" (e.g. "150", "BDC-25"), or null.
- serialNumber: the print run if the card is numbered, e.g. "12/99", or null. Look for a hand- or machine-stamped "/N". Capture this explicitly — it strongly affects value.
- flags: set each boolean true only with on-card evidence — rookie, auto (an on-card or sticker autograph), relic (a jersey/patch/memorabilia swatch — relic covers all memorabilia), patch (a multi-color patch swatch specifically), shortPrint (an SP/SSP marking).
- flags.rookie: set true ONLY when the card itself carries rookie evidence — an "RC" logo or shield, the printed words "Rookie Card", "Rated Rookie", or "Draft Pick"/"Draft", a first-year designation such as "1st Bowman", or a recognized rookie-year insert/subset marker. Judge strictly from what is printed on or shown by the card; NEVER infer rookie status from the player's fame, prominence, or apparent age. If there is no such on-card marker, set rookie false and rate its confidence "low".
- graded: true only if the card is inside a numbered grading slab (PSA/BGS/SGC/etc.). When graded, read grading.company, grading.grade (numeric, e.g. 9 or 9.5), grading.gradeLabel (e.g. "GEM MT", "MINT", "Black Label", or null) and grading.certNumber (the cert/serial on the slab label, or null). When NOT graded, set graded false and every grading.* field to null, and set condition only if you can judge it.
- condition: for RAW cards only, your best read of the hobby condition; null when graded or unclear.
- additionalPlayers: other players pictured on a multi-player card; [] otherwise.
- sideCheck: judge whether image 1 really looks like a card FRONT (the player photo / main design) and image 2 like a BACK (stats, text, copyright). This catches bulk sequence slips — set the flags honestly even when the fields still read fine.
- rawText: a short verbatim transcription of the key printed text on the BACK (set name, card number, copyright/year line). This is for debugging misreads; keep it brief.

Controlled values you MUST choose from where noted:
- sport (choose exactly one; use "other" if unclear): ${LISTS.sports.join(", ")}
- brand (choose exactly one; use "Other" if unclear): ${LISTS.brands.join(", ")}
- grading.company (when graded; use "Other" if unclear): ${LISTS.gradingCompanies.join(", ")}
- condition (raw only): ${LISTS.conditions.join(", ")}
- parallel suggestions (free text allowed): ${LISTS.parallels.join(", ")}

Call record_card exactly once with your best reading. Do not write any prose outside the tool call.`;

// ---- strict tool schema ----------------------------------------------------
const confLevel = { type: "string", enum: CONFIDENCE_LEVELS };
const strOrNull = { type: ["string", "null"] };

function objOf(props) {
  return {
    type: "object",
    properties: props,
    required: Object.keys(props),
    additionalProperties: false,
  };
}

const fieldsSchema = objOf({
  player: { type: "string", description: "Primary player/subject; \"\" if unreadable" },
  additionalPlayers: { type: "array", items: { type: "string" } },
  year: { type: ["integer", "null"] },
  sport: { type: "string", enum: LISTS.sports },
  brand: { type: "string", enum: LISTS.brands },
  set: { type: "string", description: "Product line, e.g. \"Topps Chrome\"; \"\" if unknown" },
  subset: strOrNull,
  team: strOrNull,
  cardNumber: strOrNull,
  parallel: { type: "string", description: "\"Base\" when not a parallel" },
  serialNumber: strOrNull,
  flags: objOf({
    rookie: { type: "boolean" },
    auto: { type: "boolean" },
    relic: { type: "boolean" },
    patch: { type: "boolean" },
    shortPrint: { type: "boolean" },
  }),
  graded: { type: "boolean" },
  grading: objOf({
    company: strOrNull,
    grade: { type: ["number", "null"] },
    gradeLabel: strOrNull,
    certNumber: strOrNull,
  }),
  condition: strOrNull,
});

const confidenceSchema = objOf(
  CONFIDENCE_KEYS.reduce((acc, k) => {
    acc[k] = confLevel;
    return acc;
  }, {})
);

export const RECORD_CARD_TOOL = {
  name: "record_card",
  description: "Record the identified attributes of the sports card, with a confidence level for each field and a front/back side check.",
  strict: true,
  input_schema: objOf({
    fields: fieldsSchema,
    confidence: confidenceSchema,
    sideCheck: objOf({
      frontLooksLikeFront: { type: "boolean" },
      backLooksLikeBack: { type: "boolean" },
    }),
    rawText: { type: "string" },
  }),
};
