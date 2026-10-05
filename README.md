# ExecuFlow — Executive Command Center

Store-ready Windows app (PWA) built from the ExecuFlow prototype. Works fully offline, has no CDN
dependencies, and is packaged for the Microsoft Store the same way as your other apps:
**GitHub Pages → PWABuilder → Partner Center**.

## What is in this folder

| Path | Purpose |
|---|---|
| `index.html` | The app shell (icons are bundled inline as an SVG sprite) |
| `css/app.css` | Fluent-style design system, light + dark themes (all colors are tokens at the top) |
| `js/app.js` | App logic: autosave, add/edit/delete, data-driven charts, alerts, backup, theme |
| `js/vendor/chart.umd.js` | Chart.js 4.5 bundled locally (MIT) |
| `manifest.webmanifest` | PWA manifest (name, icons, screenshots, shortcuts) |
| `sw.js` | Service worker — offline cache (see *Releasing an update*) |
| `icons/` | App icon in every size, plus maskable variants and the source `icon.svg` |
| `screenshots/` | Screenshots referenced by the manifest (install dialog) |
| `favicon.ico` | Browser/taskbar favicon |
| `privacy.html` | Privacy policy page (Partner Center asks for its URL) |

## What changed compared with the prototype

- Offline-ready: Tailwind CDN, Lucide CDN, Chart.js CDN and Google Fonts are gone — everything is local, and the
  interface uses Segoe UI (Windows' own font).
- Edit any record (projects, tasks, engagements) — not just add/delete. Project progress and status are editable.
- Every chart is computed from your real data (load per assignee, budget per project, deadline pipeline,
  status mix, upcoming load). The fake "cloud sync" and the hard-coded numbers were removed.
- Working alerts bell: overdue tasks, tasks due within 7 days, engagements in the next 14 days, projects at risk.
- Backup: export/import a JSON file from Settings; a safety copy is kept before an import replaces data.
- Light / dark theme following Windows, or forced; styled confirm dialogs instead of browser pop-ups.
- Autosave on every change; data typed into the old prototype (same browser profile) is migrated automatically.
- Keyboard: `Ctrl+1…5` switch views, `Ctrl+N` new record in the current view, `Ctrl+E` export backup, `Esc` closes.

## Test it locally

Double-click `index.html` — the app runs from disk (the offline cache only activates on https, which is fine).
Sample data is loaded on first start; clear it from **Settings → Clear all data**.

## Publish to GitHub Pages

1. Create a repository (for example `execuflow`) and upload **the contents of this folder** to its root.
2. Settings → Pages → *Deploy from a branch* → `main` / root.
3. After a minute the app is live at `https://<your-user>.github.io/execuflow/`. Open it once in Edge and check that
   the install icon appears in the address bar.

## Package for the Microsoft Store (PWABuilder)

1. In Partner Center, reserve the product name **ExecuFlow** (or the exact variant you want on the Store).
2. Go to <https://www.pwabuilder.com>, enter the GitHub Pages URL, and choose **Package for stores → Windows**.
3. Fill in the identity values from Partner Center (*Product management → Product identity*):
   Package ID, Publisher ID and Publisher display name. **The package display name must match the reserved
   Store name exactly**, otherwise the upload is rejected.
4. Download the package and upload the `.msixbundle` in your Partner Center submission.
5. Listing: privacy policy URL is `https://<your-user>.github.io/execuflow/privacy.html`; support contact
   `haymohsen@gmail.com` (already shown in the app's About section).

## Releasing an update

PWABuilder packages load the app from your GitHub Pages site, so most updates **do not** need a new Store
submission:

1. Edit the files.
2. Open `sw.js` and bump `VERSION` (for example `1.0.0` → `1.0.1`). This is what makes installed copies download the
   new files; without it they keep using the cached version.
3. Push to GitHub. Users get a "new version ready — Restart now" toast on their next launch.

Re-submit to the Store only when the manifest changes (name, icons, start URL) or you want a new Store version number.

## Credits

Chart.js (MIT) and Lucide icons (ISC) are bundled; their licenses are in `js/vendor/` and in the sprite comment
inside `index.html`.
