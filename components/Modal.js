// components/Modal.js — lightweight modal + confirm dialog.
window.CV = window.CV || {};

CV.Modal = function Modal(props) {
  if (!props.open) return null;
  return (
    <div className="modal-scrim" onClick={props.onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        {props.title ? <h3 className="modal-title">{props.title}</h3> : null}
        {props.children}
      </div>
    </div>
  );
};

// Simple confirm dialog. props: open, title, message, confirmLabel, danger, onConfirm, onClose, busy
CV.ConfirmDialog = function ConfirmDialog(props) {
  return (
    <CV.Modal open={props.open} title={props.title} onClose={props.busy ? function () {} : props.onClose}>
      <p className="modal-msg">{props.message}</p>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={props.onClose} disabled={props.busy}>
          Cancel
        </button>
        <button
          className={"btn " + (props.danger ? "btn-danger" : "btn-primary")}
          onClick={props.onConfirm}
          disabled={props.busy}
        >
          {props.busy ? "Working…" : props.confirmLabel || "Confirm"}
        </button>
      </div>
    </CV.Modal>
  );
};
