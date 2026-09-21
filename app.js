// app.js — root component: auth + allowlist, routing, theme, tab bar, card data.
window.CV = window.CV || {};

const { useState, useEffect, useRef } = React;

function App() {
  const [authState, setAuthState] = useState("loading"); // loading|signedout|denied|in
  const [uid, setUid] = useState(null);
  const [cards, setCards] = useState([]);
  const [cardsLoaded, setCardsLoaded] = useState(false);
  const [histories, setHistories] = useState({}); // { cardId -> [{date, value, source}] }
  const [view, setView] = useState({ name: "collection" });
  const [selectedId, setSelectedId] = useState(null);
  const [theme, setTheme] = useState(getInitialTheme());

  const deniedRef = useRef(false);
  const unsubCardsRef = useRef(null);

  // Theme → <html data-theme>
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Auth + allowlist
  useEffect(() => {
    if (!CV.firebaseReady) {
      setAuthState("unconfigured");
      return;
    }
    const unsub = CV.auth.onAuthStateChanged(async (user) => {
      if (user) {
        setAuthState("loading");
        const ok = await CV.isAllowlisted(user.uid);
        if (ok) {
          deniedRef.current = false;
          setUid(user.uid);
          setAuthState("in");
          startCards(user.uid);
        } else {
          deniedRef.current = true;
          try {
            await CV.signOut();
          } catch (e) {}
        }
      } else {
        stopCards();
        setUid(null);
        setCards([]);
        setCardsLoaded(false);
        setHistories({});
        setAuthState(deniedRef.current ? "denied" : "signedout");
      }
    });
    return () => unsub();
  }, []);

  function startCards(theUid) {
    stopCards();
    setCardsLoaded(false);
    unsubCardsRef.current = CV.listenToCards(
      theUid,
      (list) => {
        setCards(list);
        setCardsLoaded(true);
      },
      (err) => {
        console.error("cards listener error", err);
        setCardsLoaded(true);
      }
    );
  }
  function stopCards() {
    if (unsubCardsRef.current) {
      unsubCardsRef.current();
      unsubCardsRef.current = null;
    }
  }

  // Navigation helpers
  const goCollection = () => setView({ name: "collection" });
  const goInsights = () => setView({ name: "insights" });
  const goAdd = () => setView({ name: "add" });
  const openCard = (card) => {
    setSelectedId(card.id);
    setView({ name: "detail" });
  };
  const editCard = (card) => {
    setSelectedId(card.id);
    setView({ name: "edit" });
  };
  const reanalyzeCard = (card) => {
    setSelectedId(card.id);
    setView({ name: "reanalyze" });
  };
  // "Analyze all" from the Collection banner → the bulk re-analyze flow, which
  // creates the batch on entry (start:true). Re-entry is deduped in the screen.
  const goReanalyzeBulk = () => setView({ name: "reanalyzeBulk", start: true });

  // Value histories: a one-time (non-realtime) bulk read of each card's
  // valueHistory subcollection, held in state and passed down to Collection,
  // Insights and CardDetail (spec §5, Phase 3). We re-read only when a value
  // write changes the signature below — a card's valueUpdatedAt, or the set of
  // cards (add/delete). Notes-only or other edits don't change it, so they don't
  // trigger a re-read and keep the reads cheap.
  const valueSig = React.useMemo(
    () =>
      cards
        .map((c) => c.id + ":" + tsMillis(c.valueUpdatedAt) + ":" + tsMillis(c.createdAt))
        .sort()
        .join("|"),
    [cards]
  );
  useEffect(() => {
    if (authState !== "in" || !uid || !cardsLoaded) return;
    let cancelled = false;
    CV.fetchValueHistories(uid, cards).then(
      (map) => {
        if (!cancelled) setHistories(map);
      },
      () => {}
    );
    return () => {
      cancelled = true;
    };
    // cards is intentionally read through valueSig, which changes exactly when a
    // re-read is warranted.
  }, [valueSig, cardsLoaded, uid, authState]);

  const selectedCard = selectedId ? cards.find((c) => c.id === selectedId) : null;

  // If a selected card vanished (deleted elsewhere), bail to collection.
  useEffect(() => {
    if (
      (view.name === "detail" || view.name === "edit" || view.name === "reanalyze") &&
      cardsLoaded &&
      !selectedCard
    ) {
      goCollection();
    }
  }, [view.name, selectedCard, cardsLoaded]);

  function toggleTheme() {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      try {
        localStorage.setItem("cv-theme", next);
      } catch (e) {}
      return next;
    });
  }

  // ---- render ----
  if (authState === "unconfigured") return <SetupNeeded />;
  if (authState === "loading") return <Splash />;
  if (authState === "signedout") return <CV.SignIn />;
  if (authState === "denied") return <CV.SignIn denied />;

  // Signed in + allowlisted
  const showTabBar = view.name === "collection" || view.name === "insights";

  let body;
  if (!cardsLoaded && view.name === "collection") {
    body = <Splash label="Loading your collection…" />;
  } else if (view.name === "collection") {
    body = (
      <CV.Collection
        cards={cards}
        histories={histories}
        onOpen={openCard}
        onAdd={goAdd}
        onBulkReanalyze={goReanalyzeBulk}
        onToggleTheme={toggleTheme}
        theme={theme}
      />
    );
  } else if (view.name === "reanalyzeBulk") {
    body = (
      <CV.ReanalyzeBulk
        cards={cards}
        cardsLoaded={cardsLoaded}
        start={!!view.start}
        onDone={goCollection}
      />
    );
  } else if (view.name === "insights") {
    body = <CV.Insights cards={cards} histories={histories} onOpen={openCard} />;
  } else if (view.name === "add") {
    body = <CV.AddCard cards={cards} onCancel={goCollection} onSaved={goCollection} />;
  } else if (view.name === "detail" && selectedCard) {
    body = (
      <CV.CardDetail
        card={selectedCard}
        history={histories[selectedCard.id] || []}
        onBack={goCollection}
        onEdit={editCard}
        onReanalyze={reanalyzeCard}
        onDeleted={goCollection}
      />
    );
  } else if (view.name === "reanalyze" && selectedCard) {
    body = (
      <CV.ReanalyzeCard
        card={selectedCard}
        cards={cards}
        onCancel={() => setView({ name: "detail" })}
        onSaved={() => setView({ name: "detail" })}
      />
    );
  } else if (view.name === "edit" && selectedCard) {
    body = (
      <CV.EditCard
        card={selectedCard}
        onCancel={() => setView({ name: "detail" })}
        onSaved={() => setView({ name: "detail" })}
      />
    );
  } else {
    body = <Splash />;
  }

  return (
    <div className="app">
      <main className={"app-main" + (showTabBar ? " with-tabbar" : "")}>{body}</main>
      {showTabBar ? (
        <nav className="tabbar">
          <button
            className={"tab" + (view.name === "collection" ? " tab-on" : "")}
            onClick={goCollection}
          >
            <CV.Icons.Collection size={22} />
            <span>Collection</span>
          </button>
          <button className="tab tab-add" onClick={goAdd} aria-label="Add card">
            <span className="tab-add-btn">
              <CV.Icons.Plus size={26} />
            </span>
          </button>
          <button className={"tab" + (view.name === "insights" ? " tab-on" : "")} onClick={goInsights}>
            <CV.Icons.Insights size={22} />
            <span>Insights</span>
          </button>
        </nav>
      ) : null}
    </div>
  );
}

function Splash(props) {
  return (
    <div className="splash">
      <div className="wordmark wordmark-lg">CardVault</div>
      <div className="splash-label">{props.label || "Loading…"}</div>
    </div>
  );
}

function SetupNeeded() {
  return (
    <div className="splash">
      <div className="wordmark wordmark-lg">CardVault</div>
      <div className="setup-card">
        <strong>Almost there — add your Firebase config.</strong>
        <p>
          Open <code>lib/config.js</code> and paste your Firebase web config (see <code>SETUP.md</code>,
          step 3). Then reload.
        </p>
      </div>
    </div>
  );
}

// ---- theme helpers ----
function getInitialTheme() {
  try {
    const saved = localStorage.getItem("cv-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch (e) {}
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

// Coerce a Firestore Timestamp | Date | number | null to epoch ms (0 when none).
// Used only to build the value-history re-read signature. Named tsMillis to stay
// unique across the Babel global scope (Collection.js already defines `ts`).
function tsMillis(v) {
  if (!v) return 0;
  if (v.toMillis) return v.toMillis();
  if (v.seconds != null) return v.seconds * 1000;
  const d = new Date(v);
  return isNaN(d) ? 0 : d.getTime();
}

// ---- mount ----
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
