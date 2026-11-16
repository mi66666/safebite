# SafeBite — allergen barcode scanner (PWA)

**CS32005 Mobile Application Development — MAB001 Project**
Yuntian Mi · 2732066 · University of Dundee

SafeBite is an installable Progressive Web App that scans a product barcode and checks it
against **your own** allergy and dietary profile, then tells you — in colour, in words, and
out loud — whether the product is safe for you.

---

## Why it exists

People with food allergies, intolerances or dietary restrictions read the same tiny
ingredient paragraph on every product, in every shop, often with the packaging rotated in
one hand. Mistakes are expensive: the wrong bar of chocolate can cause anaphylaxis.

SafeBite turns that into one action: **scan, and get a verdict about you**, not about the
general public.

## Features

| Feature | Implementation |
|---|---|
| Barcode scanning | `BarcodeDetector` API + `getUserMedia` camera stream (Android Chrome) |
| Manual fallback | 8/12/13-digit barcode entry with GS1 check-digit validation |
| Product data | [Open Food Facts](https://world.openfoodfacts.org) API v2 — free and open, **no API key required** |
| Personal profile | 14 UK/EU declarable allergens, dietary preferences, custom ingredient keywords |
| Verdict engine | Danger / Caution / Safe / Unknown, with traces-versus-contains distinction |
| Local storage | IndexedDB (users, encrypted profile, scan history, product cache, preferences) |
| Offline | Service worker precaches the app shell; visited products are cached in IndexedDB and remain readable with no connection |
| Accounts | Local WebCrypto auth — PBKDF2-SHA256 (210 000 iterations, per-user salt), profile encrypted with AES-GCM |
| Voice | `SpeechSynthesis` reads the verdict and the ingredient list aloud |
| Accessibility | Adjustable text size (100–160 %), high-contrast mode, reduced-motion mode, ARIA live regions, 44 px touch targets, full keyboard support |
| Data rights | One-click JSON export, one-click account deletion |

## Running it locally

```bash
# any static server works; this one has no dependencies
node tools/server.mjs 5173
# then open http://localhost:5173
```

Service workers require a secure context: `localhost` counts, but a plain-HTTP LAN address
does not — for a phone you need HTTPS (GitHub Pages is used for this project).

## Tests

Three independent suites, all runnable from a clean checkout:

```bash
npm test        # 29 unit tests (logic + crypto), zero dependencies, no browser
npm run check   # 14 end-to-end checks in a 390×844 mobile viewport via CDP
npm run a11y    # accessibility audit: 15 page-audits across 4 display modes
```

| Suite | Checks | What it proves |
|---|---|---|
| Unit (`tests/`) | 29 passing | GS1 check digits against real products, UPC-A padding, rejected checksums, allergen alias matching (`en:hazelnuts` → tree nuts), traces-vs-contains, dietary flags, AES-GCM round-trip, wrong-key rejection, tamper detection, constant-time compare |
| End-to-end (`tools/cdp-check.mjs`) | 14 passing | Registration, encrypted profile, live Open Food Facts lookup, history persistence, service worker activation, text scaling, high contrast, invalid barcode handling, and **genuine offline behaviour** (network disabled via `Network.emulateNetworkConditions`) |
| Accessibility (`tools/a11y-audit.mjs`) | 0 violations | Touch targets ≥ 44 px, accessible names, image alternatives, heading order, landmarks, WCAG contrast (4.5:1 / 3:1), horizontal overflow — measured in light, dark, high-contrast and 160 % text modes |

The accessibility audit **tests itself**: it injects five known defects (an undersized
button, a button whose only content is `aria-hidden`, an image with no `alt`, a skipped
heading level, and 1.15:1 contrast text) and fails the run if any goes undetected. It
currently detects 5/5 — the first version only caught 4/5, which is how a real false
negative in the name computation was found.

The end-to-end and audit scripts need Chrome started with a debugging port:

```bash
chrome --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/safebite-cdp
```

## Deployment (GitHub Pages)

The app is a static site with no build step, so Pages serves it directly:

1. Push this repository to GitHub.
2. **Settings → Pages → Source: Deploy from a branch → `main` / `root`**.
3. Open `https://<user>.github.io/<repo>/` in Chrome on Android, then use
   *Install app* / *Add to Home screen*.

`manifest.json` uses relative URLs (`./`) so it works correctly from a project subpath, not
just a domain root. It is named `.json` rather than `.webmanifest` deliberately: GitHub Pages
does not guarantee an `application/manifest+json` MIME type, and Chrome rejects a manifest
served with the wrong type — which would silently break "Add to Home screen".

## Architecture

```
index.html            app shell
styles/main.css       design tokens, dark mode, high-contrast mode, responsive layout
js/logic.js           pure functions: barcode check digits, allergen matching, verdicts
js/crypto.js          PBKDF2 key derivation, AES-GCM encryption, constant-time compare
js/db.js              IndexedDB wrapper (six object stores)
js/api.js             Open Food Facts client + stale-while-revalidate cache
js/auth.js            local registration/login, encrypted profile load/save
js/scan.js            camera + BarcodeDetector lifecycle, graceful degradation
js/voice.js           SpeechSynthesis wrapper
js/a11y.js            accessibility preferences, applied before first paint
js/ui.js              tiny DOM helpers (no framework)
js/app.js             hash router and the five views
sw.js                 service worker: precache shell, offline navigation fallback
tools/                dev server, icon generator, CDP end-to-end checker
tests/                node:test unit tests
```

Deliberate choice: **no framework and no build step**. The module taught plain
HTML/CSS/JavaScript, and a reader can open any file here and follow it.

## Data and licensing

- Product data: Open Food Facts, published under the
  [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/).
- Product photos belong to their respective contributors.
- SafeBite shows a disclaimer on every result: manufacturer recipes change and database
  entries can be incomplete, so the physical label always wins.

## Privacy

- Camera frames are processed in memory only; nothing is recorded or uploaded.
- Accounts, profiles and scan history never leave the device.
- Passwords are never stored — only a salted, stretched hash.
- The allergy profile is stored encrypted with a key derived from the user's password.

## AI usage disclosure

AI tools were used in this project, and that use is acknowledged in the project report as
required by the module's assessment brief (AI usage: Green / permitted with disclosure).
See the *AI usage* section of the submitted project report for what was generated with AI,
what was written by hand, and a reflection on the process.
