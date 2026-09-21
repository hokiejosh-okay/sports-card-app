// screens/ReanalyzeBulk.js — "Analyze all" bulk re-analyze (builds on PR #3).
// Runs Claude vision across every card that has no AI pass yet (aiSuggested
// absent/null), reusing the UNCHANGED intake pipeline: for each un-analyzed card
// create a TRANSIENT intake row whose photos are COPIED (paths + URLs) from the
// card and marked reanalyzeOf:<card id>, so the analyzeIntakeOnCreate trigger
// reads the SAME Storage objects server-side (no re-upload, and the batch keeps
// running even if the phone sleeps). Confident results (status "ready") auto-
// apply headlessly through the strict only-empty merge (CV.saveReanalyzeFromAI)
// and the row DOC is deleted; low-confidence ("check") or errored rows stay in a
// review queue Josh signs off with the SAME PR #3 confirm form
// (CV.ReanalyzeConfirm). Doc-only cleanup — the photos belong to the cards and
// are NEVER deleted here. Resumable: reopening picks up any still-active
// reanalyzeOf rows and keeps applying/surfacing them (spec §11 Phase 1, PR #3).
window.CV = window.CV || {};

// Intake statuses that keep a re-analyze row "active" (mirrors BULK_ACTIVE).
const REANALYZE_ACTIVE = ["uploaded", "analyzing", "ready", "check", "error"];

// Local Timestamp→ms helper (uniquely named to avoid clashing with the
// top-level `tsms` in BulkUpload.js — Babel scripts share one global scope).
function rbTsms(v) {
  if (!v) return 0;
  if (v.toMillis) return v.toMillis();
  if (v.seconds) return v.seconds * 1000;
  const d = new Date(v);
  return isNaN(d) ? 0 : d.getTime();
}

CV.ReanalyzeBulk = function ReanalyzeBulk(props) {
  const { useState, useEffect, useRef } = React;

  const [rows, setRows] = useState([]);
  const [booted, setBooted] = useState(false); // first intake snapshot seen
  const [starting, setStarting] = useState(!!props.start); // batch-create running
  const [reviewRow, setReviewRow] = useState(null);
  const [err, setErr] = useState("");

  const startedRef = useRef(false); // batch-create has been kicked off once
  const applyingRef = useRef({}); // row ids currently auto-applying / cleaning up
  const cardsRef = useRef(props.cards);
  cardsRef.current = props.cards;

  // ---- listen to the user's active reanalyzeOf rows (resumable queue) ----
  useEffect(() => {
    const uid = CV.auth.currentUser.uid;
    const unsub = CV.listenIntake(
      uid,
      (all) => {
        const active = all
          // ONLY re-analyze rows (reanalyzeOf set) that are still in flight.
          .filter((r) => r.reanalyzeOf && REANALYZE_ACTIVE.indexOf(r.status) >= 0)
          .sort(
            (a, b) =>
              rbTsms(a.createdAt) - rbTsms(b.createdAt) || (a.sequence || 0) - (b.sequence || 0)
          );
        setRows(active);
        if (!booted) setBooted(true);
        // Kick the batch off ONCE, only after the first snapshot so we can dedupe
        // against rows a previous open (or a double-tap) already created.
        if (props.start && !startedRef.current) {
          startedRef.current = true;
          beginBatch(active);
        }
      },
      (e) => {
        console.error("reanalyze intake listener", e);
        setBooted(true);
        setStarting(false);
      }
    );
    return () => unsub();
    // eslint-disable-next-line
  }, []);

  // ---- batch create: one transient intake row per un-analyzed card ----
  async function beginBatch(activeRows) {
    const cards = cardsRef.current || [];
    // Dedupe: never queue a card that already has an active reanalyzeOf row
    // (double-tap "Analyze all", a re-open, or a still-in-flight card).
    const activeCardIds = {};
    (activeRows || []).forEach((r) => {
      if (r.reanalyzeOf) activeCardIds[r.reanalyzeOf] = true;
    });
    const targets = cards.filter(
      (c) =>
        c.aiSuggested == null && // un-analyzed only
        c.photos &&
        c.photos.front &&
        c.photos.front.path &&
        c.photos.back &&
        c.photos.back.path &&
        !activeCardIds[c.id]
    );
    if (!targets.length) {
      setStarting(false);
      return;
    }
    const uid = CV.auth.currentUser.uid;
    // ONE shared batchId for the whole run, computed ONCE before the pool — not
    // per row (known-issue #3: per-row Date.now() scatters one upload across many
    // batch ids).
    const batchId = "reanalyze-" + Date.now();
    try {
      // At most 3 rows created at a time; the onCreate trigger analyzes each
      // server-side. Keep the pool at 3 — every analysis is a billable call.
      await CV.ai.runPool(
        targets,
        async (card, i) => {
          const id = CV.newIntakeId();
          await CV.createIntake(id, {
            ownerId: uid,
            batchId: batchId,
            sequence: i,
            // Photos copied verbatim from the card — same Storage paths, no re-upload.
            photos: { front: card.photos.front, back: card.photos.back },
            status: "uploaded",
            sideCheck: null,
            aiSuggested: null,
            aiConfidence: null,
            error: null,
            cardId: null,
            // The marker that keeps this row out of the bulk-ADD queue and off the
            // image-deleting cleanup path (its photos belong to the card).
            reanalyzeOf: card.id,
          });
        },
        3
      );
    } catch (e) {
      setErr(e.message || "Some cards couldn't be queued. Reopen Analyze all to retry.");
    } finally {
      setStarting(false);
    }
  }

  // ---- auto-apply ready rows headlessly; clean up orphans ----
  useEffect(() => {
    if (!props.cardsLoaded) return;
    const byId = {};
    (props.cards || []).forEach((c) => {
      byId[c.id] = c;
    });
    rows.forEach((row) => {
      if (applyingRef.current[row.id]) return;
      const card = byId[row.reanalyzeOf];

      // Target card was deleted while the row was in flight → drop the orphan
      // row DOC ONLY (never its images — they belonged to the card).
      if (!card) {
        applyingRef.current[row.id] = true;
        (async () => {
          try {
            await CV.deleteIntakeRow(row.id);
          } catch (e) {
            /* non-fatal */
          } finally {
            delete applyingRef.current[row.id];
          }
        })();
        return;
      }

      // Confident pass → apply it headlessly, then delete the row DOC.
      if (row.status === "ready") {
        applyingRef.current[row.id] = true;
        (async () => {
          try {
            await CV.saveReanalyzeFromAI(card, row);
            await CV.deleteIntakeRow(row.id);
          } catch (e) {
            // Validation failed on apply → leave it in the queue for review.
            try {
              await CV.updateIntake(row.id, { status: "check" });
            } catch (e2) {
              /* non-fatal */
            }
          } finally {
            delete applyingRef.current[row.id];
          }
        })();
      }
    });
    // eslint-disable-next-line
  }, [rows, props.cards, props.cardsLoaded]);

  // If the card behind an open review vanished, back out to the queue.
  const reviewCard =
    reviewRow ? (props.cards || []).find((c) => c.id === reviewRow.reanalyzeOf) : null;
  useEffect(() => {
    if (reviewRow && props.cardsLoaded && !reviewCard) setReviewRow(null);
    // eslint-disable-next-line
  }, [reviewRow, reviewCard, props.cardsLoaded]);

  // ---- per-row review actions (reuse PR #3's confirm form) ----
  async function onReviewSaved() {
    const row = reviewRow;
    setReviewRow(null);
    if (row) {
      try {
        await CV.deleteIntakeRow(row.id); // the edit already updated the card
      } catch (e) {
        /* non-fatal */
      }
    }
  }
  async function onReviewRetry() {
    const row = reviewRow;
    setReviewRow(null);
    if (row) {
      try {
        await CV.callAnalyzeIntake(row.id); // listener surfaces the new status
      } catch (e) {
        /* listener surfaces status:"error" */
      }
    }
  }
  async function skipRow(row) {
    // Skip a queue row: delete the row DOC ONLY, never its images.
    try {
      await CV.deleteIntakeRow(row.id);
    } catch (e) {
      /* non-fatal */
    }
  }

  // ---- render: per-row review (same confirm form as the single flow) ----
  if (reviewRow && reviewCard) {
    return (
      <div className="screen reanalyze-bulk-screen">
        <header className="sub-header">
          <button className="icon-btn" onClick={() => setReviewRow(null)} aria-label="Back to queue">
            <CV.Icons.Back size={22} />
          </button>
          <h2 className="sub-title ellipsis">{reviewCard.player || "Review card"}</h2>
          <span className="icon-btn-spacer" />
        </header>
        <CV.ReanalyzeConfirm
          card={reviewCard}
          intake={reviewRow}
          onRetry={onReviewRetry}
          onCancel={() => setReviewRow(null)}
          onSaved={onReviewSaved}
        />
      </div>
    );
  }

  // ---- render: the queue ----
  const total = rows.length;
  const analyzed = rows.filter((r) => ["ready", "check", "error"].indexOf(r.status) >= 0).length;
  const pct = total ? Math.round((analyzed / total) * 100) : 0;
  const reviewCount = rows.filter((r) => r.status === "check" || r.status === "error").length;

  const byId = {};
  (props.cards || []).forEach((c) => {
    byId[c.id] = c;
  });

  return (
    <div className="screen reanalyze-bulk-screen">
      <header className="sub-header">
        <button className="icon-btn" onClick={props.onDone} aria-label="Back">
          <CV.Icons.Back size={22} />
        </button>
        <h2 className="sub-title ellipsis">Analyze all</h2>
        <span className="icon-btn-spacer" />
      </header>

      <div className="add-body">
        {starting ? (
          <div className="add-note">Queuing cards for analysis…</div>
        ) : null}
        {err ? <div className="form-error">{err}</div> : null}

        {!booted ? (
          <div className="analyzing-state">
            <div className="spinner" />
            <div className="analyzing-title">Loading…</div>
          </div>
        ) : total === 0 && !starting ? (
          <div className="empty">
            <div className="empty-title">All caught up</div>
            <div className="empty-sub">Every card has an AI pass. Nothing left to analyze.</div>
            <button className="btn btn-primary" onClick={props.onDone}>Done</button>
          </div>
        ) : (
          <React.Fragment>
            <p className="add-note">
              Claude fills in only blank fields — your existing values are never changed. Confident cards
              apply automatically; anything it's unsure about waits below for you to confirm.
            </p>
            <div className="queue-head">
              <div className="queue-progress">
                <div className="queue-progress-bar"><span style={{ width: pct + "%" }} /></div>
                <div className="queue-progress-label">
                  {analyzed} of {total} analyzed
                  {reviewCount ? " · " + reviewCount + " to review" : ""}
                </div>
              </div>
            </div>

            <div className="queue-list">
              {rows.map((r) => (
                <RBQueueRow
                  key={r.id}
                  row={r}
                  card={byId[r.reanalyzeOf]}
                  onOpen={() => setReviewRow(r)}
                  onSkip={() => skipRow(r)}
                />
              ))}
            </div>

            <div className="form-actions">
              <button className="btn btn-ghost" onClick={props.onDone}>Done</button>
            </div>
          </React.Fragment>
        )}
      </div>
    </div>
  );
};

// Queue row for the bulk re-analyze screen. Uniquely named (not `QueueRow`,
// which BulkUpload.js already defines at top level) but reuses the same CSS.
function RBQueueRow(props) {
  const r = props.row;
  const card = props.card || {};
  const status = r.status;
  const thumb =
    (r.photos && r.photos.front && r.photos.front.thumbUrl) ||
    (card.photos && card.photos.front && card.photos.front.thumbUrl) ||
    null;
  const title = card.player || "Card";
  const sub = [card.year, card.brand, card.set].filter(Boolean).join(" ");
  const working = status === "uploaded" || status === "analyzing" || status === "ready";
  const canReview = status === "check" || status === "error";

  return (
    <div className={"queue-row queue-" + status}>
      <div className="queue-thumb">
        {thumb ? <img src={thumb} alt="" /> : <div className="queue-thumb-empty" />}
      </div>
      <button className="queue-main" onClick={props.onOpen} disabled={!canReview}>
        <div className="queue-title">{title}</div>
        <div className="queue-sub">{sub}</div>
      </button>
      <div className="queue-side">
        <RBStatusPill status={status} />
        <div className="queue-row-actions">
          {canReview ? (
            <button className="btn btn-ghost btn-xs" onClick={props.onOpen}>Review</button>
          ) : null}
          <button className="btn btn-ghost btn-xs" onClick={props.onSkip}>Skip</button>
        </div>
      </div>
    </div>
  );
}

function RBStatusPill(props) {
  const map = {
    uploaded: { t: "working", cls: "pill-working" },
    analyzing: { t: "working", cls: "pill-working" },
    ready: { t: "applying", cls: "pill-working" },
    check: { t: "review", cls: "pill-check" },
    error: { t: "error", cls: "pill-error" },
  };
  const s = map[props.status] || { t: props.status, cls: "" };
  return <span className={"pill " + s.cls}>{s.t}</span>;
}
