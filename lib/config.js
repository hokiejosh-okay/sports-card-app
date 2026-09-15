// lib/config.js — Firebase web config (public by design; rules are the security boundary).
//
// ⚠️  FILL THIS IN before the app will work. See SETUP.md step 3.
//   Firebase console → Project settings → General → "Your apps" → Web app → SDK setup → Config.
//   Paste the values below. This file is safe to commit (the web config is not a secret).
window.CV = window.CV || {};

CV.firebaseConfig = {
  apiKey: "REPLACE_WITH_YOUR_API_KEY",
  authDomain: "REPLACE_WITH_YOUR_PROJECT.firebaseapp.com",
  projectId: "REPLACE_WITH_YOUR_PROJECT_ID",
  storageBucket: "REPLACE_WITH_YOUR_PROJECT.appspot.com",
  messagingSenderId: "REPLACE_WITH_YOUR_SENDER_ID",
  appId: "REPLACE_WITH_YOUR_APP_ID",
};

// True once the placeholders above have been replaced with real values.
CV.isConfigured = function () {
  const c = CV.firebaseConfig || {};
  return !!c.apiKey && !String(c.apiKey).startsWith("REPLACE_WITH_");
};
