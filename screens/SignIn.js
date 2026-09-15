// screens/SignIn.js — Google sign-in; non-allowlisted accounts see "This app is private".
window.CV = window.CV || {};

CV.SignIn = function SignIn(props) {
  const { useState } = React;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function go() {
    setBusy(true);
    setError("");
    try {
      await CV.signIn();
      // Allowlist check + routing happens in App's auth listener.
    } catch (err) {
      if (err && err.code === "auth/popup-closed-by-user") {
        setError("");
      } else {
        setError((err && err.message) || "Sign-in failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="signin">
      <div className="signin-card">
        <div className="wordmark wordmark-lg">CardVault</div>
        <p className="signin-sub">Your sports-card collection, cataloged and valued.</p>

        {props.denied ? (
          <div className="signin-denied">
            <strong>This app is private.</strong>
            <div>That account isn’t on the allowlist. You’ve been signed out.</div>
          </div>
        ) : null}

        <button className="btn btn-primary btn-lg" onClick={go} disabled={busy}>
          {busy ? "Signing in…" : "Sign in with Google"}
        </button>

        {error ? <div className="form-error">{error}</div> : null}
      </div>
    </div>
  );
};
