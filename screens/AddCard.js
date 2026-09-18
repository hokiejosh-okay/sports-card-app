// screens/AddCard.js — Add flow (Phase 1). Single card = capture → analyze with
// Claude vision → confirm screen with per-field confidence flags + Swap sides.
// Bulk = the review-queue seeding flow (screens/BulkUpload.js). Both share the
// one card form and the one save path (spec §6).
window.CV = window.CV || {};

CV.AddCard = function AddCard(props) {
  const { useState } = React;
  const [tab, setTab] = useState("single");

  return (
    <div className="screen add-screen">
      <header className="sub-header">
        <button className="icon-btn" onClick={props.onCancel} aria-label="Back">
          <CV.Icons.Back size={22} />
        </button>
        <h2 className="sub-title">Add card</h2>
        <span className="icon-btn-spacer" />
      </header>

      <div className="segmented">
        <button className={"seg" + (tab === "single" ? " seg-on" : "")} onClick={() => setTab("single")}>
          Single card
        </button>
        <button className={"seg" + (tab === "bulk" ? " seg-on" : "")} onClick={() => setTab("bulk")}>
          Bulk upload
        </button>
      </div>

      {tab === "single" ? (
        <SingleAdd cards={props.cards} onCancel={props.onCancel} onSaved={props.onSaved} />
      ) : (
        <CV.BulkUpload cards={props.cards} onCancel={props.onCancel} onDone={props.onSaved} />
      )}
    </div>
  );
};

// ---- single-card AI flow ---------------------------------------------------
function SingleAdd(props) {
  const { useState, useEffect, useRef } = React;
  const [step, setStep] = useState("capture"); // capture | analyzing | confirm
  const [photos, setPhotos] = useState({ front: null, back: null });
  const [stored, setStored] = useState(null); // uploaded { front, back } for cleanup
  const [processing, setProcessing] = useState(null);
  const [err, setErr] = useState("");
  const [intakeId, setIntakeId] = useState(null);
  const [intake, setIntake] = useState(null);
  const unsubRef = useRef(null);

  useEffect(() => () => { if (unsubRef.current) unsubRef.current(); }, []);

  function stopListening() {
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }
  }

  async function pick(side, file) {
    if (!file) return;
    setErr("");
    setProcessing(side);
    try {
      const { fullBlob, thumbBlob, previewUrl } = await CV.images.process(file);
      setPhotos((p) => Object.assign({}, p, { [side]: { fullBlob, thumbBlob, previewUrl } }));
    } catch (e) {
      setErr(e.message || "Could not process that image.");
    } finally {
      setProcessing(null);
    }
  }

  async function analyze() {
    if (!photos.front || !photos.back) {
      setErr("Add both a front and back photo first.");
      return;
    }
    setErr("");
    setStep("analyzing");
    try {
      const uid = CV.auth.currentUser.uid;
      const id = CV.newIntakeId();
      const front = await CV.uploadCardImage(uid, id, "front", photos.front.fullBlob, photos.front.thumbBlob);
      const back = await CV.uploadCardImage(uid, id, "back", photos.back.fullBlob, photos.back.thumbBlob);
      setStored({ front, back });
      setIntakeId(id);
      await CV.createIntake(id, {
        ownerId: uid,
        batchId: id,
        sequence: 0,
        photos: { front, back },
        status: "uploaded",
        sideCheck: null,
        aiSuggested: null,
        aiConfidence: null,
        error: null,
        cardId: null,
      });
      // The onCreate Function analyzes server-side; watch for the result.
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
    } catch (e) {
      console.error(e);
      setErr(e.message || "Upload failed. Check your connection and try again.");
      setStep("capture");
    }
  }

  async function retry() {
    if (!intakeId) return;
    setIntake(null);
    setStep("analyzing");
    try {
      await CV.callAnalyzeIntake(intakeId);
    } catch (e) {
      // The snapshot listener will surface status:"error".
    }
  }

  // Escape hatch if analysis stalls (e.g. Function not deployed yet).
  function fillByHand() {
    stopListening();
    setIntake({ id: intakeId, photos: stored, aiSuggested: null, aiConfidence: null, sideCheck: null, status: "check" });
    setStep("confirm");
  }

  async function onSaved(result) {
    stopListening();
    try {
      if (result.action === "merged") {
        // Merged into an existing card — its own images stand; drop these.
        await CV.deleteIntakeAndImages({ id: intakeId, photos: (intake && intake.photos) || stored });
      } else {
        await CV.updateIntake(intakeId, { status: "confirmed", cardId: result.cardId });
      }
    } catch (e) {
      /* non-fatal */
    }
    props.onSaved && props.onSaved();
  }

  async function cancel() {
    stopListening();
    if (intakeId) {
      try {
        await CV.deleteIntakeAndImages({ id: intakeId, photos: (intake && intake.photos) || stored });
      } catch (e) {
        /* ignore */
      }
    }
    props.onCancel && props.onCancel();
  }

  if (step === "analyzing") {
    return (
      <div className="add-body">
        <div className="analyzing-state">
          <div className="spinner" />
          <div className="analyzing-title">Reading your card…</div>
          <p className="add-note">Claude is identifying the card from the front and back. This usually takes a few seconds.</p>
          <button className="btn btn-ghost" onClick={fillByHand}>Enter details by hand</button>
        </div>
      </div>
    );
  }

  if (step === "confirm" && intake) {
    const initial = CV.ai.fieldsToCard(intake.aiSuggested || {}, intake.photos || stored);
    return (
      <div className="add-body">
        {intake.status === "error" ? (
          <div className="form-error">
            Analysis failed{intake.error ? ": " + intake.error : ""}. Fill the fields in by hand, or retry.
          </div>
        ) : (
          <p className="add-note">Claude pre-filled these. Fields marked <span className="check-tag">check</span> are low-confidence — give them a look.</p>
        )}
        <div className="confirm-top">
          <button className="btn btn-ghost btn-sm" onClick={retry}>↻ Re-analyze</button>
        </div>
        <CV.CardForm
          mode="add"
          initial={initial}
          confidence={intake.aiConfidence}
          sideCheck={intake.sideCheck}
          showSwap
          cards={props.cards}
          saveOpts={{ cardId: intakeId, ai: { aiSuggested: intake.aiSuggested, aiConfidence: intake.aiConfidence } }}
          onCancel={cancel}
          onSaved={onSaved}
        />
      </div>
    );
  }

  // step === "capture"
  return (
    <div className="add-body">
      <p className="add-note">Photograph the front and back — Claude reads the card and pre-fills the fields for you to confirm.</p>
      <div className="photo-tiles">
        <CaptureTile side="front" label="Front" photo={photos.front} busy={processing === "front"} onPick={pick} />
        <CaptureTile side="back" label="Back" photo={photos.back} busy={processing === "back"} onPick={pick} />
      </div>
      {err ? <div className="form-error">{err}</div> : null}
      <div className="form-actions">
        <button className="btn btn-ghost" onClick={props.onCancel}>Cancel</button>
        <button className="btn btn-primary" onClick={analyze} disabled={!photos.front || !photos.back || !!processing}>
          Analyze card with AI
        </button>
      </div>
    </div>
  );
}

// A capture tile with camera capture (mobile) / file picker (desktop).
function CaptureTile(props) {
  const p = props.photo || {};
  const src = p.previewUrl || null;
  const inputId = "single-photo-" + props.side;
  return (
    <div className="photo-tile-wrap">
      <label htmlFor={inputId} className="photo-tile">
        {src ? (
          <img src={src} alt={props.label} className="photo-tile-img" />
        ) : (
          <div className="photo-tile-empty">
            <CV.Icons.Camera size={26} />
            <span>{props.label}</span>
          </div>
        )}
        {props.busy ? <div className="photo-tile-busy">Processing…</div> : null}
        {src ? <div className="photo-tile-label">{props.label}</div> : null}
      </label>
      <input
        id={inputId}
        className="visually-hidden"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => {
          const f = e.target.files && e.target.files[0];
          props.onPick(props.side, f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
