// screens/ReanalyzeCard.js — "Analyze with AI" on an existing card. Reuses the
// unchanged intake pipeline: create a TRANSIENT intake row whose photos are
// COPIED (paths + URLs) from the card, marked reanalyzeOf:<card id>, so the
// analyzeIntakeOnCreate trigger reads the SAME Storage objects and writes
// aiSuggested/aiConfidence/sideCheck/status back — no re-upload, no re-capture.
// Then open CV.CardForm in `edit` mode seeded from the card, with AI values
// merged in per the strict "only fill empty" rule (CV.ai.fillEmpty) and
// confidence flags scoped to just the fields we filled. On save/cancel the
// transient row's DOCUMENT is deleted (CV.deleteIntakeRow) — never its images,
// which belong to the card. Mirrors SingleAdd in screens/AddCard.js (spec §6,
// §11 Phase 1).
window.CV = window.CV || {};

CV.ReanalyzeCard = function ReanalyzeCard(props) {
  const { useState, useEffect, useRef } = React;
  const card = props.card;

  const [step, setStep] = useState("analyzing"); // analyzing | confirm
  const [intake, setIntake] = useState(null);
  const [intakeId, setIntakeId] = useState(null);
  const [err, setErr] = useState("");

  const unsubRef = useRef(null);
  const idRef = useRef(null); // the created row id, for cleanup on unmount
  const doneRef = useRef(false); // true once we've saved/cancelled (cleanup done)

  function stopListening() {
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }
  }

  // Listen to one intake row; surface the result when the trigger finishes.
  function listen(id) {
    stopListening();
    unsubRef.current = CV.db
      .collection("intake")
      .doc(id)
      .onSnapshot((snap) => {
        const d = snap.data();
        if (!d) return;
        if (d.status === "ready" || d.status === "check" || d.status === "error") {
          setIntake(Object.assign({ id: id }, d));
          setStep("confirm");
        }
      });
  }

  // Create the transient intake row and listen for the trigger's result.
  async function start() {
    setErr("");
    setIntake(null);
    setStep("analyzing");
    stopListening();
    try {
      const uid = CV.auth.currentUser.uid;
      const photos = (card && card.photos) || {};
      if (!photos.front || !photos.front.path || !photos.back || !photos.back.path) {
        setErr("This card is missing a front or back photo, so it can't be analyzed.");
        return;
      }
      const id = CV.newIntakeId();
      idRef.current = id;
      setIntakeId(id);
      await CV.createIntake(id, {
        ownerId: uid,
        batchId: id,
        sequence: 0,
        // Photos copied verbatim from the card — same Storage paths, no re-upload.
        photos: { front: photos.front, back: photos.back },
        status: "uploaded",
        sideCheck: null,
        aiSuggested: null,
        aiConfidence: null,
        error: null,
        cardId: null,
        // The marker that keeps this row out of the bulk queue and off the
        // image-deleting cleanup path.
        reanalyzeOf: card.id,
      });
      // The onCreate Function analyzes server-side; watch for the result.
      listen(id);
    } catch (e) {
      console.error(e);
      setErr(e.message || "Couldn't start the analysis. Check your connection and try again.");
    }
  }

  useEffect(() => {
    start();
    return () => {
      stopListening();
      // If we navigate away without saving/cancelling (e.g. the card was deleted
      // elsewhere and the app routed home), drop the transient row DOC ONLY.
      if (idRef.current && !doneRef.current) {
        CV.deleteIntakeRow(idRef.current).catch(function () {});
      }
    };
    // eslint-disable-next-line
  }, []);

  async function retry() {
    if (!intakeId) {
      start();
      return;
    }
    setIntake(null);
    setStep("analyzing");
    listen(intakeId); // re-attach in case "Enter details by hand" stopped it
    try {
      await CV.callAnalyzeIntake(intakeId);
    } catch (e) {
      // The snapshot listener will surface status:"error".
    }
  }

  // Escape hatch: skip AI and edit the existing card by hand (nothing merged).
  function fillByHand() {
    stopListening();
    setIntake({ id: intakeId, aiSuggested: null, aiConfidence: null, sideCheck: null, status: "check" });
    setStep("confirm");
  }

  async function cleanupRow() {
    doneRef.current = true;
    stopListening();
    if (idRef.current) {
      try {
        await CV.deleteIntakeRow(idRef.current);
      } catch (e) {
        /* non-fatal */
      }
    }
  }

  async function onSaved() {
    // The edit path already updated the existing card; drop the transient row.
    await cleanupRow();
    props.onSaved && props.onSaved();
  }

  async function cancel() {
    await cleanupRow();
    props.onCancel && props.onCancel();
  }

  return (
    <div className="screen reanalyze-screen">
      <header className="sub-header">
        <button className="icon-btn" onClick={cancel} aria-label="Back">
          <CV.Icons.Back size={22} />
        </button>
        <h2 className="sub-title ellipsis">Analyze with AI</h2>
        <span className="icon-btn-spacer" />
      </header>

      {step === "confirm" && intake ? (
        <ReanalyzeConfirm
          card={card}
          intake={intake}
          onRetry={retry}
          onCancel={cancel}
          onSaved={onSaved}
        />
      ) : (
        <div className="add-body">
          <div className="analyzing-state">
            {err ? (
              <React.Fragment>
                <div className="form-error">{err}</div>
                <button className="btn btn-primary" onClick={start}>Try again</button>
                <button className="btn btn-ghost" onClick={fillByHand}>Enter details by hand</button>
              </React.Fragment>
            ) : (
              <React.Fragment>
                <div className="spinner" />
                <div className="analyzing-title">Reading your card…</div>
                <p className="add-note">
                  Claude is re-reading the front and back to fill in any blank fields. This usually takes a few seconds.
                </p>
                <button className="btn btn-ghost" onClick={fillByHand}>Enter details by hand</button>
              </React.Fragment>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Confirm form: existing card seeded, AI merged into empty fields only, flags
// scoped to filled+low fields. Saves as an EDIT to the same card.
function ReanalyzeConfirm(props) {
  const intake = props.intake;
  const merged = CV.ai.fillEmpty(props.card, intake.aiSuggested || {});
  const confidence = CV.ai.scopedConfidence(merged.filled, intake.aiConfidence);

  return (
    <div className="add-body">
      {intake.status === "error" ? (
        <div className="form-error">
          Analysis failed{intake.error ? ": " + intake.error : ""}. Fill in the fields by hand, or retry.
        </div>
      ) : (
        <p className="add-note">
          Claude filled in only the fields that were blank. Fields marked{" "}
          <span className="check-tag">check</span> are low-confidence — give them a look. Your existing values were left as-is.
        </p>
      )}
      <div className="confirm-top">
        <button className="btn btn-ghost btn-sm" onClick={props.onRetry}>↻ Re-analyze</button>
      </div>
      <CV.CardForm
        mode="edit"
        initial={merged.card}
        confidence={confidence}
        sideCheck={intake.sideCheck}
        saveOpts={{
          skipDuplicateCheck: true,
          ai: { aiSuggested: intake.aiSuggested, aiConfidence: intake.aiConfidence },
        }}
        onCancel={props.onCancel}
        onSaved={props.onSaved}
      />
    </div>
  );
}
