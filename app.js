// app.js — root component: auth + allowlist, routing, theme, tab bar, card data.
window.CV = window.CV || {};

const { useState, useEffect, useRef } = React;

function App() {
  const [authState, setAuthState] = useState("loading"); // loading|signedout|denied|in
  const [uid, setUid] = useState(null);
  const [cards, setCards] = useState([]);
  const [cardsLoaded, setCardsLoaded] = useState(false);
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

  const selectedCard = selectedId ? cards.find((c) => c.id === selectedId) : null;

  // If a selected card vanished (deleted elsewhere), bail to collection.
  useEffect(() => {
    if ((view.name === "detail" || view.name === "edit") && cardsLoaded && !selectedCard) {
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
        onOpen={openCard}
        onAdd={goAdd}
        onToggleTheme={toggleTheme}
        theme={theme}
      />
    );
  } else if (view.name === "insights") {
    body = <CV.Insights cards={cards} />;
  } else if (view.name === "add") {
    body = <CV.AddCard cards={cards} onCancel={goCollection} onSaved={goCollection} />;
  } else if (view.name === "detail" && selectedCard) {
    body = (
      <CV.CardDetail
        card={selectedCard}
        onBack={goCollection}
        onEdit={editCard}
        onDeleted={goCollection}
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

// ---- mount ----
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
