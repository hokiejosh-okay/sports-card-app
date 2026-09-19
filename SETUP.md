# CardVault — Setup (Phase 0)

Exact steps to get Phase 0 running. Console clicks first, then the CLI/PowerShell
steps for the parts you run on your machine. Windows/PowerShell throughout.

You do these **once**. After that, everyday use is just opening the site.

---

## 0. Install the tools (PowerShell)

```powershell
# Node 20+ (check you have it)
node --version

# Firebase CLI (global)
npm install -g firebase-tools
firebase --version
```

You already have the repo cloned (it's this folder).

---

## 1. Create the Firebase project (console)

1. Go to <https://console.firebase.google.com> → **Add project**.
2. Name it (e.g. `cardvault`). Google Analytics is optional — you can skip it.
3. When the project is created, upgrade it to the **Blaze (pay-as-you-go)** plan:
   **⚙ (Project settings) → Usage and billing → Details & settings → Modify plan → Blaze**.
   - Blaze is required later (Cloud Functions that call Anthropic). A personal
     collection stays inside the free allowances.
4. Set a **budget alert** as a backstop:
   **Usage and billing → Budgets & alerts → Create budget** → e.g. **$10/month**.

## 2. Turn on Auth, Firestore, and Storage (console)

1. **Build → Authentication → Get started → Sign-in method → Google → Enable.**
   Set a support email, Save.
2. **Build → Firestore Database → Create database → Production mode →** pick a
   region (e.g. `us-central`) → Enable.
3. **Build → Storage → Get started → Production mode →** same region → Done.

## 3. Register the web app and paste its config (console → this repo)

1. **⚙ Project settings → General → Your apps → Web (`</>`)** → register an app
   (nickname `cardvault-web`; you do **not** need Firebase Hosting).
2. Copy the `firebaseConfig` values it shows you.
3. Open **`lib/config.js`** in this repo and paste them in, replacing every
   `REPLACE_WITH_...` placeholder. (This file is safe to commit — the web config
   is public by design; the security boundary is the rules.)

> Tip: `storageBucket` may end in `.firebasestorage.app` or `.appspot.com` —
> use exactly what the console shows.

## 4. Point the CLI at your project and deploy rules (PowerShell)

```powershell
firebase login

# Put your real project id in .firebaserc, then:
firebase use REPLACE_WITH_YOUR_PROJECT_ID

# Deploy the security rules (and functions scaffold — Phase 0 has no functions yet):
firebase deploy --only firestore:rules,storage
# (Later phases:  firebase deploy --only functions,firestore:rules,storage )
```

## 5. Add yourself to the allowlist (console)

The app only lets an account in if a `users/{uid}` doc exists. You need your
UID first, so:

1. Deploy the site (step 7) **or** run it locally (step 6), and click
   **Sign in with Google** once. You'll be bounced with *"This app is private"* —
   that's expected; it created your Auth user.
2. Console → **Authentication → Users** → copy your **User UID**.
3. Console → **Firestore Database → Start collection** → Collection ID `users`
   → **Document ID = paste your UID** → add a field `email` (string) with your
   email → Save.
4. Sign in again — you're in.

## 6. Run it locally (optional, PowerShell)

The app is static (no build step), but it can't be opened with `file://` because
browsers block module/XHR loads there. Serve the folder:

```powershell
npx serve .
# or:  python -m http.server 8080
```

Then open the printed URL. Add `http://localhost` (and the port if asked) under
**Authentication → Settings → Authorized domains** so Google sign-in works.

## 7. Deploy to Netlify (console)

1. Push this repo to GitHub (see below).
2. <https://app.netlify.com> → **Add new site → Import an existing project →**
   pick this GitHub repo.
3. Build settings: **Build command = empty**, **Publish directory = `.`**
   (already set in `netlify.toml`). Deploy.
4. Copy your Netlify URL (e.g. `https://cardvault-xyz.netlify.app`).
5. Back in Firebase: **Authentication → Settings → Authorized domains → Add
   domain** → paste your Netlify domain. (Google sign-in only works on
   authorized domains.)

Netlify auto-deploys every push to `main` from then on.

### Push to GitHub (PowerShell)

```powershell
git add .
git commit -m "Phase 0: CardVault skeleton + collection manager"
git push -u origin main   # or your working branch
```

---

## 8. Phase 1 — AI intake (deploy the Function) — PowerShell

Phase 1 adds Claude vision. The AI runs in a **Cloud Function** (so your Anthropic
key never touches the browser). You do this once.

```powershell
# 1. Get an Anthropic API key from https://console.anthropic.com  (Blaze plan already on from step 1).

# 2. Store the key as a Functions secret (NOT in code, NOT in .env committed).
#    Paste the key when prompted:
firebase functions:secrets:set ANTHROPIC_API_KEY

# 3. (Optional) choose the vision model — defaults to claude-opus-5.
#    Sonnet is cheaper for bulk seeding; either is one setting, no code change:
#    setx is not used here — set it as a Functions param via an env file if you want:
#    echo ANTHROPIC_MODEL=claude-sonnet-5 >> functions/.env   (this file is gitignored)

# 4. Install function deps and deploy everything the backend needs:
cd functions
npm install
cd ..
firebase deploy --only functions,firestore:rules,storage
```

What deploys:
- **`analyzeIntakeOnCreate`** — auto-analyzes each new intake row server-side
  (so a bulk batch finishes even if the phone sleeps).
- **`analyzeIntake`** — the callable used for single-card analysis and **Retry**;
  it enforces the allowlist, so no one but you can spend the key.
- The updated **`firestore.rules`** (the `intake` collection) and Storage rules.

Notes:
- The functions run in **`us-central1`** (matches the Firestore location from step 2).
  If you picked a different region for Firestore, change `region` in
  `functions/index.js` and `CV.functions = firebase.app().functions("...")` in
  `lib/firebase.js` to match.
- Concurrency is capped at 3 in-flight vision calls per analyzer to stay inside
  Anthropic rate limits and bound cost.
- First analysis after a deploy can take a few extra seconds (cold start).

## What's built in Phase 0

Google sign-in + allowlist · full `cards` data model + rules · client-side image
resize + thumbnails · manual add (front+back required) · collection grid with
in-memory search/filter/sort · card detail with slab treatment, value-vs-paid
delta, autosaving notes, and delete · edit-any-field screen · light/dark themes ·
installable web manifest.

**Not yet (later phases):** AI auto-fill + bulk intake (Phase 1), eBay comps +
value history (Phase 2), Insights + charts + CSV (Phase 3), automated pricing
(Phase 4).

See `README.md` for the Phase 0 "Done when" checklist and how each item was met.
