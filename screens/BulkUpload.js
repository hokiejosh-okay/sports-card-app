// screens/BulkUpload.js — bulk seeding (spec §2, §3, §11 Phase 1).
// Flow: select many photos (shot front, back, front, back…) → pair by sequence
// (offset + remove to fix slips) → upload → a resumable Firestore review queue
// (ready / check / working / error) that the analyzeIntake Function fills
// server-side, with Confirm-all-ready, per-row open→confirm, Retry, Skip,
// Swap sides, and Re-pair.
window.CV = window.CV || {};

const BULK_ACTIVE = ["uploaded", "analyzing", "ready", "check", "error"];

function tsms(v) {
  if (!v) return 0;
  if (v.toMillis) return v.toMillis();
  if (v.seconds) return v.seconds * 1000;
  const d = new Date(v);
  return isNaN(d) ? 0 : d.getTime();
}

CV.BulkUpload = function BulkUpload(props) {
  const { useState, useEffect, useRef } = React;

  const [stage, setStage] = useState("select"); // select | pair | queue
  const [photoList, setPhotoList] = useState([]); // ordered { previewUrl, fullBlob, thumbBlob, name }
  const [offset, setOffset] = useState(0); // 1 = first photo is a back
  const [processing, setProcessing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [rows, setRows] = useState([]);
  const [confirmRow, setConfirmRow] = useState(null);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [busyRowId, setBusyRowId] = useState(null);
  const [err, setErr] = useState("");
  const bootRef = useRef(false);

  // Resumable queue: listen to the user's active intake rows (spec §11).
  useEffect(() => {
    const uid = CV.auth.currentUser.uid;
    const unsub = CV.listenIntake(
      uid,
      (all) => {
        const active = all
          .filter((r) => BULK_ACTIVE.indexOf(r.status) >= 0)
          .sort((a, b) => tsms(a.createdAt) - tsms(b.createdAt) || (a.sequence || 0) - (b.sequence || 0));
        setRows(active);
        if (!bootRef.current) {
          bootRef.current = true;
          if (active.length) setStage("queue");
        }
      },
      (e) => console.error("intake listener", e)
    );
    return () => unsub();
  }, []);

  // ---- select stage ----
  async function onFiles(files) {
    if (!files || !files.length) return;
    setErr("");
    setProcessing(true);
    try {
      const out = [];
      for (const file of Array.from(files)) {
        try {
          const { fullBlob, thumbBlob, previewUrl } = await CV.images.process(file);
          out.push({ fullBlob, thumbBlob, previewUrl, name: file.name });
        } catch (e) {
          /* skip an unreadable file */
        }
      }
      setPhotoList((prev) => prev.concat(out));
    } finally {
      setProcessing(false);
    }
  }

  function removePhoto(idx) {
    setPhotoList((list) => list.filter((_, i) => i !== idx));
  }

  const pairs = CV.ai.pairPhotos(photoList, offset);
  const fullPairs = pairs.filter((p) => p.front && p.back);
  const oddTail = pairs.length && !pairs[pairs.length - 1].back;

  async function processBatch() {
    if (!fullPairs.length) {
      setErr("Add an even number of photos (front, back, front, back…).");
      return;
    }
    setErr("");
    setUploading(true);
    setStage("queue");
    const uid = CV.auth.currentUser.uid;
    let done = 0;
    try {
      await CV.ai.runPool(
        fullPairs,
        async (pair, i) => {
          const id = CV.newIntakeId();
          const front = await CV.uploadCardImage(uid, id, "front", pair.front.fullBlob, pair.front.thumbBlob);
          const back = await CV.uploadCardImage(uid, id, "back", pair.back.fullBlob, pair.back.thumbBlob);
          await CV.createIntake(id, {
            ownerId: uid,
            batchId: "batch-" + Date.now(),
            sequence: i,
            photos: { front, back },
            status: "uploaded", // the onCreate Function analyzes it server-side
            sideCheck: null,
            aiSuggested: null,
            aiConfidence: null,
            error: null,
            cardId: null,
          });
          done += 1;
          setUploadMsg("Uploaded " + done + " of " + fullPairs.length + " cards…");
        },
        3
      );
      // Photos are safe in the queue now; clear the local buffer.
      setPhotoList([]);
      setOffset(0);
      setUploadMsg("");
    } catch (e) {
      setErr(e.message || "Some uploads failed. Open the queue and Retry.");
    } finally {
      setUploading(false);
    }
  }

  // ---- queue actions ----
  async function confirmAllReady() {
    const ready = rows.filter((r) => r.status === "ready");
    if (!ready.length) return;
    setConfirmingAll(true);
    for (const row of ready) {
      try {
        // Duplicate suggestion (§2): don't silently merge — leave it for review.
        const cand = dupCandidate(row);
        if (CV.findDuplicates(cand, props.cards).length) {
          await CV.updateIntake(row.id, { status: "check" });
          continue;
        }
        await CV.saveCardFromAI(row);
        await CV.updateIntake(row.id, { status: "confirmed", cardId: row.id });
      } catch (e) {
        await CV.updateIntake(row.id, { status: "check" }).catch(() => {});
      }
    }
    setConfirmingAll(false);
  }

  async function retryRow(row) {
    setBusyRowId(row.id);
    try {
      await CV.callAnalyzeIntake(row.id);
    } catch (e) {
      /* listener surfaces the error status */
    } finally {
      setBusyRowId(null);
    }
  }

  async function skipRow(row) {
    setBusyRowId(row.id);
    try {
      await CV.deleteIntakeAndImages(row);
    } finally {
      setBusyRowId(null);
    }
  }

  // Quick within-pair fix: swap which stored image is front/back, then re-analyze.
  async function swapRow(row) {
    setBusyRowId(row.id);
    try {
      await CV.updateIntake(row.id, {
        status: "uploaded",
        photos: { front: row.photos.back, back: row.photos.front },
        sideCheck: null,
      });
      await CV.callAnalyzeIntake(row.id);
    } catch (e) {
      /* listener surfaces status */
    } finally {
      setBusyRowId(null);
    }
  }

  // Re-pair: discard the unconfirmed rows and rebuild pairs from the in-memory
  // photo list (available until the tab is reloaded). Fixes sequence slips
  // across pairs (spec §3).
  async function rePair() {
    if (!photoList.length) {
      setErr("Re-pair is available only in the session where you uploaded (the photos are still in memory). For a reloaded queue, use Swap sides or Skip on a row.");
      return;
    }
    setErr("");
    const toDrop = rows.slice();
    await Promise.all(toDrop.map((r) => CV.deleteIntakeAndImages(r).catch(() => {})));
    setStage("pair");
  }

  // ---- confirm one row ----
  async function onRowSaved(result) {
    const row = confirmRow;
    setConfirmRow(null);
    try {
      if (result.action === "merged") {
        await CV.deleteIntakeAndImages({ id: row.id, photos: row.photos });
      } else {
        await CV.updateIntake(row.id, { status: "confirmed", cardId: result.cardId });
      }
    } catch (e) {
      /* non-fatal */
    }
  }

  async function onRowSkip() {
    const row = confirmRow;
    setConfirmRow(null);
    try {
      await CV.deleteIntakeAndImages(row);
    } catch (e) {
      /* non-fatal */
    }
  }

  // ---- render: confirm overlay ----
  if (confirmRow) {
    const initial = CV.ai.fieldsToCard(confirmRow.aiSuggested || {}, confirmRow.photos);
    return (
      <div className="add-body">
        <div className="confirm-top">
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirmRow(null)}>← Back to queue</button>
          <button className="btn btn-ghost btn-sm" onClick={() => retryRow(confirmRow)}>↻ Re-analyze</button>
        </div>
        {confirmRow.status === "error" ? (
          <div className="form-error">Analysis failed{confirmRow.error ? ": " + confirmRow.error : ""}. Fill in by hand or retry.</div>
        ) : (
          <p className="add-note">Fields marked <span className="check-tag">check</span> are low-confidence — give them a look.</p>
        )}
        <CV.CardForm
          mode="add"
          initial={initial}
          confidence={confirmRow.aiConfidence}
          sideCheck={confirmRow.sideCheck}
          showSwap
          cards={props.cards}
          saveLabel="Save & next"
          saveOpts={{ cardId: confirmRow.id, ai: { aiSuggested: confirmRow.aiSuggested, aiConfidence: confirmRow.aiConfidence } }}
          onCancel={() => setConfirmRow(null)}
          onSkip={onRowSkip}
          onSaved={onRowSaved}
        />
      </div>
    );
  }

  // ---- render: queue stage ----
  if (stage === "queue") {
    const total = rows.length;
    const analyzed = rows.filter((r) => ["ready", "check", "error"].indexOf(r.status) >= 0).length;
    const readyCount = rows.filter((r) => r.status === "ready").length;
    const pct = total ? Math.round((analyzed / total) * 100) : 0;

    return (
      <div className="add-body">
        {uploading ? <div className="add-note">{uploadMsg || "Uploading…"}</div> : null}
        {err ? <div className="form-error">{err}</div> : null}

        {total === 0 && !uploading ? (
          <div className="empty">
            <div className="empty-title">Queue is empty</div>
            <div className="empty-sub">All caught up. Add more photos to seed the rest.</div>
            <button className="btn btn-primary" onClick={() => setStage("select")}>Add more photos</button>
          </div>
        ) : (
          <React.Fragment>
            <div className="queue-head">
              <div className="queue-progress">
                <div className="queue-progress-bar"><span style={{ width: pct + "%" }} /></div>
                <div className="queue-progress-label">{analyzed} of {total} analyzed</div>
              </div>
              <div className="queue-actions">
                <button className="btn btn-primary btn-sm" onClick={confirmAllReady} disabled={confirmingAll || readyCount === 0}>
                  {confirmingAll ? "Confirming…" : "Confirm all ready (" + readyCount + ")"}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={rePair}>Re-pair</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setStage("select")}>Add more</button>
              </div>
            </div>

            <div className="queue-list">
              {rows.map((r) => (
                <QueueRow
                  key={r.id}
                  row={r}
                  busy={busyRowId === r.id}
                  onOpen={() => setConfirmRow(r)}
                  onRetry={() => retryRow(r)}
                  onSkip={() => skipRow(r)}
                  onSwap={() => swapRow(r)}
                />
              ))}
            </div>
          </React.Fragment>
        )}

        <div className="form-actions">
          <button className="btn btn-ghost" onClick={props.onDone}>Done</button>
        </div>
      </div>
    );
  }

  // ---- render: pair stage ----
  if (stage === "pair") {
    return (
      <div className="add-body">
        <p className="add-note">Photos pair up in order: front, back, front, back… If the first photo is actually a back, flip the offset.</p>
        <div className="pair-controls">
          <button className={"chip" + (offset === 0 ? " chip-on" : "")} onClick={() => setOffset(0)}>Starts with a front</button>
          <button className={"chip" + (offset === 1 ? " chip-on" : "")} onClick={() => setOffset(1)}>First photo is a back</button>
        </div>

        <div className="pair-summary">
          {photoList.length} photos → <strong>{fullPairs.length} cards</strong>
          {oddTail ? <span className="pair-warn"> · odd count — the last photo has no back and will be skipped</span> : null}
        </div>

        <div className="strip">
          {photoList.map((p, i) => {
            const inPair = i - offset;
            const role = inPair < 0 ? "skip" : inPair % 2 === 0 ? "front" : "back";
            return (
              <div key={i} className={"strip-item strip-" + role}>
                <img src={p.previewUrl} alt="" />
                <span className="strip-role">{role === "skip" ? "—" : role === "front" ? "F" : "B"}</span>
                <button className="strip-x" onClick={() => removePhoto(i)} aria-label="Remove"><CV.Icons.Close size={14} /></button>
              </div>
            );
          })}
        </div>

        {err ? <div className="form-error">{err}</div> : null}
        <div className="form-actions">
          <button className="btn btn-ghost" onClick={() => setStage("select")}>Back</button>
          <button className="btn btn-primary" onClick={processBatch} disabled={uploading || !fullPairs.length}>
            Process {photoList.length} photos → {fullPairs.length} cards
          </button>
        </div>
      </div>
    );
  }

  // ---- render: select stage ----
  return (
    <div className="add-body">
      <p className="add-note">Shoot each card front then back, in order, and select them all here. Claude reads each one; you confirm from the queue.</p>
      {rows.length ? (
        <button className="btn btn-ghost bulk-resume" onClick={() => setStage("queue")}>
          Open review queue ({rows.length} pending)
        </button>
      ) : null}

      <label htmlFor="bulk-files" className="bulk-drop">
        <CV.Icons.Camera size={30} />
        <span>{photoList.length ? photoList.length + " photos selected — add more" : "Select photos"}</span>
      </label>
      <input
        id="bulk-files"
        className="visually-hidden"
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {processing ? <div className="add-note">Processing photos…</div> : null}
      {photoList.length ? (
        <React.Fragment>
          <div className="strip strip-compact">
            {photoList.map((p, i) => (
              <div key={i} className="strip-item">
                <img src={p.previewUrl} alt="" />
                <button className="strip-x" onClick={() => removePhoto(i)} aria-label="Remove"><CV.Icons.Close size={14} /></button>
              </div>
            ))}
          </div>
          <div className="form-actions">
            <button className="btn btn-ghost" onClick={() => setPhotoList([])}>Clear</button>
            <button className="btn btn-primary" onClick={() => setStage("pair")} disabled={processing}>
              Next: pair &amp; review
            </button>
          </div>
        </React.Fragment>
      ) : (
        <div className="form-actions">
          <button className="btn btn-ghost" onClick={props.onCancel}>Cancel</button>
        </div>
      )}
    </div>
  );
};

function dupCandidate(row) {
  const f = row.aiSuggested || {};
  return {
    id: row.id,
    year: f.year != null ? Number(f.year) : null,
    brand: f.brand,
    set: f.set,
    cardNumber: f.cardNumber,
    parallel: f.parallel,
    graded: !!f.graded,
  };
}

function QueueRow(props) {
  const r = props.row;
  const status = r.status;
  const thumb = r.photos && r.photos.front && r.photos.front.thumbUrl;
  const f = r.aiSuggested || {};
  const title = f.player || (status === "error" ? "Couldn't read" : status === "uploaded" || status === "analyzing" ? "Analyzing…" : "Unknown");
  const sub = [f.year, f.brand, f.set].filter(Boolean).join(" ") || (r.error ? r.error : "");
  const working = status === "uploaded" || status === "analyzing";

  return (
    <div className={"queue-row queue-" + status}>
      <div className="queue-thumb">
        {thumb ? <img src={thumb} alt="" /> : <div className="queue-thumb-empty" />}
      </div>
      <button className="queue-main" onClick={props.onOpen} disabled={working}>
        <div className="queue-title">{title}</div>
        <div className="queue-sub">{sub}</div>
      </button>
      <div className="queue-side">
        <StatusPill status={status} />
        <div className="queue-row-actions">
          {status === "error" || status === "uploaded" ? (
            <button className="btn btn-ghost btn-xs" onClick={props.onRetry} disabled={props.busy}>Retry</button>
          ) : null}
          {status === "check" || status === "ready" ? (
            <button className="btn btn-ghost btn-xs" onClick={props.onSwap} disabled={props.busy} title="Swap front/back and re-read">Swap</button>
          ) : null}
          <button className="btn btn-ghost btn-xs" onClick={props.onSkip} disabled={props.busy}>Skip</button>
        </div>
      </div>
    </div>
  );
}

function StatusPill(props) {
  const map = {
    uploaded: { t: "working", cls: "pill-working" },
    analyzing: { t: "working", cls: "pill-working" },
    ready: { t: "ready", cls: "pill-ready" },
    check: { t: "check", cls: "pill-check" },
    error: { t: "error", cls: "pill-error" },
  };
  const s = map[props.status] || { t: props.status, cls: "" };
  return <span className={"pill " + s.cls}>{s.t}</span>;
}
