// screens/Collection.js — home: header total, search, filter chips, sort, 2-up grid.
// All filtering/search/sort happens in memory (spec §6).
window.CV = window.CV || {};

CV.Collection = function Collection(props) {
  const { useState, useMemo } = React;
  const cards = props.cards;

  const [query, setQuery] = useState("");
  const [sport, setSport] = useState("all"); // "all" | sport value
  const [gradedOnly, setGradedOnly] = useState(false);
  const [sort, setSort] = useState("date"); // date | value | gain | year | player
  const [dir, setDir] = useState("desc"); // asc | desc — applies to every sort key
  const [reanalyzeAsk, setReanalyzeAsk] = useState(false); // "Analyze all" cost guard

  // "Un-analyzed" = no AI pass yet (aiSuggested absent/null). Computed in memory
  // from the already-loaded cards — no query change, no index (spec §6).
  const unanalyzedCount = useMemo(
    () => cards.filter((c) => c.aiSuggested == null).length,
    [cards]
  );

  // Which sports actually appear, in the controlled order.
  const presentSports = useMemo(() => {
    const set = new Set(cards.map((c) => c.sport).filter(Boolean));
    return CV.lists.sports.filter((s) => set.has(s.value));
  }, [cards]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = cards.filter((c) => {
      if (sport !== "all" && c.sport !== sport) return false;
      if (gradedOnly && !c.graded) return false;
      if (q) {
        const hay = [
          c.player, c.set, c.subset, c.team, c.brand, c.parallel, c.cardNumber,
          c.year != null ? String(c.year) : "",
          (c.additionalPlayers || []).join(" "),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });

    // In-memory sort (spec §6). Every card yields a {has, val} for the active
    // sort key: cards WITHOUT a value for that key (blank value/year, unmatched
    // gain, empty player) always sort LAST, in BOTH directions — the direction
    // toggle only reorders the cards that do have a value.
    list = list.slice().sort((a, b) => {
      const A = sortKey(a, sort);
      const B = sortKey(b, sort);
      if (A.has !== B.has) return A.has ? -1 : 1; // blanks always last
      if (!A.has) return 0;
      let cmp;
      if (typeof A.val === "string") cmp = A.val.localeCompare(B.val);
      else cmp = A.val - B.val;
      return dir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [cards, query, sport, gradedOnly, sort, dir]);

  const totals = CV.fmt.collectionTotals(cards);
  // 30-day header delta from the loaded value histories (spec §5, Phase 3). The
  // chip is hidden when there isn't enough history to anchor a meaningful prior.
  const delta30 = CV.fmt.collectionDelta(cards, props.histories, 30);

  return (
    <div className="screen collection">
      {/* Header */}
      <header className="home-header">
        <div className="home-header-top">
          <div className="wordmark">CardVault</div>
          <button className="theme-btn" onClick={props.onToggleTheme} aria-label="Toggle theme">
            {props.theme === "dark" ? <CV.Icons.Sun size={20} /> : <CV.Icons.Moon size={20} />}
          </button>
        </div>
        <div className="home-total">{CV.fmt.money(totals.total)}</div>
        <div className="home-sub">
          {totals.count} card{totals.count === 1 ? "" : "s"} · {totals.valued} of {totals.count} valued
          {delta30.hasPrior ? (
            <span
              className={"delta-chip home-delta " + (delta30.delta >= 0 ? "delta-up" : "delta-down")}
              title="Change over the last 30 days"
            >
              {delta30.delta >= 0 ? "▲ " : "▼ "}
              {CV.fmt.money(Math.abs(delta30.delta))} · 30d
            </span>
          ) : null}
        </div>
      </header>

      {/* "Analyze all" banner — only when un-analyzed cards exist. Neutral (never
          gold): gold is reserved for money + the primary action (spec §4). */}
      {unanalyzedCount > 0 ? (
        <button className="ai-banner" onClick={() => setReanalyzeAsk(true)}>
          <span className="ai-banner-icon">
            <CV.Icons.Sparkle size={16} />
          </span>
          <span className="ai-banner-text">
            <strong>{unanalyzedCount}</strong> card{unanalyzedCount === 1 ? "" : "s"} need AI
          </span>
          <span className="ai-banner-cta">Analyze all</span>
        </button>
      ) : null}

      {/* Search */}
      <div className="search-wrap">
        <CV.Icons.Search size={18} className="search-icon" />
        <input
          className="search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search player, team, set, brand, year, card #…"
        />
        {query ? (
          <button className="search-clear" onClick={() => setQuery("")} aria-label="Clear">
            <CV.Icons.Close size={16} />
          </button>
        ) : null}
      </div>

      {/* Filter row */}
      <div className="filter-row">
        <button className={"chip" + (sport === "all" ? " chip-on" : "")} onClick={() => setSport("all")}>
          All
        </button>
        {presentSports.map((s) => (
          <button
            key={s.value}
            className={"chip" + (sport === s.value ? " chip-on" : "")}
            onClick={() => setSport(s.value)}
          >
            {s.label}
          </button>
        ))}
        <button
          className={"chip chip-toggle" + (gradedOnly ? " chip-on" : "")}
          onClick={() => setGradedOnly((g) => !g)}
        >
          Graded only
        </button>
      </div>

      <div className="filter-divider" />

      {/* Sort */}
      <div className="sort-row">
        <span className="sort-count">{filtered.length} shown</span>
        <label className="sort-label">
          Sort
          <select className="sort-select" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="date">Date added</option>
            <option value="value">Value</option>
            <option value="gain">Gain vs. paid</option>
            <option value="year">Year</option>
            <option value="player">Player</option>
          </select>
          <button
            type="button"
            className="sort-dir"
            onClick={() => setDir((d) => (d === "asc" ? "desc" : "asc"))}
            aria-label={dir === "asc" ? "Sorted ascending — tap to sort descending" : "Sorted descending — tap to sort ascending"}
            title={dir === "asc" ? "Ascending" : "Descending"}
          >
            {dir === "asc" ? "↑" : "↓"}
          </button>
        </label>
      </div>

      {/* Grid */}
      {cards.length === 0 ? (
        <EmptyState onAdd={props.onAdd} kind="none" />
      ) : filtered.length === 0 ? (
        <EmptyState kind="filtered" />
      ) : (
        <div className="grid">
          {filtered.map((c) => (
            <CV.CardTile key={c.id} card={c} onOpen={props.onOpen} />
          ))}
        </div>
      )}

      {/* Cost guard: confirm the count + a short cost/time note before the batch. */}
      <CV.ConfirmDialog
        open={reanalyzeAsk}
        title={"Analyze " + unanalyzedCount + " card" + (unanalyzedCount === 1 ? "" : "s") + "?"}
        message={
          "Claude reads the front and back of each un-analyzed card and fills in only the blank fields — " +
          "your existing values are never changed. That's " +
          unanalyzedCount +
          " AI vision call" +
          (unanalyzedCount === 1 ? "" : "s") +
          " (a few cents each) and usually under a minute. Confident cards apply automatically; anything " +
          "unsure waits for you to confirm."
        }
        confirmLabel="Analyze all"
        onConfirm={() => {
          setReanalyzeAsk(false);
          props.onBulkReanalyze && props.onBulkReanalyze();
        }}
        onClose={() => setReanalyzeAsk(false)}
      />
    </div>
  );
};

function EmptyState(props) {
  if (props.kind === "filtered") {
    return <div className="empty">No cards match those filters.</div>;
  }
  return (
    <div className="empty">
      <div className="empty-title">No cards yet</div>
      <div className="empty-sub">Tap the + to add your first card.</div>
      <button className="btn btn-primary" onClick={props.onAdd}>Add a card</button>
    </div>
  );
}

// Accessor for the active sort key → { has, val }. `has:false` means the card
// has no value for this key and must sort LAST in either direction (spec §6).
function sortKey(c, sort) {
  const hasNum = (v) => v != null && v !== "" && !isNaN(Number(v));
  if (sort === "value") return hasNum(c.estimatedValue) ? { has: true, val: Number(c.estimatedValue) } : { has: false };
  if (sort === "year") return hasNum(c.year) ? { has: true, val: Number(c.year) } : { has: false };
  if (sort === "gain") {
    const g = CV.fmt.cardGain(c); // null unless the card has BOTH value and paid
    return g != null ? { has: true, val: g } : { has: false };
  }
  if (sort === "player") {
    const p = String(c.player || "").trim();
    return p ? { has: true, val: p.toLowerCase() } : { has: false };
  }
  // date added — createdAt may be a Timestamp
  const t = ts(c.createdAt);
  return t ? { has: true, val: t } : { has: false };
}

function ts(v) {
  if (!v) return 0;
  if (v.toMillis) return v.toMillis();
  if (v.seconds) return v.seconds * 1000;
  const d = new Date(v);
  return isNaN(d) ? 0 : d.getTime();
}
