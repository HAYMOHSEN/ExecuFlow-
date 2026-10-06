# ExecuFlow — fix for the shared app identity

Repository: **HAYMOHSEN/ExecuFlow-** — app URL: https://haymohsen.github.io/ExecuFlow-/

## What changed (nothing else in the repository changes)

- `manifest.webmanifest`: `"id": "./"` → `"id": "/ExecuFlow-/"`
  (identity was `https://haymohsen.github.io/`, shared with your other apps; it is now `https://haymohsen.github.io/ExecuFlow-/`)
- `sw.js`: `const VERSION = '1.0.1';` → `const VERSION = '1.2.0';`

The cache-version bump makes Edge fetch the new manifest instead of the copy it cached; users see no difference apart from a quick re-download of the app files on their next launch.

## Steps

1. On GitHub open the repository → **Add file → Upload files** → drop the file(s) from this folder (they overwrite the old ones with the same names) → **Commit changes**. You can instead open each file, click the pencil icon and paste the new content.
2. Wait about a minute, then open https://haymohsen.github.io/ExecuFlow-/manifest.webmanifest in a browser and check that it shows `"id": "/ExecuFlow-/"`.
3. Go to pwabuilder.com → enter `https://haymohsen.github.io/ExecuFlow-/` → **Package for stores → Windows**. Use the same Package ID, Publisher ID and Publisher display name as the previous package and the app name exactly as reserved in Partner Center. Expand the full settings (the "Classic app version" field is hidden by default) and type **App version `1.2.0`** and **Classic app version `1.1.9`** — both higher than the first submission's packages, with the classic number below the app version. Generate and download the package.
4. Partner Center → this app → **Update** (new submission) → **Packages** → upload both the `.msixbundle` and the `.classic.appxbundle` → Submit. Listing, price and trial stay as they are. If Partner Center reports a package "with the same full name", a version number was left at its default — regenerate with the numbers above and replace the uploaded packages.
5. On your own PC uninstall the old copy (Settings → Apps, and `edge://apps`) before installing the updated one to test. Customers keep their data — it is stored per website, not per app identity.
