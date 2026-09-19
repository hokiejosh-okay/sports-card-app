// functions/index.js — Cloud Functions entry point (2nd-gen, Node 20).
//
// Phase 1 ships the AI intake analyzer in two shapes that share one code path
// (analyze.js → runAnalysis):
//   • analyzeIntakeOnCreate — a Firestore onCreate trigger that auto-analyzes
//     every new intake row server-side, so a bulk batch completes even if the
//     phone goes to sleep (spec §11).
//   • analyzeIntake — an onCall callable used for single-card analysis and for
//     Retry, enforcing auth + the users/{uid} allowlist (spec §6) so no
//     unauthorized caller can ever spend the Anthropic key.
//
// The Anthropic API key comes from the Functions secret ANTHROPIC_API_KEY
// (never hard-coded). The model is the env param ANTHROPIC_MODEL so it can be
// retuned without a frontend deploy (spec §7).
//
// Phase 2 will add getComps here without restructuring.

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { defineSecret, defineString } from "firebase-functions/params";
import { logger } from "firebase-functions/v2";

import { runAnalysis, isAllowlisted } from "./analyze.js";

initializeApp();

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
const ANTHROPIC_MODEL = defineString("ANTHROPIC_MODEL", { default: "claude-opus-5" });
const STORAGE_BUCKET = defineString("STORAGE_BUCKET", { default: "sports-card-app-1.firebasestorage.app" });

// Concurrency cap (spec §6, §7): keep at most 3 Claude vision calls in flight
// per analyzer to stay inside Anthropic rate limits and bound cost —
// concurrency:1 (one request per instance) × maxInstances:3 = ≤3 concurrent.
const COMMON = {
  region: "us-central1",
  secrets: [ANTHROPIC_API_KEY],
  memory: "512MiB",
  timeoutSeconds: 120,
  concurrency: 1,
  maxInstances: 3,
};

// Auto-analyze freshly uploaded intake rows (bulk + single). Only handles rows
// still in "uploaded" state; Retry goes through the callable below.
export const analyzeIntakeOnCreate = onDocumentCreated(
  { document: "intake/{intakeId}", ...COMMON },
  async (event) => {
    const intakeId = event.params.intakeId;
    const snap = event.data;
    const data = snap && snap.data();
    if (!data || data.status !== "uploaded") return;

    if (!(await isAllowlisted(data.ownerId))) {
      logger.warn(`intake ${intakeId}: owner not allowlisted — skipping analysis`);
      await snap.ref.update({ status: "error", error: "not authorized" }).catch(() => {});
      return;
    }

    try {
      await runAnalysis({
        intakeId,
        apiKey: ANTHROPIC_API_KEY.value(),
        model: ANTHROPIC_MODEL.value(),
        bucketName: STORAGE_BUCKET.value(),
        force: false,
      });
    } catch (e) {
      // runAnalysis already recorded status:"error" on the row.
    }
  }
);

// Explicit analyze / Retry. Auth + allowlist + ownership enforced here.
export const analyzeIntake = onCall(COMMON, async (req) => {
  const uid = req.auth && req.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  if (!(await isAllowlisted(uid))) throw new HttpsError("permission-denied", "This app is private.");

  const intakeId = req.data && req.data.intakeId;
  if (!intakeId || typeof intakeId !== "string") {
    throw new HttpsError("invalid-argument", "intakeId is required.");
  }

  const ref = getFirestore().doc(`intake/${intakeId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Intake row not found.");
  if (snap.data().ownerId !== uid) throw new HttpsError("permission-denied", "Not your intake row.");

  try {
    const res = await runAnalysis({
      intakeId,
      apiKey: ANTHROPIC_API_KEY.value(),
      model: ANTHROPIC_MODEL.value(),
      bucketName: STORAGE_BUCKET.value(),
      force: true,
    });
    return { ok: true, status: (res && res.status) || "check" };
  } catch (e) {
    throw new HttpsError("internal", "Analysis failed: " + ((e && e.message) || "error"));
  }
});
