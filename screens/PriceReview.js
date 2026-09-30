// screens/PriceReview.js — Phase 4 market-price review. Lists every card whose
// manual value differs from the market median (CV.fmt.priceDiffers: manual,
// ≥2 sales, >15% AND >$2 apart, not dismissed) — mine vs market side by side —
// with "Use market price" (CV.acceptMarketPrice → CV.updateCardValue with
// source "api": value + "api" snapshot, and the card is handed to the nightly
// refresh) and "Keep mine" (CV.dismissApiValue → top-level apiDismissedValue;
// the flag re-arms only if the market moves >15% from it). The list is derived
// in memory from the live cards, so a card drops off as soon as its write lands.
// Buttons are neutral; gold only on the money figures.
window.CV = window.CV || {};

CV.PriceReview = function PriceReview(props) {
  const { useState, useMemo } = React;
  const cards = props.cards || [];
  const [busy, setBusy] = useState({}); // cardId -> "use" | "keep"
  const [errs, setErrs] = useState({}); // cardId -> message

  // Biggest gaps first.
  const flagged = useMemo(
    () =>
      CV.fmt
        .priceDiffersCards(cards)
        .slice()
        .sort(
          (a, b) =>
            Math.abs(Number(b.apiValue) - Number(b.estimatedValue)) -
            Math.abs(Number(a.apiValue) - Number(a.estimatedValue))
        ),
    [cards]
  );

  async function act(card, kind) {
    if (busy[card.id]) return;
    setBusy((m) => Object.assign({}, m, { [card.id]: kind }));
    setErrs((m) => Object.assign({}, m, { [card.id]: "" }));
    try {
      if (kind === "use") await CV.acceptMarketPrice(card);
      else await CV.dismissApiValue(card.id, card.apiValue);
    } catch (e) {
      setErrs((m) => Object.assign({}, m, { [card.id]: "Couldn't save. Check your connection and try again." }));
    } finally {
      setBusy((m) => {
        const next = Object.assign({}, m);
        delete next[card.id];
        return next;
      });
    }
  }

  return (
    <div className="screen price-review">
      <header className="sub-header">
        <button className="icon-btn" onClick={props.onBack} aria-label="Back">
          <CV.Icons.Back size={22} />
        </button>
        <h2 className="sub-title">Market check</h2>
        <span className="icon-btn-spacer" />
      </header>

      {flagged.length === 0 ? (
        <div className="empty">
          <div className="empty-title">All caught up</div>
          <div className="empty-sub">None of your values differ from recent market sales right now.</div>
          <button className="btn" onClick={props.onBack}>Back to collection</button>
        </div>
      ) : (
        <React.Fragment>
          <p className="pr-intro">
            {flagged.length} value{flagged.length === 1 ? "" : "s"} you entered differ from recent sold prices.
            "Use market price" lets the nightly refresh keep the card current; "Keep mine" hides it until the
            market moves.
          </p>
          <div className="pr-list">
            {flagged.map((c) => (
              <PriceReviewRow
                key={c.id}
                card={c}
                busy={busy[c.id] || ""}
                err={errs[c.id] || ""}
                onOpen={() => props.onOpen && props.onOpen(c)}
                onUse={() => act(c, "use")}
                onKeep={() => act(c, "keep")}
              />
            ))}
          </div>
        </React.Fragment>
      )}
    </div>
  );
};

function PriceReviewRow(props) {
  const c = props.card;
  const meta = c.apiValueMeta || {};
  const n = CV.fmt.apiSampleSize(c);
  const thumb = c.photos && c.photos.front ? c.photos.front.thumbUrl || c.photos.front.url : null;
  const line = [CV.fmt.setLine(c), CV.fmt.gradeTag(c)].filter(Boolean).join(" · ");
  return (
    <div className="pr-row">
      <button type="button" className="pr-main" onClick={props.onOpen}>
        {thumb ? <img className="pr-thumb" src={thumb} alt="" /> : <span className="pr-thumb pr-thumb-empty" />}
        <span className="pr-info">
          <span className="pr-player ellipsis">{c.player}</span>
          <span className="pr-line ellipsis">{line}</span>
          <span className="pr-values">
            <span className="pr-val">
              <span className="pr-val-label">Mine</span>
              <span className="pr-money">{CV.fmt.moneyAuto(c.estimatedValue)}</span>
            </span>
            <span className="pr-val">
              <span className="pr-val-label">Market</span>
              <span className="pr-money">{CV.fmt.moneyAuto(c.apiValue)}</span>
            </span>
          </span>
          <span className="pr-meta">
            {n} sale{n === 1 ? "" : "s"}
            {meta.lastSaleAt ? " · last sold " + CV.fmt.date(meta.lastSaleAt) : ""}
            {CV.fmt.apiLowSample(c) ? <span className="market-tag pr-tag">Low sample</span> : null}
          </span>
        </span>
      </button>
      {props.err ? <div className="form-error pr-err">{props.err}</div> : null}
      <div className="pr-actions">
        <button className="btn btn-sm" onClick={props.onUse} disabled={!!props.busy}>
          {props.busy === "use" ? "Saving…" : "Use market price"}
        </button>
        <button className="btn btn-sm btn-ghost" onClick={props.onKeep} disabled={!!props.busy}>
          {props.busy === "keep" ? "Saving…" : "Keep mine"}
        </button>
      </div>
    </div>
  );
}
