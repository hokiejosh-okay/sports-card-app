# CardVault — Sports Card Tracker

A mobile-first web app to catalog, search, and value a physical sports-card
collection. Photograph a card's front and back, confirm its attributes, and it
becomes a clean, filterable, valued record.

Built to the **Card Tracker — Build Plan v2** spec. Stack: **React (CDN + Babel
standalone, no build step) + Firebase (Auth / Firestore / Storage / Functions) +
Netlify**. Single user, Google sign-in, allowlisted.

> **This repo implements Phase 0 + Phase 1 + Phase 2** (skeleton + collection
> manager; AI intake: single-card analyze→confirm and bulk seeding with a review
> queue; and pricing: eBay sold-comps deep links, a graded-value link row, and
> manual value entry that writes value history).
> Phase 1's Cloud Function must be deployed and the `ANTHROPIC_API_KEY` secret
> set before AI features work — see **[SETUP.md](SETUP.md) §8**. Phase 2 is
> pure frontend (comps are client-side eBay deep links, per spec §8) — no
> extra deploy beyond pushing the static files.
> Phases 3–4 (insights, automation) come next.

## Get it running

See **[SETUP.md](SETUP.md)** — exact Firebase + Netlify console steps and the
PowerShell commands, done once.

Short version:
1. Create a Firebase project (Blaze plan), enable Google Auth, Firestore, Storage.
2. Paste your Firebase web config into `lib/config.js`.
3. `firebase deploy --only firestore:rules,storage`.
4. Add a `users/{your-uid}` doc (the allowlist).
5. Deploy the repo to Netlify; add the Netlify domain to Firebase authorized domains.

## Project layout (spec §6)

```
index.html            # loads React + Babel + Firebase (CDN), then the source files
styles.css            # design tokens + all styling (spec §4), light + dark
manifest.webmanifest  # home-screen install
icons/                # app icons
data/lists.js         # controlled value lists (sport, brand, parallel, …)
lib/
  config.js           # Firebase web config  ← you fill this in
  firebase.js         # init + data-access helpers (auth, cards, storage)
  images.js           # client-side resize (1600px) + 400px thumbnail
  format.js           # display/model helpers
  comps.js            # eBay sold-comps deep links (getComps) — Phase 2
components/
  Icons.js Modal.js Badges.js CardTile.js
  CardForm.js         # THE card form + THE validation + THE save path (Add & Edit share it)
screens/
  SignIn.js Collection.js AddCard.js CardDetail.js EditCard.js Insights.js
app.js                # root: auth+allowlist, routing, theme, tab bar
firestore.rules storage.rules firestore.indexes.json firebase.json .firebaserc
functions/            # Cloud Functions scaffold (Phase 1+)
netlify.toml
```

No composite indexes: the whole `cards` collection loads once (realtime) and all
search/filter/sort happens in memory (spec §6).

## Phase 0 — "Done when" (spec §11) and how it's met

| Criterion | Where |
|---|---|
| Allowlisted account signs in; others bounced with "This app is private" and can't read/write | `app.js` allowlist flow + `firestore.rules`/`storage.rules` (own-uid + `users/{uid}` required) |
| Add a card (both sides) from phone camera; thumbnail ≤ 60 KB, full ≤ 700 KB | `CardForm.js` + `lib/images.js` (1600px q0.85 / 400px thumb) + camera `<input capture>` |
| Save blocked without a back photo, or graded with no company/grade | `CV.validateCard` in `CardForm.js` (mirrored in rules) |
| Sport chips + Graded-only + search + sort combine instantly with 50+ cards | `screens/Collection.js` (in-memory) |
| Editing any field updates detail + grid without reload; raw→graded switches to slab | `EditCard.js` shares `CardForm.js`; realtime listener in `app.js`; slab in `CardTile.js`/`CardDetail.js` |
| Notes autosave and persist | `CardDetail.js` (save on blur → `updateCard`) |
| Delete removes card and its Storage objects | `CV.deleteCard` in `lib/firebase.js` |
| Light/dark match §4 tokens; gold only on value + primary actions | `styles.css` |
| iOS "Add to Home Screen" launches standalone with icon | `manifest.webmanifest` + apple meta tags in `index.html` + `icons/` |

## Phase 2 — "Done when" (spec §11) and how it's met

| Criterion | Where |
|---|---|
| Every card's comps link opens eBay (signed in) on a sold-listings search whose query contains year, brand, set, player, card #, and the parallel/subset/grade when present | `lib/comps.js` (`CV.getComps`/`CV.comps` build the `_nkw=…&_sacat=212&LH_Sold=1&LH_Complete=1&_sop=13` URL) + "View sold on eBay" in `screens/CardDetail.js` |
| The graded row opens the same search with each grade appended | `CV.comps.gradedLinks` (PSA 10 / PSA 9 / BGS 9.5 / SGC 10, plus the card's own grade) → the "If graded" link row in `CardDetail.js` |
| Entering a value updates the card, the grid, the collection total, and adds a valueHistory snapshot; the delta chip is green/red/absent correctly | `CV.updateCardValue` (batched card update + `valueHistory` snapshot, `valueSource:"manual"`) in `lib/firebase.js`; realtime listener in `app.js` refreshes grid/total; delta chip in `CardDetail.js` |
| Changing parallel or grade on Edit regenerates compsUrl | `assemble()` in `components/CardForm.js` rebuilds `compsUrl` via `CV.comps.primaryUrl(data)` on every save |

Value entered on the **Add/Edit form** also sets `valueSource:"manual"` + `valueUpdatedAt`
and appends a `valueHistory` snapshot (spec §5), so history captures form saves and the
detail affordance alike.

## Data model

See spec §5. `cards/{cardId}` holds typed, queryable fields; categorical fields
use the controlled lists in `data/lists.js` and are validated in the rules.
Currency is USD throughout. Value changes append a `cards/{cardId}/valueHistory`
snapshot `{ date, value, source }` (spec §5) — the series Phase 3's charts read.
