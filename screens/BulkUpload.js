// screens/BulkUpload.js — bulk seeding (spec §2, §3, §11 Phase 1).
// Flow: select many photos (shot front, back, front, back…) → pair by sequence
// (offset + remove to fix slips) → upload → a resumable Firestore review queue
// (ready / check / working / error) that the analyzeIntake Function fills
// server-side, with Save all (ready + low-confidence-only rows, the latter
// flagged aiUnreviewed), per-row open→confirm, Retry, Skip, Swap sides, and
// Re-pair.
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
  const [busyRowId, setBusyRowId] = useState(null);
  const [err, setErr] = useState("");
  const bootRef = useRef(false);
  // Save all: dialog summary, loop progress, and a ref lock so a double tap or
  // a re-render mid-loop can never start a second pass over the same rows.
  const [saveAllSummary, setSaveAllSummary] = useState(null); // { total, confident, low, attention, working }
  const [saveProgress, setSaveProgress] = useState(null); // { done, total } while the loop runs
  const savingRef = useRef(false);
  // Latest rows/cards for the loop, which outlives the render it started in.
  const rowsRef = useRef([]);
  const cardsRef = useRef(props.cards || []);
  cardsRef.current = props.cards || [];

  // Resumable queue: listen to the user's active intake rows (spec §11).
  useEffect(() => {
    const uid = CV.auth.currentUser.uid;
    const unsub = CV.listenIntake(
      uid,
      (all) => {
        const active = all
          // Exclude transient re-analyze rows (reanalyzeOf set): they copy an
          // existing card's photo paths, so confirming one here would create a
          // phantom card and Skip would delete the real card's images.
          .filter((r) => BULK_ACTIVE.indexOf(r.status) >= 0 && !r.reanalyzeOf)
          .sort((a, b) => tsms(a.createdAt) - tsms(b.createdAt) || (a.sequence || 0) - (b.sequence || 0));
        rowsRef.current = active;
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
    const batchId = "batch-" + Date.now(); // one id for the whole batch (#3), not per row
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
            batchId: batchId,
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
  // Save all (replaces "Confirm all ready"). Eligibility is decided per row from
  // its CURRENT data (bulkRowPlan), not from status alone: ready rows plus check
  // rows whose only problem is low confidence. Side mismatches, duplicates,
  // validation failures and error rows stay in the queue with a reason.
  function summarizeSaveAll(list, cards) {
    const sum = { total: 0, confident: 0, low: 0, attention: 0, working: 0 };
    list.forEach((r) => {
      const plan = bulkRowPlan(r, cards);
      if (plan.kind === "confident" || plan.kind === "low") {
        sum.total += 1;
        sum[plan.kind] += 1;
      } else sum[plan.kind] += 1;
    });
    return sum;
  }

  function openSaveAll() {
    if (savingRef.current) return;
    const sum = summarizeSaveAll(rowsRef.current, cardsRef.current);
    if (!sum.total) return;
    setSaveAllSummary(sum);
  }

  async function runSaveAll() {
    if (savingRef.current) return; // busy lock: never two loops
    savingRef.current = true;
    setSaveAllSummary(null);
    setErr("");
    const confirmedIds = {};
    try {
      // Snapshot the eligible ids now; each row is re-checked from current data
      // right before its save.
      const ids = rowsRef.current
        .filter((r) => {
          const k = bulkRowPlan(r, cardsRef.current).kind;
          return k === "confident" || k === "low";
        })
        .map((r) => r.id);
      const savedThisRun = []; // so two copies in one batch still count as duplicates
      setSaveProgress({ done: 0, total: ids.length });
      for (let i = 0; i < ids.length; i++) {
        setSaveProgress({ done: i + 1, total: ids.length });
        const row = rowsRef.current.find((r) => r.id === ids[i]);
        if (!row) continue; // skipped or re-paired meanwhile
        const cards = cardsRef.current.concat(savedThisRun);
        const plan = bulkRowPlan(row, cards);
        if (plan.kind !== "confident" && plan.kind !== "low") continue; // stays with its reason
        try {
          // Card id = intake id, so a card that already exists (an earlier save
          // whose bookkeeping didn't land) is never written twice — just close
          // the row.
          if (!plan.alreadySaved) {
            if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error("offline");
            const saved = await bulkWithTimeout(CV.saveCardFromAI(row, { flagLowConfidence: true }), 25000);
            savedThisRun.push(saved);
          }
        } catch (e) {
          // Leave the row in the queue for a look; don't await (offline-safe —
          // the local write updates the listener immediately) and keep going.
          CV.updateIntake(row.id, { status: "check", saveError: bulkSaveErrorReason(e) }).catch(() => {});
          continue;
        }
        try {
          await bulkWithTimeout(CV.updateIntake(row.id, { status: "confirmed", cardId: row.id, saveError: null }), 15000);
          confirmedIds[row.id] = true;
        } catch (e) {
          /* card is saved; the row shows "Already saved" and the next Save all closes it */
        }
      }
    } finally {
      savingRef.current = false;
      setSaveProgress(null);
    }
    // Empty active queue → back to Collection; otherwise stay so leftovers show
    // their reasons. Decided from what this run confirmed, not a stale render.
    const left = rowsRef.current.filter((r) => !confirmedIds[r.id]);
    if (!left.length) props.onDone();
  }

  async function retryRow(row) {
    setBusyRowId(row.id);
    try {
      if (row.saveError) CV.updateIntake(row.id, { saveError: null }).catch(() => {}); // stale once re-read
      await CV.callAnalyzeIntake(row.id);
    } catch (e) {
      /* listener surfaces the error status */
    } finally {
      setBusyRowId(null);
    }
  }

  // Skip = drop the card from the review queue but KEEP the intake doc for
  // AI-accuracy data (KB issue #4). Delete ONLY the Storage images (the review
  // queue no longer needs them) and mark the row status:"discarded" — that value
  // is already in the validIntake enum and already excluded from BULK_ACTIVE, so
  // the row leaves the queue and never reappears (no rules change, no phantom
  // row). Deliberately NOT CV.deleteIntakeAndImages, which also deletes the doc.
  // Scope: the bulk review queue only — single-add / re-analyze paths are unchanged.
  async function discardRow(row) {
    const p = (row && row.photos) || {};
    const paths = [];
    ["front", "back"].forEach((side) => {
      const s = p[side] || {};
      if (s.path) paths.push(s.path);
      if (s.thumbPath) paths.push(s.thumbPath);
    });
    await Promise.all(paths.map((path) => CV.storage.ref(path).delete().catch(() => {})));
    await CV.updateIntake(row.id, { status: "discarded" });
  }

  async function skipRow(row) {
    setBusyRowId(row.id);
    try {
      await discardRow(row);
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
        saveError: null,
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
      // Same discard semantics as the per-row Skip (KB issue #4): keep the doc,
      // delete images, mark discarded.
      await discardRow(row);
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
    const plans = {};
    rows.forEach((r) => {
      plans[r.id] = bulkRowPlan(r, props.cards);
    });
    const saveCount = rows.filter((r) => plans[r.id].kind === "confident" || plans[r.id].kind === "low").length;
    const saving = !!saveProgress;
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
                {saving ? (
                  <button className="btn btn-primary btn-sm" disabled>
                    Saving {saveProgress.done} of {saveProgress.total}…
                  </button>
                ) : saveCount > 0 ? (
                  <button className="btn btn-primary btn-sm" onClick={openSaveAll}>
                    Save all ({saveCount})
                  </button>
                ) : null}
                <button className="btn btn-ghost btn-sm" onClick={rePair} disabled={saving}>Re-pair</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setStage("select")} disabled={saving}>Add more</button>
              </div>
            </div>

            <div className="queue-list">
              {rows.map((r) => (
                <QueueRow
                  key={r.id}
                  row={r}
                  reason={plans[r.id].reason}
                  busy={saving || busyRowId === r.id}
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
          <button className="btn btn-ghost" onClick={props.onDone} disabled={saving}>Done</button>
        </div>

        <CV.ConfirmDialog
          open={!!saveAllSummary}
          title="Save all"
          message={saveAllSummary ? saveAllMessage(saveAllSummary) : ""}
          confirmLabel={saveAllSummary ? "Save " + saveAllSummary.total : "Save"}
          onConfirm={runSaveAll}
          onClose={() => setSaveAllSummary(null)}
        />
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

// Save all eligibility for one queue row, decided from its current data (not
// status alone). kind: "working" (uploaded/analyzing — ignored this pass),
// "confident" | "low" (will be saved; low = has low-confidence keys, flagged
// aiUnreviewed), or "attention" (stays in the queue). reason is the short
// neutral line the row shows; a failed save's saveError wins for check rows.
function bulkRowPlan(row, cards) {
  const st = row.status;
  if (st === "uploaded" || st === "analyzing") return { kind: "working", reason: "" };
  if (st === "error") return { kind: "attention", reason: "Analysis failed" };
  if (st !== "ready" && st !== "check") return { kind: "working", reason: "" };

  const alreadySaved = (cards || []).some((c) => c.id === row.id);
  if (alreadySaved) {
    // An earlier save landed but the row wasn't closed; Save all just closes it.
    return { kind: "confident", reason: "Already saved — Save all will close it", alreadySaved: true };
  }
  const sc = row.sideCheck;
  if (!sc || sc.frontLooksLikeFront === false || sc.backLooksLikeBack === false) {
    return { kind: "attention", reason: "Sides may be swapped" };
  }
  let v;
  try {
    v = CV.validateAIRow(row);
  } catch (e) {
    v = { ok: false, errors: {} };
  }
  if (!v.ok) {
    const er = v.errors || {};
    let reason = "Needs review";
    if (er.player || er.sport) reason = "Needs player/sport";
    else if (er.front || er.back) reason = "Missing a photo";
    else if (er.gradingCompany || er.gradingGrade) reason = "Needs grade";
    else if (er.year) reason = "Check year";
    return { kind: "attention", reason: reason };
  }
  if (CV.findDuplicates(dupCandidate(row), cards).length) {
    return { kind: "attention", reason: "Possible duplicate" };
  }
  const low = CV.lowConfidenceKeys(row.aiConfidence);
  return { kind: low.length ? "low" : "confident", reason: st === "check" && row.saveError ? row.saveError : "" };
}

// Short, neutral reason recorded on a row whose save failed.
function bulkSaveErrorReason(e) {
  const code = (e && e.code) || "";
  const msg = (e && e.message) || "";
  if (msg === "needs-review") return "Needs review";
  if (msg === "offline") return "Offline — try again when connected";
  if (msg === "timeout") return "Timed out — check your connection";
  if (code === "permission-denied") return "Database rejected it — check condition/grade";
  if (code === "unavailable" || code === "deadline-exceeded") return "Network error — try again";
  return ("Save failed" + (msg ? ": " + msg : "")).slice(0, 80);
}

// Reject if a Firestore write hasn't been acknowledged in `ms` (offline writes
// otherwise stay pending forever and would stall the Save all loop).
function bulkWithTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

function saveAllMessage(sum) {
  const parts = [];
  if (sum.confident) parts.push(sum.confident + " confident");
  if (sum.low) parts.push(sum.low + " with low-confidence fields (flagged for review)");
  let msg = "Save " + sum.total + " card" + (sum.total === 1 ? "" : "s") + ": " + parts.join(", ") + ".";
  if (sum.attention) msg += " " + sum.attention + (sum.attention === 1 ? " needs" : " need") + " attention and will stay in the queue.";
  if (sum.working) msg += " " + sum.working + " still analyzing — save " + (sum.working === 1 ? "it" : "them") + " on a later tap.";
  return msg;
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
      <button className="queue-main" onClick={props.onOpen} disabled={working || props.busy}>
        <div className="queue-title">{title}</div>
        <div className="queue-sub">{sub}</div>
        {props.reason ? <div className="queue-reason">{props.reason}</div> : null}
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
