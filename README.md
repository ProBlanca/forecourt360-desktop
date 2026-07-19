# Forecourt 360 Desktop (Windows & Mac)

A free desktop wrapper for the existing Forecourt 360 / OMEL FMS web app
(`https://omelfms.com`). It is **not** a rewrite of the app — it's a small,
secure Electron shell that shows the same live site in its own window, with
an app icon, desktop/Start Menu shortcut, persistent login session, and
optional free auto-update. Every feature and user role (admin, manager,
attendant, transport officer, accounts, director) works exactly as it does
in a browser, because it's the same backend and database.

Not published to the Microsoft Store or Apple App Store. No paid Apple
Developer account, code signing, or notarization used anywhere.

## What's in this folder

```
desktop-app/
  main.js               Electron main process (creates the window, security rules, auto-update)
  preload.js            Empty security boundary (contextIsolation on, nothing exposed to the page)
  package.json           App config + electron-builder build settings
  build/
    icon.png             512x512 source icon (used on Linux/taskbar)
    icon.ico             Windows icon (generated, 7 sizes: 16-256px)
    icon.icns            Mac icon (generated, 16-1024px)
  .github/workflows/build.yml   Free CI that builds the .exe and .dmg automatically
```

## How it works (secure login, in plain terms)

- The window only ever loads `https://omelfms.com`. Any link to another
  domain opens in the user's normal browser instead, so the app can't be
  redirected somewhere else.
- Login goes through the exact same Laravel session/cookie login screen
  as the browser version. The app keeps a dedicated, persistent cookie
  storage (like a private browser profile) so users stay logged in
  between launches, same as a browser would.
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` — the
  web page itself has zero access to your file system or OS; it's boxed in
  exactly like a browser tab.
- File > "Log out / Clear session" in the app menu wipes the local cookie
  store if a shared computer needs a clean slate.

## Prerequisites (only needed if building yourself, not for end users)

- [Node.js 20+](https://nodejs.org) and npm
- A free [GitHub](https://github.com) account (only needed for CI builds
  and auto-update — see below). Not needed just to build locally.

## Run it locally in dev mode

```bash
cd desktop-app
npm install
npm start
```

## Building the installers

### Option A — GitHub Actions (recommended, builds both platforms for you)

This is the easiest path, especially for the Mac `.dmg`: **building a real
`.dmg` requires an actual Mac** (or macOS-specific tooling) — it can't be
produced on Windows/Linux. GitHub gives every account free Windows and Mac
build machines via GitHub Actions, which this project is already wired for.

1. Create a new GitHub repository (public or private both work), e.g.
   `forecourt360-desktop`.
2. Push this `desktop-app` folder to it:
   ```bash
   cd desktop-app
   git init
   git add .
   git commit -m "Forecourt 360 desktop app"
   git branch -M main
   git remote add origin https://github.com/YOUR_GITHUB_USERNAME/forecourt360-desktop.git
   git push -u origin main
   ```
3. Open `package.json` and replace `YOUR_GITHUB_USERNAME` (in the `build.publish`
   section) with your actual GitHub username, then commit/push that change.
4. Tag a release and push the tag — this is what triggers the build:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
5. Watch the **Actions** tab on your GitHub repo. Two jobs run
   (`build-windows`, `build-mac`), each on GitHub's free hosted runners.
   When they finish, check the repo's **Releases** page — the `.exe` and
   `.dmg` will be attached there automatically, ready to download and hand
   out to users.
6. To ship an update later: bump `"version"` in `package.json` (e.g. to
   `1.0.1`), commit, tag `v1.0.1`, push the tag. Anyone running an earlier
   version will get an in-app "Update available" prompt automatically
   (see Auto-update below) — no paid service involved, just GitHub's free
   Releases feed.

No GitHub secrets need to be created — `secrets.GITHUB_TOKEN` used in the
workflow is provided automatically and free by GitHub Actions itself.

### Option B — Build locally on your own machine

**Windows `.exe`** (can be built on Windows, or cross-built from Mac/Linux
using [Wine](https://www.winehq.org/)):
```bash
cd desktop-app
npm install
npm run dist:win
```
Output: `desktop-app/release/Forecourt 360 Setup 1.0.0.exe`

**Mac `.dmg`** (must be built on an actual Mac):
```bash
cd desktop-app
npm install
npm run dist:mac
```
Output: `desktop-app/release/Forecourt 360-1.0.0.dmg`

Both commands create Start Menu/Desktop shortcuts (Windows) and a
drag-to-Applications `.dmg` (Mac) automatically via the `build` config in
`package.json` — nothing extra to configure.

## Installing (for end users)

**Windows:** double-click the `.exe`, follow the installer. It adds a
Start Menu entry and a Desktop shortcut named "Forecourt 360".

**Mac:** open the `.dmg`, drag "Forecourt 360" into the Applications
folder. Since the app isn't Apple-signed or notarized (that requires a
paid $99/year Apple Developer account), macOS Gatekeeper will block a
normal double-click the first time with a "can't be opened" warning.
To open it:
1. Right-click (or Control-click) the app in Applications.
2. Choose **Open**.
3. Click **Open** again in the confirmation dialog.

This is only needed once — after that, it opens normally like any other
app, including double-click and Launchpad.

## Auto-update (free, via GitHub Releases)

`electron-updater` is wired into `main.js` and checks your GitHub repo's
Releases feed on every launch (see `build.publish` in `package.json`).
If a newer tagged version has been published (Option A above), users see
an "Update available" prompt, then "Restart to install" once it's
downloaded — no App Store, no paid update service.

If you never set up the GitHub repo, this check simply fails silently in
the background and the app works completely normally; it just never
prompts for updates. Nothing breaks either way.

## Changing which site the app loads

The app is fixed to `https://omelfms.com` (per current requirements). To
point it elsewhere (e.g. a staging server), edit the `APP_URL` constant at
the top of `main.js` and rebuild.

## Updating the icon

The current icon is a generated placeholder (fuel-pump silhouette). To use
your real Mighty Gas logo instead:
1. Save a square PNG (at least 1024x1024, transparent background works
   best) as `build/icon_master.png`.
2. Regenerate the platform icons:
   ```bash
   python3 -c "
   from PIL import Image
   img = Image.open('build/icon_master.png').convert('RGBA')
   img.save('build/icon.png')
   img.resize((512,512)).save('build/icon.png')
   sizes = [16,24,32,48,64,128,256]
   img.save('build/icon.ico', format='ICO', sizes=[(s,s) for s in sizes])
   "
   ```
   (Generating a fresh `.icns` needs the small packing script used to build
   this project — ask if you want that script included separately, or run
   `dist:mac`/`publish:mac` on a Mac with `iconutil`, which handles `.icns`
   generation natively from a `.iconset` folder.)
3. Rebuild via Option A or B above.

## Troubleshooting

- **"Could not reach Forecourt 360" screen on launch** — the machine has
  no internet access, or `omelfms.com` is down. The app just needs network
  access to the same site a browser would use.
- **Windows SmartScreen warning ("Windows protected your PC")** — expected
  for an unsigned installer, same root cause as the Mac Gatekeeper warning.
  Click "More info" → "Run anyway". This only happens on first run.
- **Mac "app is damaged and can't be opened"** instead of the normal
  Gatekeeper prompt — this can happen if macOS re-quarantines the file
  after download in some browsers. Fix: open Terminal and run
  `xattr -cr "/Applications/Forecourt 360.app"`, then right-click → Open
  as normal.
