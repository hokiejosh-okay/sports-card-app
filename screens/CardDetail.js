// screens/CardDetail.js — card detail (spec §3). Comps + graded-value + update-value
// affordance arrive in Phase 2; here we show image flip, badges, value bar, details,
// autosaving notes, edit, and delete.
window.CV = window.CV || {};

CV.CardDetail = function CardDetail(props) {
  const { useState, useEffect } = React;
  const card = props.card;

  const [side, setSide] = useState("front");
  const [notes, setNotes] = useState(card.notes || "");
  const [notesState, setNotesState] = useState("idle"); // idle | saving | saved
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setNotes(card.notes || "");
    setSide("front");
  }, [card.id]);

  const img = card.photos && card.photos[side] ? card.photos[side].url : null;
  const isGraded = !!card.graded;

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
    try {
      await CV.deleteCard(card);
      props.onDeleted && props.onDeleted();
    } catch (e) {
      setDeleting(false);
      alert("Delete failed: " + (e.message || e));
    }
  }

  const value = card.estimatedValue;
  const paid = card.acquisition && card.acquisition.pricePaid;
  const hasDelta = value != null && !isNaN(Number(value)) && paid != null && !isNaN(Number(paid));
  const delta = hasDelta ? Number(value) - Number(paid) : 0;

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
        {/* Image + flip */}
        <div className={"detail-img-wrap" + (isGraded ? " detail-slab" : "")}>
          {isGraded ? (
            <div className="slab-strip slab-strip-lg">
              {(card.grading && card.grading.company) || "GRADED"}{" "}
              {card.grading && card.grading.grade != null ? card.grading.grade : ""}
              {card.grading && card.grading.gradeLabel ? " · " + card.grading.gradeLabel : ""}
            </div>
          ) : null}
          {img ? (
            <img src={img} alt={card.player + " " + side} className="detail-img" />
          ) : (
            <div className="detail-img placeholder">No image</div>
          )}
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
        {/* Comps + "if graded" row + update-value affordance land in Phase 2. */}

        {/* Details spec list */}
        <div className="detail-section">
          <div className="section-head">Details</div>
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
