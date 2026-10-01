# AEG Invert Sheet

An offline field app for structure invert sheets: structure type, lid, condition, rim-to-bottom depth, up to eight pipes (size, material, Inv, T/Pipe, T/Water, T/Debris), and tagged condition photos. It installs to the home screen on Android and iPad and works with no signal.

**Open / install:** https://oladelemogaji.github.io/Invert-Sheet-AEG/

## Install on a device
- **Android (Chrome):** open the link and tap **Install app**.
- **iPad / iPhone (Safari):** open the link, tap **Share**, then **Add to Home Screen**.

Open it once with signal after installing so it saves everything for offline use.

## Printing for the client
**Print** (from the sheet list, or the Print button on any sheet) lays each structure out like the AEG paper invert sheet on US Letter, one structure per page, followed by its photo pages (1, 2, 4 or 6 photos per page). Choose **Save as PDF** as the printer to send a PDF. **Download photos (ZIP)** on the same page gives the original photos.

## How data moves
- Sheets and photos are stored on each device (IndexedDB). Back up daily.
- **Export → Share job package** creates a ZIP with photos in folders by point, a CSV (one row per pipe) and `sheets.json`.
- In the office, **Backup → Import** loads that ZIP. Sheets from several devices combine, and the most recently edited copy of each sheet wins.

## Files
| File | Purpose |
|---|---|
| `index.html` | App shell |
| `app.js` | All app logic: form, pipe plan, photos, export/import |
| `app.css` | Styles (fonts bundled in `vendor/fonts`) |
| `sw.js` | Service worker for offline use |
| `manifest.webmanifest` | Install settings and icons |
| `vendor/jszip.min.js` | ZIP export/import |

## Releasing an update
Change `VERSION` in `sw.js` (for example `invert-sheets-v1.0.1`) and push. Devices show "A new version is ready" the next time they open the app with signal.
