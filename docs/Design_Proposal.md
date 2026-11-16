# MAB001 — Mobile Application Design Proposal

**Student:** Yuntian Mi (2732066)
**Module:** CS32005 Mobile Application Development
**App working title:** SafeBite
**Date:** November 2026

---

## 1. App Concept

### App Name
**SafeBite** — scan a barcode, get a verdict about *you*.

### App Purpose
Around 2 million people in the UK live with a food allergy, and a further 1 in 100 have
coeliac disease; many more avoid foods for religious, ethical or intolerance reasons. Every
shopper in that group performs the same tedious task: pick up a packet, rotate it, find the
ingredient paragraph in 6-point type, and cross-check it against a mental list. Packaging is
small, lighting is poor, and the vocabulary is unfamiliar ("caseinates", "albumen",
"potassium metabisulphite").

SafeBite reduces that task to a single action. The user records their allergen profile once —
from the 14 allergens UK/EU law requires to be declared, plus dietary preferences and any
custom ingredient keywords. From then on, scanning a product barcode produces an immediate,
personalised verdict: **Avoid**, **Caution**, **No match**, or **Unknown**. Results are
colour-coded, written in plain language, and can be read aloud, so the app is usable while
holding a shopping basket in one hand — or by a partially sighted user.

### Why This App?
Existing barcode apps largely answer a generic question ("what is this product?"). SafeBite
answers a personal one ("is this product safe for *me*?"). Three differences matter:

1. **Personal profile over generic data.** The verdict is computed by matching the product
   against the user's own profile — including custom keywords such as "coconut" that no
   standard allergen taxonomy covers.
2. **Honest about uncertainty.** A product with no allergen data in the database is reported
   as *Unknown*, never as *Safe*. The app distinguishes "contains" from "may contain traces
   of", because for an allergic user that difference is the whole point.
3. **Offline-first by design.** Shops and canteens have poor signal, and users re-buy the
   same products. Scanned products are cached on the device, so a second scan in a basement
   supermarket still works.

### Example Scenario
Maya, a second-year student with a milk allergy and a preference for vegan food, is in the
campus shop. She opens SafeBite from her home screen — it loads instantly because the app
shell is cached on her phone. She scans the barcode on a cereal bar. Within a second the
screen turns red: **Avoid — Contains Milk**, and the phone says the same out loud through her
earphones. She puts the bar back and scans a second one. This time the screen turns amber:
**Caution — May contain traces of Milk**, because the factory handles milk on the same line.
She decides not to risk it. Later, in a basement seminar room with no signal, she opens the
History tab to re-check what she decided about a third product; the saved result opens
normally, because SafeBite never needed the network for products it had already seen.

---

## 2. Target Users

The primary users are **students and young adults aged 18–35 with a food allergy,
intolerance or self-imposed dietary restriction**, plus the people who shop for them. They
are confident smartphone users but impatient: they want an answer in the aisle, in under two
seconds, without creating an account with a third party. Their pain points are small-print
ingredients, unfamiliar additive names, inconsistent "may contain" labelling, and unreliable
mobile data in shops and university buildings. They expect the app to work offline, to not
require uploading their medical details, and to be readable without perfect eyesight or a
steady hand.

A secondary group is **partially sighted and dyslexic users**, for whom reading dense
ingredient paragraphs is the main barrier; for them voice output and adjustable text size are
not nice-to-haves.

---

## 3. User Personas

### Persona 1 — Maya Rahman, 21

| | |
|---|---|
| **Occupation** | Second-year Biomedical Science student, University of Dundee |
| **Background** | Diagnosed with a milk allergy at 15. Shops in small local shops between lectures. Uses her phone for everything; has never installed a "health" app before. |
| **Goals** | Buy a snack quickly without reading every label; avoid a reaction during a lab session; keep her vegan preference when possible. |
| **Pain Points** | Ingredient text is tiny and the lighting in the shop is poor; "may contain milk" is ambiguous and she does not know how cautious to be; mobile signal in the basement shop is unreliable. |
| **What SafeBite gives her** | One scan → a red/amber/green verdict in large type, a spoken result for when her hands are full, and saved results that still open without signal. |

### Persona 2 — Tom Whyte, 58

| | |
|---|---|
| **Occupation** | Retired teacher, shopping for his grandson who has a peanut and tree-nut allergy |
| **Background** | Moderately severe sight loss; uses large text and a screen reader on his Android phone. Not confident with new apps. |
| **Goals** | Be certain about a product before it goes in the basket; be able to explain the decision to his daughter. |
| **Pain Points** | Finds small print genuinely unreadable; worried an app will "just say it's fine" when the data is missing; dislikes apps that demand an account before showing anything. |
| **What SafeBite gives him** | Adjustable text size up to 160 %, a high-contrast mode, screen-reader announcements of every result, and a verdict engine that says *Unknown* rather than guessing when the database has no allergen information. |

---

## 4. MVP Feature List

| Feature | Essential (MVP) | Nice-to-have |
|---|---|---|
| Barcode scanning with the camera | ✅ | |
| Manual barcode entry as fallback | ✅ | |
| Personal allergen profile (14 declarable allergens) | ✅ | |
| Product lookup against an open food database | ✅ | |
| Personalised verdict (avoid / caution / no match / unknown) | ✅ | |
| "May contain traces" distinction | ✅ | |
| Local account with encrypted profile | ✅ | |
| Scan history, readable offline | ✅ | |
| Voice read-out of results | ✅ | |
| Adjustable text size and high-contrast mode | ✅ | |
| Dietary preferences (vegan, vegetarian, halal, palm-oil-free) | ✅ | |
| Custom ingredient keywords | ✅ | |
| Export my data / delete my account | ✅ | |
| Installable as a home-screen app (PWA) | ✅ | |
| Nutrition score and ultra-processing badge | | ✅ |
| Shopping list built from scan history | | ✅ |
| Multi-language ingredient parsing | | ✅ |
| Cloud sync across devices | | ✅ |
| Barcode scanning with no Play Services (ZXing fallback) | | ✅ |

**How the MVP tests the core idea:** the MVP is complete when a user can create a profile
containing at least one allergen, scan a real product, and receive a verdict that is
demonstrably correct against the printed label — including the correct behaviour when the
database has no data. That single end-to-end path validates the entire concept; everything
else in the list is refinement.

---

## 5. Hardware and Sensors

| Sensor / Hardware | Functionality | Use case in SafeBite | Limitations |
|---|---|---|---|
| **Camera** (`getUserMedia`) | Live video frames | Reading the barcode on packaging | Needs a permission grant; poor autofocus in low light; reflects on glossy packets |
| **BarcodeDetector API** | Decodes EAN-13/EAN-8/UPC-A in-browser | Converts the video frame into a product number | Available in Chrome on Android, not in every browser; desktop fallback needed |
| **Vibration motor** | Short haptic pulse | Confirms "code captured" while the user is looking at the shelf, not the screen | Not present on tablets/some devices; must be silent-able |
| **Audio output** (SpeechSynthesis) | Spoken verdict and ingredient list | Hands-busy and low-vision use | Voice quality varies by device; must never be the only channel |
| **Display / touch** | Colour-coded verdict, large touch targets | The primary verdict channel | Direct sunlight reduces contrast — mitigated by high-contrast mode |

Deliberately **not** used: GPS and the microphone. Neither improves a
check-this-product decision, and both would weaken the privacy story; requesting location
for a shopping app would be exactly the kind of unnecessary data collection the app argues
against.

---

## 6. APIs

| API | Functionality | Use case in SafeBite | Free limitations |
|---|---|---|---|
| **Open Food Facts API v2** (`world.openfoodfacts.org/api/v2/product/{barcode}.json`) | Product name, brand, image, ingredient text, declared allergens, trace allergens, Nutri-Score, NOVA group, additives | The entire product lookup | Open data (ODbL), **no API key and no registration**; community-entered, so coverage and accuracy vary by country; rate-limited by fair use, which the on-device cache mitigates |
| **Web Crypto API** (`SubtleCrypto`) | PBKDF2-SHA256 key derivation, AES-GCM encryption | Password verification and encryption of the allergy profile at rest | Built into the browser, no cost, no network |
| **BarcodeDetector** | Barcode decoding | Replaces a third-party scanning SDK | Browser support limited to Chromium-on-Android (and some desktops) |
| **Service Worker + Cache API** | Precaching the app shell | The app opens with no connection | Requires HTTPS |
| **IndexedDB** | Structured local storage | Profile, history, product cache | Cleared if the user clears site data |

**Why not Firebase Auth / Cloud Firestore** (the course's own example stack): both require a
project configuration and a live network. For an app whose selling point is offline use and
never uploading health data, a local WebCrypto account gives equivalent password security
without either dependency — and it cannot fail during a demo because of an API key.

---

## 7. Wireframes (low-to-mid fidelity)

Three screens were specified before implementation; the built screens match them.

1. **Scan (home)** — a camera preview filling the upper card with a rectangular capture
   reticle; a status line under it ("Point the camera at a barcode"); a primary
   *Start camera* button; and, below the fold, a secondary card with a numeric barcode input
   and a *Look up* button for when the camera cannot be used. If the profile is empty, an
   amber banner appears above the preview prompting profile setup.
2. **Result** — the verdict occupies the top card as a full-width colour band (red/amber/
   green/grey) with an icon, a one-word verdict in large bold type, and a plain-language
   hint; next comes a product card (thumbnail, name, brand, quantity, Nutri-Score and NOVA
   chips); then finding cards ("Contains", "May contain traces of", "Diet conflict"), each
   with a coloured left border; then the ingredient text with a *Read ingredients aloud*
   button; and finally two actions (*Scan another*, *View history*).
3. **Profile** — 14 allergen chips in a wrapping grid, each a toggle with a visible check
   mark when on; a second chip grid for dietary preferences; a custom keyword list with an
   inline *Add* field; and a full-width *Save profile* button pinned at the bottom.

Navigation uses a four-item bottom tab bar (Scan, History, Profile, More) — the most
frequently used destination is the leftmost item and the default route.

---

## 8. User Flow

```
First run
  Open app ─▶ Sign in / Create account ─▶ Scan screen
                                            │
                        (empty profile) ────┴──▶ Profile ─▶ Save ──┐
                                            ▲                     │
                                            └─────────────────────┘

Repeat use
  Open app ─▶ Scan ─┬─ camera detects barcode ──┐
                    └─ manual entry ────────────┴─▶ Result ─┬─▶ Scan another
                                                            ├─▶ View history ─▶ Result (offline OK)
                                                            └─▶ read result aloud

Decision points
  barcode invalid?        ─▶ inline error, refocus input
  product not in database?─▶ "not in the database" message, no fake verdict
  offline + not cached?   ─▶ "no connection and not saved" message
  offline + cached?       ─▶ saved result, labelled as a saved copy
```

---

## 9. App Map

```
SafeBite
├── Auth (gate)
│   ├── Sign in
│   └── Create account
├── Scan            ← default tab
│   ├── Camera preview (start/stop)
│   └── Manual entry ──▶ Result
├── Result          ← reached from Scan or History
│   ├── Verdict card (speak)
│   ├── Findings (contains / traces / diet)
│   └── Ingredients (speak)
├── History
│   └── Result (from cached snapshot)
├── Profile
│   ├── 14 allergens
│   ├── Dietary preferences
│   └── Custom keywords
└── Settings ("More")
    ├── Display (text size, contrast, motion)
    ├── Audio & feedback (voice, vibration)
    ├── Account (export, sign out, delete)
    └── About / data sources
```

Navigation pattern: **tab navigation** for the four top-level destinations, with a
**stack-like** relationship between Scan → Result and History → Result (both have an
explicit "back to scanning" action). The result screen is reachable from two places, which is
why it is a route rather than a modal.

---

## 10. Development Roadmap (weeks 5–9)

| Week | Focus | Outcome |
|---|---|---|
| 4 | Project skeleton, manifest, service worker, design tokens | Installable empty shell, offline-capable |
| 5 | Pure logic: barcode validation, allergen matching, verdict engine + unit tests | 36 unit tests green before any UI exists |
| 6 | IndexedDB layer, WebCrypto auth, encrypted profile, Open Food Facts client with cache | Real product data renders; login works |
| 7 | Camera scanning, result/profile/history/settings screens, voice output | Full path usable end to end |
| 8 | Accessibility pass (text scaling, contrast, ARIA, focus), performance, offline hardening | Audited against the checklist in the brief |
| 9 | Automated end-to-end checks, real-device testing, demo rehearsal, report | 14 automated checks + device test log, submitted |

**Risks identified early and mitigated:**
- *Barcode scanning unsupported* → manual entry fallback plus explicit "camera unavailable"
  state, never a dead screen.
- *Product database gaps* → verdict of *Unknown* rather than *Safe*, with a disclaimer.
- *Live API failure during the demo* → products cached in IndexedDB, so the demo works from
  the cache even if the venue Wi-Fi dies.
