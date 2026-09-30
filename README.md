# CardVault

A mobile-first web app for cataloging, searching, and valuing a physical sports-card collection. Photograph a card's front and back, confirm its details, and it becomes a clean, filterable, valued record.

**Stack:** React (CDN + Babel standalone, no build step), Firebase (Auth, Firestore, Storage, Functions), Netlify. Single user, Google sign-in, allowlisted.

## What it does

- **Collection:** browse cards in a grid with instant search, sport filters, graded-only toggle, and sorting.
- **Add and edit:** capture front and back photos from your phone, fill in attributes from controlled lists, and record graded details (company and grade).
- **AI intake:** analyze a card photo, confirm the suggested attributes, or seed many cards at once through a review queue.
- **Pricing:** one-tap links to eBay sold listings, graded-value comparisons, and manual value entry with a history of changes.
- **Insights:** collection totals and value trends over time.
- **Installable:** add to your phone's home screen and it launches like a native app.

## Getting started

Follow [SETUP.md](SETUP.md) for the Firebase and Netlify setup. In short:

1. Create a Firebase project and enable Google Auth, Firestore, and Storage.
2. Put your Firebase web config in `lib/config.js`.
3. Deploy the Firestore and Storage rules.
4. Add a `users/{your-uid}` document (this is the allowlist).
5. Deploy the repo to Netlify and add the Netlify domain to Firebase authorized domains.
6. Deploy the Cloud Function and set the `ANTHROPIC_API_KEY` secret to enable AI features.

## How it's organized

- `index.html`, `app.js`, `styles.css`: entry point, routing, and design tokens
- `screens/`: top-level views (collection, add, detail, edit, insights)
- `components/`: shared UI, including the single card form used for both add and edit
- `lib/`: Firebase access, image handling, formatting, and pricing links
- `data/`: controlled value lists (sport, brand, parallel, and so on)
- `functions/`: Cloud Functions for AI features
- `firestore.rules`, `storage.rules`: security rules

## Design notes

- No build step. Files load directly in the browser.
- No composite indexes. The full card collection loads once, in real time, and all search, filter, and sort happens in memory.
- Add and Edit share one form, one validation path, and one save path.
- Value changes append a snapshot to each card's `valueHistory`, which powers the charts.
- Currency is USD throughout.

## Privacy and security

Access is limited to allowlisted accounts, enforced by both the app and the Firestore and Storage rules. Anyone else is bounced with "This app is private."
