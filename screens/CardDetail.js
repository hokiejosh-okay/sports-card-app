// screens/CardDetail.js — card detail (spec §3): image flip, badges, value bar with
// the value-vs-paid delta, the Phase 4 "Market price" block (The Card API median,
// Refresh price, differs chip), eBay sold-comps link + graded-value link row
// (with market values per grade) + the "update value" affordance (spec §8, §11
// Phase 2), details, autosaving notes, edit, and delete.
window.CV = window.CV || {};

CV.CardDetail = function CardDetail(props) {
  const { useState, useEffect } = React;
  const card = props.card;

  const [side, setSide] = useState("front");
  // Photo rotation (spec §3). imgBust holds a freshly-rotated, cache-busted URL
  // per side so an overwritten Storage object (same download token) still shows
  // the rotated image immediately, without a hard reload.
  const [rotating, setRotating] = useState(false);
  const [rotateErr, setRotateErr] = useState("");
  const [imgBust, setImgBust] = useState({});
  const [notes, setNotes] = useState(card.notes || "");
  const [notesState, setNotesState] = useState("idle"); // idle | saving | saved
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState("");

  // "Update value" affordance (spec §11 Phase 2).
  const [valueOpen, setValueOpen] = useState(false);
  const [valueInput, setValueInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [savingValue, setSavingValue] = useState(false);
  const [valueErr, setValueErr] = useState("");

  useEffect(() => {
    setNotes(card.notes || "");
    setSide("front");
    setDeleteErr("");
    setRotateErr("");
    setImgBust({});
  }, [card.id]);

  // Displayed source: prefer a freshly-rotated cache-busted URL for this side.
  const storedUrl = card.photos && card.photos[side] ? card.photos[side].url : null;
  const img = imgBust[side] || storedUrl;

  // Rotate the CURRENTLY VISIBLE side 90° CW: re-encode full + thumb from a
  // rotated canvas, re-upload to the SAME Storage paths, then write the full
  // photos map back (replacing only this side's url/thumbUrl, keeping both paths
  // and the other side intact) so the rules' whole-doc validation still passes.
  async function rotateSide() {
    if (rotating) return;
    const cur = (card.photos && card.photos[side]) || {};
    const srcUrl = imgBust[side] || cur.url;
    if (!srcUrl) return;
    setRotating(true);
    setRotateErr("");
    try {
      const { fullBlob, thumbBlob } = await CV.images.rotate(srcUrl, 90);
      const uid = CV.auth.currentUser.uid;
      const uploaded = await CV.uploadCardImage(uid, card.id, side, fullBlob, thumbBlob);
      const p = card.photos || {};
      const nextSide = Object.assign({}, p[side] || {}, {
        url: uploaded.url,
        thumbUrl: uploaded.thumbUrl,
      });
      const nextPhotos = Object.assign({}, p, { [side]: nextSide });
      await CV.updateCard(card.id, { photos: nextPhotos });
      // Overwriting a Storage object can keep the same download token, so the
      // <img> src would be byte-identical and the browser would serve the cached
      // (un-rotated) image. Cache-bust the freshly returned URL to force a reload.
      const busted = uploaded.url + (uploaded.url.indexOf("?") >= 0 ? "&" : "?") + "r=" + Date.now();
      setImgBust((m) => Object.assign({}, m, { [side]: busted }));
    } catch (e) {
      setRotateErr(
        e && e.name === "SecurityError"
          ? "Couldn't rotate — the image bucket is blocking canvas access (CORS). One-time fix needed on the Storage bucket."
          : (e && e.message) || "Couldn't rotate the image. Try again."
      );
    } finally {
      setRotating(false);
    }
  }
  const isGraded = !!card.graded;
  // eBay sold-comps deep links, built live from the card's current attributes so
  // they stay correct even for cards saved before compsUrl existed (spec §8).
  const comps = CV.getComps(card);
  const ownGradeTerm = CV.comps.gradeTermOf(card);

  async function saveNotes() {
    if ((card.notes || "") === notes) return;
    setNotesState("saving");
    try {
      await CV.updateCard(card.id, { notes: notes });
      setNotesState("saved");
      setTimeout(() => setNotesState("idle"), 1500);
    } catch (e) {
      setNotesState("idle");
    }
  }

  async function doDelete() {
    setDeleting(true);
    setDeleteErr("");
    try {
      await CV.deleteCard(card);
      props.onDeleted && props.onDeleted();
    } catch (e) {
      // Same inline pattern as the value/save errors — no browser alert.
      setDeleting(false);
      setConfirmDelete(false);
      setDeleteErr("Delete failed. Check your connection and try again.");
    }
  }

  function openValue() {
    const v = card.estimatedValue;
    setValueInput(v != null && !isNaN(Number(v)) ? String(v) : "");
    setNoteInput("");
    setValueErr("");
    setValueOpen(true);
  }

  async function saveValue() {
    const raw = String(valueInput).trim();
    const v = Number(raw);
    if (raw === "" || isNaN(v) || v < 0) {
      setValueErr("Enter a dollar amount of 0 or more.");
      return;
    }
    setSavingValue(true);
    setValueErr("");
    try {
      // One write path: bumps the card value + appends a valueHistory snapshot
      // with valueSource "manual" (spec §5, §11). The realtime listener refreshes
      // the detail, grid, and collection total without a reload.
      await CV.updateCardValue(card.id, { value: v, compsUrl: comps.primaryUrl, note: noteInput });
      setValueOpen(false);
    } catch (e) {
      setValueErr((e && e.message) || "Couldn't save. Check your connection and try again.");
    } finally {
      setSavingValue(false);
    }
  }

  const value = card.estimatedValue;
  const paid = card.acquisition && card.acquisition.pricePaid;
  const hasDelta = value != null && !isNaN(Number(value)) && paid != null && !isNaN(Number(paid));
  const delta = hasDelta ? Number(value) - Number(paid) : 0;

  // Value sparkline (spec §5, Phase 3): only when the card has ≥2 snapshots.
  const history = props.history || [];
  const showSpark = history.length >= 2;

  return (
    <div className="screen detail">
      <header className="sub-header">
        <button className="icon-btn" onClick={props.onBack} aria-label="Back">
          <CV.Icons.Back size={22} />
        </button>
        <h2 className="sub-title ellipsis">{card.player}</h2>
        <div className="header-actions">
          <button className="icon-btn" onClick={() => props.onEdit(card)} aria-label="Edit">
            <CV.Icons.Pencil size={20} />
          </button>
          <button className="icon-btn" onClick={() => setMenuOpen((m) => !m)} aria-label="More">
            <CV.Icons.More size={20} />
          </button>
          {menuOpen ? (
            <div className="menu" onMouseLeave={() => setMenuOpen(false)}>
              <button
                className="menu-item menu-danger"
                onClick={() => {
                  setMenuOpen(false);
                  setDeleteErr("");
                  setConfirmDelete(true);
                }}
              >
                <CV.Icons.Trash size={16} /> Delete card
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <div className="detail-body">
        {deleteErr ? <div className="form-error">{deleteErr}</div> : null}

        {/* Image + flip */}
        <div className={"detail-img-wrap" + (isGraded ? " detail-slab" : "")}>
          {isGraded ? (
            <div className="slab-strip slab-strip-lg">
              {(card.grading && card.grading.company) || "GRADED"}{" "}
              {card.grading && card.grading.grade != null ? card.grading.grade : ""}
              {card.grading && card.grading.gradeLabel ? " · " + card.grading.gradeLabel : ""}
            </div>
          ) : null}
          <div className="detail-img-stage">
            {img ? (
              <img src={img} alt={card.player + " " + side} className="detail-img" />
            ) : (
              <div className="detail-img placeholder">No image</div>
            )}
            {img ? (
              <button
                type="button"
                className="rotate-btn"
                onClick={rotateSide}
                disabled={rotating}
                aria-label={"Rotate " + side + " 90 degrees"}
                title="Rotate 90°"
              >
                <CV.Icons.Rotate size={18} />
              </button>
            ) : null}
          </div>
          {rotateErr ? <div className="form-error rotate-err">{rotateErr}</div> : null}
          <div className="flip-tabs">
            <button className={"flip-tab" + (side === "front" ? " flip-on" : "")} onClick={() => setSide("front")}>
              Front
            </button>
            <button className={"flip-tab" + (side === "back" ? " flip-on" : "")} onClick={() => setSide("back")}>
              Back
            </button>
          </div>
        </div>

        {/* Title */}
        <div className="detail-title-block">
          <div className="detail-title">{CV.fmt.titleLine(card)}</div>
          <div className="detail-player">{card.player}</div>
          {card.subset ? <div className="detail-subset">{card.subset}</div> : null}
        </div>

        {/* Badges */}
        <CV.BadgeRow card={card} />

        {/* Value bar */}
        <div className="value-bar">
          <div className="value-main">
            <div className="value-label">Est. value</div>
            <div className="value-amount">{CV.fmt.money(value)}</div>
            {showSpark ? (
              <div className="value-spark" aria-hidden="false">
                <CV.Charts.Sparkline points={history} />
              </div>
            ) : null}
          </div>
          <div className="value-side">
            {hasDelta ? (
              <span className={"delta-chip " + (delta >= 0 ? "delta-up" : "delta-down")}>
                {delta >= 0 ? "▲ " : "▼ "}
                {CV.fmt.money(Math.abs(delta))}
              </span>
            ) : null}
            <div className="value-paid">
              {paid != null && !isNaN(Number(paid)) ? "Paid " + CV.fmt.money(paid) : "No paid record"}
            </div>
          </div>
        </div>
        {/* Market price (Phase 4): The Card API median, refresh, differs chip. */}
        <MarketPriceBlock card={card} />

        {/* Comps + graded-value links + update-value affordance (spec §8, §11 Phase 2) */}
        <div className="value-tools">
          <div className="comps-row">
            <a className="btn btn-comps" href={comps.primaryUrl} target="_blank" rel="noopener noreferrer">
              <CV.Icons.External size={16} /> View sold on eBay
            </a>
            <button className="btn btn-update-value" onClick={openValue}>
              Update value
            </button>
          </div>

          <div className="graded-block">
            <div className="graded-block-head">If graded — value by grade</div>
            <div className="graded-links">
              {comps.gradedLinks.map((g) => {
                // Market value beside each grade (Phase 4): the weekly graded
                // previews, or the card's own apiValue for its own slab grade.
                const gv = card.apiGradedValues || {};
                const mv = gv[g.label] != null ? gv[g.label] : g.label === ownGradeTerm ? card.apiValue : null;
                return (
                  <a key={g.label} className="graded-link" href={g.url} target="_blank" rel="noopener noreferrer">
                    {g.label}
                    {mv != null && !isNaN(Number(mv)) ? <span className="graded-link-value">{CV.fmt.moneyAuto(mv)}</span> : null}
                  </a>
                );
              })}
            </div>
          </div>

          {card.valueUpdatedAt ? (
            <div className="value-updated">
              Value updated {CV.fmt.date(card.valueUpdatedAt)}
              {card.valueSource ? " · " + (card.valueSource === "api" ? "market price" : card.valueSource) : ""}
            </div>
          ) : null}
        </div>

        {/* Re-analyze: run Claude vision on the card's existing photos to fill any
            still-empty identity fields. Neutral action (never gold). */}
        <div className="detail-ai">
          <button className="btn btn-analyze" onClick={() => props.onReanalyze && props.onReanalyze(card)}>
            <CV.Icons.Sparkle size={16} /> Analyze with AI
          </button>
        </div>

        {/* Details spec list */}
        <div className="detail-section">
          <div className="section-head">Details</div>
          {/* Bulk "Save all" saved this card with low-confidence AI fields nobody
              has checked yet (aiUnreviewed). Neutral, never gold; cleared by a
              save in Edit. */}
          {Array.isArray(card.aiUnreviewed) && card.aiUnreviewed.length ? (
            <div className="ai-unsure-note">
              AI unsure: {card.aiUnreviewed.map(CV.fmt.aiFieldLabel).join(", ")} — review in Edit
            </div>
          ) : null}
          <dl className="spec-list">
            <Spec label="Sport" value={CV.lists.sportLabel(card.sport)} />
            <Spec label="Team" value={card.team} />
            <Spec label="Set" value={[card.year, card.brand, card.set].filter(Boolean).join(" ")} />
            <Spec label="Subset" value={card.subset} />
            <Spec label="Parallel" value={card.parallel} />
            <Spec label="Card #" value={card.cardNumber} mono />
            <Spec label="Serial #" value={card.serialNumber} mono />
            {isGraded ? (
              <React.Fragment>
                <Spec label="Grade" value={CV.fmt.gradeTag(card) + (card.grading && card.grading.gradeLabel ? " · " + card.grading.gradeLabel : "")} />
                <Spec label="Cert #" value={card.grading && card.grading.certNumber} mono />
              </React.Fragment>
            ) : (
              <Spec label="Condition" value={card.condition} />
            )}
            <Spec label="Quantity" value={card.quantity} />
            <Spec label="Acquired" value={card.acquisition && CV.fmt.date(card.acquisition.date)} />
            <Spec label="Source" value={card.acquisition && card.acquisition.source} />
            <Spec label="Paid" value={card.acquisition && card.acquisition.pricePaid != null ? CV.fmt.money2(card.acquisition.pricePaid) : null} />
            {card.additionalPlayers && card.additionalPlayers.length ? (
              <Spec label="Also on card" value={card.additionalPlayers.join(", ")} />
            ) : null}
          </dl>
        </div>

        {/* Notes */}
        <div className="detail-section">
          <div className="section-head">
            My notes
            {notesState === "saving" ? <span className="notes-state"> saving…</span> : null}
            {notesState === "saved" ? <span className="notes-state notes-saved"> saved ✓</span> : null}
          </div>
          <textarea
            className="input textarea"
            rows="4"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={saveNotes}
            placeholder="Add a note…"
          />
        </div>
      </div>

      <CV.Modal
        open={valueOpen}
        title="Update value"
        onClose={savingValue ? function () {} : () => setValueOpen(false)}
      >
        <p className="modal-msg">
          Check recent{" "}
          <a className="inline-link" href={comps.primaryUrl} target="_blank" rel="noopener noreferrer">
            sold comps on eBay
          </a>
          , then record what this card is worth today. It's saved to your value history.
        </p>
        <div className="field">
          <label className="field-label">Est. value ($)</label>
          <input
            className="input"
            inputMode="decimal"
            value={valueInput}
            autoFocus
            onChange={(e) => setValueInput(e.target.value)}
            placeholder="e.g. 120"
          />
        </div>
        <div className="field modal-field">
          <label className="field-label">
            Note <span className="field-hint">optional</span>
          </label>
          <input
            className="input"
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            placeholder="e.g. based on 3 recent PSA 9 sales"
          />
        </div>
        {valueErr ? <div className="form-error">{valueErr}</div> : null}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={() => setValueOpen(false)} disabled={savingValue}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={saveValue} disabled={savingValue}>
            {savingValue ? "Saving…" : "Save value"}
          </button>
        </div>
      </CV.Modal>

      <CV.ConfirmDialog
        open={confirmDelete}
        title="Delete this card?"
        message="This permanently removes the card and both photos. This can’t be undone."
        confirmLabel="Delete"
        danger
        busy={deleting}
        onConfirm={doDelete}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
};

function Spec(props) {
  const v = props.value;
  if (v === null || v === undefined || v === "" || v === "—") return null;
  return (
    <div className="spec-row">
      <dt className="spec-label">{props.label}</dt>
      <dd className={"spec-value" + (props.mono ? " mono" : "")}>{v}</dd>
    </div>
  );
}

// Phase 4 "Market price" block, under the value bar. Shows the Card API median
// (gold — it's money), "n sales · last sold <date> · <low>–<high>", a "Low
// sample" tag under PRICE_LOW_SAMPLE sales, the differs chip with "Use market
// price" / "Keep mine", and a neutral Refresh price button with loading, error
// and cooldown states. Everything it shows comes from the card doc; the
// callable writes and the cards listener re-renders.
function MarketPriceBlock(props) {
  const { useState, useEffect } = React;
  const card = props.card;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [acting, setActing] = useState(""); // "" | "use" | "keep"
  const [nowMs, setNowMs] = useState(Date.now());

  const left = CV.fmt.refreshCooldownLeft(card, nowMs);
  const cooling = left > 0;
  // Tick while cooling down so the label counts down and the button re-enables.
  useEffect(() => {
    if (!cooling) return;
    const t = setInterval(() => setNowMs(Date.now()), 15000);
    return () => clearInterval(t);
  }, [cooling, card.id]);
  useEffect(() => {
    setErr("");
    setNowMs(Date.now());
  }, [card.id]);

  const hasApi = card.apiValue != null && !isNaN(Number(card.apiValue));
  const looked = !!card.apiValueUpdatedAt;
  const meta = card.apiValueMeta || {};
  const n = CV.fmt.apiSampleSize(card);
  const differs = CV.fmt.priceDiffers(card);

  async function refresh() {
    if (busy || cooling) return;
    setBusy(true);
    setErr("");
    try {
      await CV.callRefreshCardPrice(card.id);
    } catch (e) {
      const code = String((e && e.code) || "").replace(/^functions\//, "");
      if (code === "failed-precondition") setErr((e && e.message) || "Refreshed recently — try again shortly.");
      else if (code === "resource-exhausted") setErr("Today's price lookups are used up. Try again tomorrow.");
      else if (code === "permission-denied") setErr("You can't refresh this card.");
      else if (code === "not-found" || code === "unimplemented") setErr("Price lookup isn't set up yet.");
      else setErr("Couldn't refresh the price. Try again later.");
    } finally {
      setBusy(false);
      setNowMs(Date.now());
    }
  }

  async function act(kind) {
    if (acting) return;
    setActing(kind);
    setErr("");
    try {
      if (kind === "use") await CV.acceptMarketPrice(card);
      else await CV.dismissApiValue(card.id, card.apiValue);
    } catch (e) {
      setErr("Couldn't save. Check your connection and try again.");
    } finally {
      setActing("");
    }
  }

  let btnLabel = "Refresh price";
  if (busy) btnLabel = "Refreshing…";
  else if (cooling) btnLabel = "Again in " + Math.max(1, Math.ceil(left / 60000)) + " min";

  return (
    <div className="market-block">
      <div className="market-head">
        <span className="market-label">Market price</span>
        {hasApi && CV.fmt.apiLowSample(card) ? <span className="market-tag">Low sample</span> : null}
        {differs ? <span className="market-tag market-tag-differs">Differs from yours</span> : null}
      </div>

      {hasApi ? (
        <React.Fragment>
          <div className="market-amount">{CV.fmt.moneyAuto(card.apiValue)}</div>
          <div className="market-meta">
            {n} sale{n === 1 ? "" : "s"}
            {meta.lastSaleAt ? " · last sold " + CV.fmt.date(meta.lastSaleAt) : ""}
            {meta.low != null && meta.high != null && n > 1
              ? " · " + CV.fmt.moneyAuto(meta.low) + "–" + CV.fmt.moneyAuto(meta.high)
              : ""}
          </div>
        </React.Fragment>
      ) : (
        <div className="market-empty">
          {looked ? "No recent sales yet" : "Not checked yet — tap Refresh price"}
        </div>
      )}

      {differs ? (
        <div className="market-differs">
          <div className="market-differs-text">
            Yours <span className="market-money">{CV.fmt.moneyAuto(card.estimatedValue)}</span> · market{" "}
            <span className="market-money">{CV.fmt.moneyAuto(card.apiValue)}</span>
          </div>
          <div className="market-actions">
            <button className="btn btn-sm" onClick={() => act("use")} disabled={!!acting}>
              {acting === "use" ? "Saving…" : "Use market price"}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => act("keep")} disabled={!!acting}>
              {acting === "keep" ? "Saving…" : "Keep mine"}
            </button>
          </div>
        </div>
      ) : null}

      {err ? <div className="form-error market-err">{err}</div> : null}

      <div className="market-foot">
        <span className="market-checked">{looked ? "Checked " + CV.fmt.date(card.apiValueUpdatedAt) : ""}</span>
        <button className="btn btn-sm btn-refresh" onClick={refresh} disabled={busy || cooling}>
          <CV.Icons.Refresh size={15} /> {btnLabel}
        </button>
      </div>
    </div>
  );
}
