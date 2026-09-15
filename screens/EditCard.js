// screens/EditCard.js — edit every field; shares CV.CardForm with Add (spec §3, §6).
window.CV = window.CV || {};

CV.EditCard = function EditCard(props) {
  return (
    <div className="screen edit-screen">
      <header className="sub-header">
        <button className="icon-btn" onClick={props.onCancel} aria-label="Back">
          <CV.Icons.Back size={22} />
        </button>
        <h2 className="sub-title">Edit card</h2>
        <span className="icon-btn-spacer" />
      </header>

      <div className="add-body">
        <CV.CardForm mode="edit" initial={props.card} onCancel={props.onCancel} onSaved={props.onSaved} />
      </div>
    </div>
  );
};
