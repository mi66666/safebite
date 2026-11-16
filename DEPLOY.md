# Deploying SafeBite to GitHub Pages

The app is a static site with **no build step**, so Pages serves the repository as-is.
Deployment matters for two reasons: the marker's phone needs an **HTTPS** URL (service
workers and camera access are restricted to secure contexts), and the repository itself is
the code half of the submission.

## 1. Push the repository

```bash
cd "path/to/safebite"
git remote add origin https://github.com/<your-username>/safebite.git
git push -u origin main
```

A browser window will ask you to authenticate with GitHub the first time.

## 2. Enable Pages

Repository → **Settings** → **Pages** → **Source: Deploy from a branch** →
Branch **`main`**, folder **`/ (root)`** → **Save**.

Wait for the "Your site is live at …" banner (usually 1–2 minutes on first publish).

Your app is then at:

```
https://<your-username>.github.io/safebite/
```

## 3. Verify the live deployment

| Check | Expected |
|---|---|
| Open the URL in a desktop browser | Login screen, no blank page, no 404 |
| DevTools → Console | No errors |
| DevTools → Application → Manifest | Name, icons and start URL all load (no "manifest could not be fetched") |
| DevTools → Application → Service Workers | `sw.js` **activated**, status "activated and is running" |
| DevTools → Application → Cache Storage | A `safebite-shell-v…` cache exists |
| DevTools → Lighthouse → *Installable* | Passes (or use Application → Manifest → "Add to home screen") |

## 4. Install on an Android phone

1. Open `https://<your-username>.github.io/safebite/` in **Chrome**.
2. Menu (⋮) → **Install app** / **Add to Home screen**.
3. Launch it from the home screen — it opens standalone, with no address bar.
4. Grant camera permission when prompted, then scan a real product.
5. Switch on airplane mode and cold-launch the app from the home screen: it must still open
   and show saved history.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Blank page, console 404s on `/js/app.js` | Pages is serving from the wrong folder, or the branch/folder selection is wrong | Settings → Pages → branch `main`, folder `/ (root)` |
| "Add to home screen" missing, manifest warning in console | Manifest served with the wrong MIME type | Already avoided: the manifest is named `manifest.json`, not `.webmanifest` (Pages does not guarantee `application/manifest+json`) |
| Service worker never activates | Not a secure context, or `sw.js` is not at the deployment root | Pages is HTTPS by default; confirm `sw.js` sits next to `index.html` |
| Old version keeps loading after a change | Service worker served the previous cache | Bump `VERSION` in `sw.js` — the `activate` handler deletes stale `safebite-shell-*` caches |
| Camera button says "not available" on a phone | The page was opened from a LAN IP over plain HTTP, or the browser lacks `BarcodeDetector` | Use the Pages HTTPS URL in Chrome on Android |

## Updating a published app

```bash
git add -A
git commit -m "…"
git push
```

Pages republishes automatically. Users receive the new version on their next launch: the
service worker fetches fresh assets in the background and the updated cache is used once the
new worker activates.
