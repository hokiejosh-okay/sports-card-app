// screens/Insights.js — Phase 3 screen. Before Phase 3 it shows a "coming soon" state
// with the current total and count (spec §3).
window.CV = window.CV || {};

CV.Insights = function Insights(props) {
  const totals = CV.fmt.collectionTotals(props.cards);
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

      <div className="coming-soon">
        <div className="coming-title">Insights — coming in Phase 3</div>
        <p>
          Cost basis, unrealized gain, best mover, a 6-month value chart, value-by-sport, and CSV export land
          once value history starts filling in (Phase 2 → Phase 3).
        </p>
      </div>
    </div>
  );
};
