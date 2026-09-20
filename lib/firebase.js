// lib/firebase.js — Firebase init + thin data-access helpers (compat SDK, no build step).
window.CV = window.CV || {};

(function () {
  if (!CV.isConfigured || !CV.isConfigured()) {
    // Leave CV.firebaseReady false; app.js shows a setup message instead of crashing.
    CV.firebaseReady = false;
    return;
  }

  firebase.initializeApp(CV.firebaseConfig);

  CV.auth = firebase.auth();
  CV.db = firebase.firestore();
  CV.storage = firebase.storage();
  // Callable Functions client — region must match the deployed functions (us-central1).
  CV.functions = firebase.app().functions("us-central1");
  CV.googleProvider = new firebase.auth.GoogleAuthProvider();
  CV.firebaseReady = true;

  // Field-value helpers used across screens.
  CV.serverTimestamp = () => firebase.firestore.FieldValue.serverTimestamp();
  CV.newCardId = () => CV.db.collection("cards").doc().id;
  // Intake rows and their eventual card share one id, so intake images already
  // live at the final card's Storage path (spec §6) — no re-upload on confirm.
  CV.newIntakeId = () => CV.db.collection("intake").doc().id;
})();

// ---- Auth ---------------------------------------------------------------

CV.signIn = async function () {
  await CV.auth.signInWithPopup(CV.googleProvider);
};

CV.signOut = async function () {
  await CV.auth.signOut();
};

// Allowlist check: the caller is permitted only if a users/{uid} doc exists.
// (Josh creates that doc once in the Firebase console — see SETUP.md.)
CV.isAllowlisted = async function (uid) {
  try {
    const snap = await CV.db.collection("users").doc(uid).get();
    return snap.exists;
  } catch (e) {
    // A rules denial here means "not allowlisted".
    return false;
  }
};

// ---- Cards --------------------------------------------------------------

// Realtime listener over the signed-in user's whole collection (spec §6:
// load once, filter/search/sort in memory — no composite indexes).
// NOTE: no .orderBy() here on purpose — an equality filter + orderBy on a
// different field would require a composite index. Sorting happens in memory.
CV.listenToCards = function (uid, onData, onError) {
  return CV.db
    .collection("cards")
    .where("ownerId", "==", uid)
    .onSnapshot(
      (snap) => {
        const cards = [];
        snap.forEach((doc) => cards.push(Object.assign({ id: doc.id }, doc.data())));
        onData(cards);
      },
      (err) => onError && onError(err)
    );
};

CV.createCard = async function (cardId, data) {
  const ref = CV.db.collection("cards").doc(cardId);
  await ref.set(
    Object.assign({}, data, {
      createdAt: CV.serverTimestamp(),
      updatedAt: CV.serverTimestamp(),
    })
  );
};

CV.updateCard = async function (cardId, data) {
  const ref = CV.db.collection("cards").doc(cardId);
  await ref.update(Object.assign({}, data, { updatedAt: CV.serverTimestamp() }));
};

// Delete a card: its Storage objects (front/back full + thumbs), any valueHistory
// snapshots, then the doc itself. One code path (spec §6).
CV.deleteCard = async function (card) {
  const uid = CV.auth.currentUser.uid;

  // 1) Storage objects. Prefer stored paths; fall back to the conventional layout.
  const paths = [];
  const p = card.photos || {};
  ["front", "back"].forEach((side) => {
    const s = p[side] || {};
    if (s.path) paths.push(s.path);
    if (s.thumbPath) paths.push(s.thumbPath);
  });
  if (paths.length === 0) {
    ["front", "back"].forEach((side) => {
      paths.push(`users/${uid}/cards/${card.id}/${side}.jpg`);
      paths.push(`users/${uid}/cards/${card.id}/${side}_thumb.jpg`);
    });
  }
  await Promise.all(
    paths.map((path) =>
      CV.storage
        .ref(path)
        .delete()
        .catch(() => {}) // already gone / never existed — fine
    )
  );

  // 2) valueHistory subcollection (empty in Phase 0; safe to sweep).
  try {
    const hist = await CV.db.collection("cards").doc(card.id).collection("valueHistory").get();
    await Promise.all(hist.docs.map((d) => d.ref.delete()));
  } catch (e) {
    /* ignore */
  }

  // 3) The card doc.
  await CV.db.collection("cards").doc(card.id).delete();
};

// ---- Storage ------------------------------------------------------------

// Upload a resized image + its thumbnail for one side of a card.
// Returns { path, url, thumbPath, thumbUrl }.
CV.uploadCardImage = async function (uid, cardId, side, fullBlob, thumbBlob) {
  const base = `users/${uid}/cards/${cardId}`;
  const fullPath = `${base}/${side}.jpg`;
  const thumbPath = `${base}/${side}_thumb.jpg`;
  const meta = { contentType: "image/jpeg" };

  const fullRef = CV.storage.ref(fullPath);
  const thumbRef = CV.storage.ref(thumbPath);

  await fullRef.put(fullBlob, meta);
  await thumbRef.put(thumbBlob, meta);

  const [url, thumbUrl] = await Promise.all([fullRef.getDownloadURL(), thumbRef.getDownloadURL()]);
  return { path: fullPath, url, thumbPath, thumbUrl };
};

// ---- Intake (Phase 1: the AI-seeding queue) -----------------------------

// The callable analyzeIntake (used for single-card analysis and Retry). The
// onCreate trigger auto-analyzes new rows; this is the explicit/retry path.
CV.callAnalyzeIntake = async function (intakeId) {
  const fn = CV.functions.httpsCallable("analyzeIntake");
  const res = await fn({ intakeId });
  return res.data; // { ok, status }
};

CV.createIntake = async function (intakeId, data) {
  await CV.db.collection("intake").doc(intakeId).set(
    Object.assign({}, data, {
      createdAt: CV.serverTimestamp(),
      updatedAt: CV.serverTimestamp(),
    })
  );
};

CV.updateIntake = async function (intakeId, data) {
  await CV.db
    .collection("intake")
    .doc(intakeId)
    .update(Object.assign({}, data, { updatedAt: CV.serverTimestamp() }));
};

// Realtime listener over the user's intake rows. Single equality filter only
// (no composite index, per §6); active rows are filtered/sorted in memory.
CV.listenIntake = function (uid, onData, onError) {
  return CV.db
    .collection("intake")
    .where("ownerId", "==", uid)
    .onSnapshot(
      (snap) => {
        const rows = [];
        snap.forEach((doc) => rows.push(Object.assign({ id: doc.id }, doc.data())));
        onData(rows);
      },
      (err) => onError && onError(err)
    );
};

// Delete ONLY the intake row document, leaving Storage untouched. Used by the
// re-analyze flow, whose transient row COPIES an existing card's photo paths —
// those images belong to the card, so they must never be deleted here. Never
// call deleteIntakeAndImages on a re-analyze row.
CV.deleteIntakeRow = async function (intakeId) {
  if (!intakeId) return;
  await CV.db.collection("intake").doc(intakeId).delete();
};

// Delete an intake row and its Storage objects (Skip / discard).
CV.deleteIntakeAndImages = async function (intake) {
  const p = intake.photos || {};
  const paths = [];
  ["front", "back"].forEach((side) => {
    const s = p[side] || {};
    if (s.path) paths.push(s.path);
    if (s.thumbPath) paths.push(s.thumbPath);
  });
  await Promise.all(
    paths.map((path) => CV.storage.ref(path).delete().catch(() => {}))
  );
  await CV.db.collection("intake").doc(intake.id).delete();
};

// ---- Duplicate detection (spec §2, §14) ---------------------------------
// A *suggestion*, never a block: matches on year + brand + set + cardNumber +
// parallel + graded. Returns existing cards that look like the same card.
CV.findDuplicates = function (candidate, cards) {
  const norm = (v) => String(v == null ? "" : v).trim().toLowerCase();
  const key = (c) =>
    [
      c.year != null ? Number(c.year) : "",
      norm(c.brand),
      norm(c.set),
      norm(c.cardNumber),
      norm(c.parallel || "Base"),
      c.graded ? "g" : "r",
    ].join("|");
  const k = key(candidate);
  return (cards || []).filter((c) => c.id !== candidate.id && key(c) === k);
};

// Bump quantity on an existing card ("add 1 to quantity" duplicate path).
CV.addToCardQuantity = async function (card, n) {
  const next = (Number(card.quantity) || 1) + (n || 1);
  await CV.updateCard(card.id, { quantity: next });
  return next;
};

// ---- Value history (spec §5, Phase 2) -----------------------------------
// A snapshot in cards/{cardId}/valueHistory: { date, value, source } (spec §5),
// plus the compsUrl/note the value was based on. Written every time
// estimatedValue changes and at card creation when a value is entered — this is
// the single history-write path shared by the form save and the "update value"
// affordance. valueSource "manual" = the owner eyeballed eBay sold comps and
// typed the number; Phase 4 can append "api" snapshots the same way.
CV.appendValueSnapshot = async function (cardId, snap) {
  snap = snap || {};
  await CV.db
    .collection("cards")
    .doc(cardId)
    .collection("valueHistory")
    .add({
      date: CV.serverTimestamp(),
      value: Number(snap.value),
      source: snap.source || "manual",
      compsUrl: snap.compsUrl || null,
      note: (snap.note && String(snap.note).trim()) || null,
    });
};

// The value-update path behind the card-detail "update value" affordance: bump
// the card's current value fields AND append the history snapshot in one atomic
// batch, so the number and its history can never drift apart (spec §5, §11).
CV.updateCardValue = async function (cardId, opts) {
  opts = opts || {};
  const value = Number(opts.value);
  const now = CV.serverTimestamp();
  const cardRef = CV.db.collection("cards").doc(cardId);
  const snapRef = cardRef.collection("valueHistory").doc();

  const batch = CV.db.batch();
  batch.update(cardRef, {
    estimatedValue: value,
    valueSource: "manual",
    valueUpdatedAt: now,
    compsUrl: opts.compsUrl || null,
    updatedAt: now,
  });
  batch.set(snapRef, {
    date: now,
    value: value,
    source: "manual",
    compsUrl: opts.compsUrl || null,
    note: (opts.note && String(opts.note).trim()) || null,
  });
  await batch.commit();
};
