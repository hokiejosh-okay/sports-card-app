// screens/Insights.js — Phase 3 (spec §3, §5): collection value, cost basis,
// unrealized gain, best mover, a 6-month value line, value-by-sport, and CSV
// export. All figures are derived in memory from the loaded cards + value
// histories (pure helpers in lib/format.js). Gold (--accent) is used only for
// money totals and the primary action (CSV export); deltas use --up/--down and
// the value-by-sport bars use neutral tokens (spec §4).
window.CV = window.CV || {};

CV.Insights = function Insights(props) {
  const { useState, useEffect, useCallback } = React;
  const cards = props.cards || [];
  const histories = props.histories || {};

  // "Clear confirmed intake" (PRD §14): confirmed bulk-upload rows have served
  // their purpose. Count them once (queried by ownerId only, filtered in memory
  // — no composite index); the control below deletes the docs (never photos).
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [clearAsk, setClearAsk] = useState(false);
  const [clearing, setClearing] = useState(false);

  const refreshConfirmed = useCallback(() => {
    const u = CV.auth && CV.auth.currentUser;
    if (!u) return;
    CV.countConfirmedIntake(u.uid).then((n) => setConfirmedCount(n), () => {});
  }, []);

  useEffect(() => { refreshConfirmed(); }, [refreshConfirmed]);

  async function doClearConfirmed() {
    const u = CV.auth && CV.auth.currentUser;
    if (!u) return;
    setClearing(true);
    try {
      await CV.clearConfirmedIntake(u.uid);
      refreshConfirmed();
    } catch (e) {
      /* non-fatal; count refresh below reflects reality */
    } finally {
      setClearing(false);
      setClearAsk(false);
    }
  }

  const totals = CV.fmt.collectionTotals(cards);
  const costBasis = CV.fmt.costBasis(cards);
  const gain = CV.fmt.unrealizedGain(cards); // { gain, matched, count }
  const mover = CV.fmt.bestMover(cards);
  const sports = CV.fmt.sportBreakdown(cards);
  const series = CV.fmt.collectionValueSeries(cards, histories, 6);
  // Drop leading months with no recorded value yet so the line starts where the
  // history actually begins (has is monotonic once true), rather than drawing a
  // misleading $0 baseline.
  const seriesPoints = (function () {
    const pts = series.points;
    const first = pts.findIndex((p) => p.has);
    return first <= 0 ? pts : pts.slice(first);
  })();

  const gainClass = gain.gain >= 0 ? "stat-up" : "stat-down";

  return (
    <div className="screen insights">
      <header className="home-header">
        <div className="home-header-top">
          <div className="wordmark">Insights</div>
        </div>
        <div className="home-total">{CV.fmt.money(totals.total)}</div>
        <div className="home-sub">
          {totals.count} card{totals.count === 1 ? "" : "s"} · {totals.valued} of {totals.count} valued
        </div>
      </header>

      {/* Headline money stats. Total + cost basis are money → gold; the gain is
          signed → green/red (spec §4). */}
      <div className="insights-stats">
        <div className="stat-card">
          <div className="stat-label">Cost basis</div>
          <div className="stat-value stat-money">{CV.fmt.money(costBasis)}</div>
          <div className="stat-note">Total paid across cards with a recorded price</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Unrealized gain</div>
          <div className={"stat-value " + gainClass}>
            {gain.gain >= 0 ? "+" : "−"}
            {CV.fmt.money(Math.abs(gain.gain))}
          </div>
          <div className="stat-note">
            {gain.matched > 0
              ? gain.matched +
                " of " +
                gain.count +
                " card" +
                (gain.count === 1 ? "" : "s") +
                " — those with both a value and a paid price"
              : "No cards yet have both a value and a paid price"}
          </div>
        </div>
      </div>

      {/* Best mover */}
      <div className="insights-section">
        <div className="section-head">Best mover</div>
        {mover ? (
          <button className="best-mover" onClick={() => props.onOpen && props.onOpen(mover.card)}>
            <div className="best-mover-main">
              <div className="best-mover-player">{mover.card.player || "Unknown"}</div>
              <div className="best-mover-set">{CV.fmt.setLine(mover.card)}</div>
            </div>
            <span className={"delta-chip " + (mover.gain >= 0 ? "delta-up" : "delta-down")}>
              {mover.gain >= 0 ? "▲ " : "▼ "}
              {CV.fmt.money(Math.abs(mover.gain))}
            </span>
          </button>
        ) : (
          <div className="chart-empty">
            Record a paid price and a value on a card to see your biggest gainer.
          </div>
        )}
      </div>

      {/* 6-month collection value line */}
      <div className="insights-section">
        <div className="section-head">Collection value · last 6 months</div>
        {series.enough ? (
          <div className="chart-wrap">
            <CV.Charts.LineChart series={seriesPoints} />
          </div>
        ) : (
          <div className="chart-empty">
            Not enough history yet. Update a few cards' values over time and the trend line
            will appear here.
          </div>
        )}
      </div>

      {/* Value by sport */}
      <div className="insights-section">
        <div className="section-head">Value by sport</div>
        {sports.length > 0 ? (
          <div className="chart-wrap">
            <CV.Charts.BarBreakdown items={sports} />
          </div>
        ) : (
          <div className="chart-empty">Add values to your cards to see them broken out by sport.</div>
        )}
      </div>

      {/* Clear confirmed intake (PRD §14) — maintenance, shown only when there's
          something to clear. Neutral action (never gold); deletes intake docs
          only, never card photos. */}
      {confirmedCount > 0 ? (
        <div className="insights-section">
          <div className="section-head">Bulk upload cleanup</div>
          <div className="clear-intake">
            <div className="stat-note">
              {confirmedCount} confirmed intake row{confirmedCount === 1 ? "" : "s"} left from bulk
              uploads. Clearing removes only this bookkeeping — your cards and their photos are untouched.
            </div>
            <button className="btn btn-ghost" onClick={() => setClearAsk(true)}>
              Clear confirmed intake
            </button>
          </div>
        </div>
      ) : null}

      {/* CSV export — the screen's primary action (gold, spec §4). Exports ALL
          cards regardless of the Collection filters. */}
      <div className="insights-export">
        <button
          className="btn btn-primary"
          onClick={() => CV.csv.exportCollection(cards)}
          disabled={cards.length === 0}
        >
          <CV.Icons.External size={16} /> Export collection to CSV
        </button>
        <div className="stat-note">
          {cards.length} card{cards.length === 1 ? "" : "s"} · opens in Excel or Google Sheets
        </div>
      </div>

      <CV.ConfirmDialog
        open={clearAsk}
        title={"Clear " + confirmedCount + " confirmed intake row" + (confirmedCount === 1 ? "" : "s") + "?"}
        message={
          "This deletes the bulk-upload bookkeeping for cards you've already confirmed. Your cards and " +
          "their photos are NOT affected, and re-analyze rows are left alone."
        }
        confirmLabel="Clear"
        busy={clearing}
        onConfirm={doClearConfirmed}
        onClose={() => setClearAsk(false)}
      />
    </div>
  );
};
