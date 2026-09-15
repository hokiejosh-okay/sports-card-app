// functions/index.js — Cloud Functions entry point.
//
// Phase 0: no functions are deployed yet (this file intentionally exports
// nothing). The scaffold exists so `firebase deploy --only functions` works
// and Phase 1 can drop in `analyzeIntake` (Claude vision) and Phase 2
// `getComps` without restructuring.
//
// Phase 1 will add, roughly:
//   import { onCall } from "firebase-functions/v2/https";
//   import { defineSecret } from "firebase-functions/params";
//   const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
//   export const analyzeIntake = onCall({ secrets: [ANTHROPIC_API_KEY], concurrency: 3 }, async (req) => { ... });

export {};
