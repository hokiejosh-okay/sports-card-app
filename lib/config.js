// lib/config.js — Firebase web config (public by design; rules are the security boundary).
// Filled in for project "sports-card-app-1". Safe to commit (the web config is not a secret).
window.CV = window.CV || {};

CV.firebaseConfig = {
  apiKey: "AIzaSyBqJQiz6EXOuFSuohvpfMMWwAW3VrGQcV8",
  authDomain: "sports-card-app-1.firebaseapp.com",
  projectId: "sports-card-app-1",
  storageBucket: "sports-card-app-1.firebasestorage.app",
  messagingSenderId: "952664741212",
  appId: "1:952664741212:web:33868de5ff7b04cdf55d99",
};

// True once the placeholders above have been replaced with real values.
CV.isConfigured = function () {
  const c = CV.firebaseConfig || {};
  return !!c.apiKey && !String(c.apiKey).startsWith("REPLACE_WITH_");
};
