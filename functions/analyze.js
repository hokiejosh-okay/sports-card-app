// functions/analyze.js — the shared Claude-vision analysis path used by both the
// onCreate trigger (bulk auto-analyze) and the callable (single-card + Retry).
// Reads both images from Storage with the Admin SDK, base64-encodes them, calls
// Claude vision with the §7 prompt + strict tool schema, and writes
// aiSuggested / aiConfidence / sideCheck / rawText / status back to the intake
// doc (spec §6, §7). The Anthropic key is passed in from a Functions secret —
// never hard-coded, never sent to the client.

import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions/v2";
import Anthropic from "@anthropic-ai/sdk";

import { SYSTEM_PROMPT, RECORD_CARD_TOOL, CONFIDENCE_KEYS } from "./prompt.js";

function mediaType(path) {
  return /\.png$/i.test(path || "") ? "image/png" : "image/jpeg";
}

// Allowlist check (spec §6): a caller/owner is permitted only if a users/{uid}
// doc exists. Enforced before any billable Anthropic call.
export async function isAllowlisted(uid) {
  if (!uid) return false;
  try {
    const snap = await getFirestore().doc(`users/${uid}`).get();
    return snap.exists;
  } catch (e) {
    return false;
  }
}

// status → ready when nothing is low-confidence and the side check passes;
// otherwise check (something to look at). error is set by the catch below.
function classify(confidence, sideCheck) {
  const anyLow = CONFIDENCE_KEYS.some((k) => confidence && confidence[k] === "low");
  const sideOk =
    sideCheck && sideCheck.frontLooksLikeFront !== false && sideCheck.backLooksLikeBack !== false;
  return !anyLow && sideOk ? "ready" : "check";
}

// Analyze one intake doc. force=true (callable/Retry) re-runs regardless of
// current status; force=false (trigger) only handles a fresh "uploaded" row.
export async function runAnalysis({ intakeId, apiKey, model, bucketName, force }) {
  const db = getFirestore();
  const ref = db.doc(`intake/${intakeId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("intake-not-found");
  const intake = snap.data();

  if (!force && intake.status !== "uploaded") {
    logger.info(`analyzeIntake: skipping ${intakeId} (status=${intake.status})`);
    return { skipped: true };
  }

  await ref.update({
    status: "analyzing",
    error: null,
    updatedAt: FieldValue.serverTimestamp(),
  });

  try {
    const p = intake.photos || {};
    if (!p.front || !p.front.path || !p.back || !p.back.path) throw new Error("missing-photo-paths");

    const bucket = getStorage().bucket(bucketName || undefined);
    const [frontBuf, backBuf] = await Promise.all([
      bucket.file(p.front.path).download().then((r) => r[0]),
      bucket.file(p.back.path).download().then((r) => r[0]),
    ]);

    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model,
      max_tokens: 2048,
      thinking: { type: "disabled" }, // deterministic extraction; we force the tool call
      system: SYSTEM_PROMPT,
      tools: [RECORD_CARD_TOOL],
      tool_choice: { type: "tool", name: RECORD_CARD_TOOL.name },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Image 1 — believed to be the FRONT of the card:" },
            {
              type: "image",
              source: { type: "base64", media_type: mediaType(p.front.path), data: frontBuf.toString("base64") },
            },
            { type: "text", text: "Image 2 — believed to be the BACK of the card:" },
            {
              type: "image",
              source: { type: "base64", media_type: mediaType(p.back.path), data: backBuf.toString("base64") },
            },
            { type: "text", text: "Identify this single card and call record_card exactly once." },
          ],
        },
      ],
    });

    const block = (message.content || []).find(
      (b) => b.type === "tool_use" && b.name === RECORD_CARD_TOOL.name
    );
    if (!block || !block.input) throw new Error("no-tool-use-in-response");

    const out = block.input;
    const fields = out.fields || {};
    const confidence = out.confidence || {};
    const sideCheck = out.sideCheck || { frontLooksLikeFront: true, backLooksLikeBack: true };
    const rawText = typeof out.rawText === "string" ? out.rawText : "";

    const status = classify(confidence, sideCheck);

    await ref.update({
      status,
      aiSuggested: fields, // untouched vision output (spec §5) — lets us measure accuracy later
      aiConfidence: confidence, // per-field high | medium | low
      sideCheck,
      rawText, // stored on the intake doc only (spec §7)
      analyzedModel: model,
      error: null,
      updatedAt: FieldValue.serverTimestamp(),
    });

    logger.info(`analyzeIntake ${intakeId} → ${status}`);
    return { status };
  } catch (err) {
    logger.error(`analyzeIntake ${intakeId} failed`, err);
    // Preserve the row so it can be retried or filled in by hand (spec §11).
    await ref
      .update({
        status: "error",
        error: err && err.message ? String(err.message).slice(0, 300) : "analysis failed",
        updatedAt: FieldValue.serverTimestamp(),
      })
      .catch(() => {});
    throw err;
  }
}
