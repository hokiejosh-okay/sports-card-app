// screens/AddCard.js — single-card manual add (Phase 0). Bulk + AI analyze arrive in Phase 1.
window.CV = window.CV || {};

CV.AddCard = function AddCard(props) {
  const { useState } = React;
  const [tab, setTab] = useState("single");

  return (
    <div className="screen add-screen">
      <header className="sub-header">
        <button className="icon-btn" onClick={props.onCancel} aria-label="Back">
          <CV.Icons.Back size={22} />
        </button>
        <h2 className="sub-title">Add card</h2>
        <span className="icon-btn-spacer" />
      </header>

      <div className="segmented">
        <button className={"seg" + (tab === "single" ? " seg-on" : "")} onClick={() => setTab("single")}>
          Single card
        </button>
        <button className={"seg" + (tab === "bulk" ? " seg-on" : "")} onClick={() => setTab("bulk")}>
          Bulk upload
        </button>
      </div>

      {tab === "single" ? (
        <div className="add-body">
          <p className="add-note">
            Photograph the front and back, fill the fields, and save. (AI auto-fill comes in Phase 1.)
          </p>
          <CV.CardForm mode="add" onCancel={props.onCancel} onSaved={props.onSaved} />
        </div>
      ) : (
        <div className="add-body">
          <div className="coming-soon">
            <div className="coming-title">Bulk upload — coming in Phase 1</div>
            <p>
              Bulk seeding (shoot front/back in order, AI reads each card, review queue) lands in the next
              phase. For now, add cards one at a time.
            </p>
            <button className="btn btn-ghost" onClick={() => setTab("single")}>Add a single card</button>
          </div>
        </div>
      )}
    </div>
  );
};
