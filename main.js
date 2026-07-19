// Forecourt 360 desktop wrapper.
//
// This app is intentionally a thin, secure shell around the existing
// Forecourt 360 web app (https://omelfms.com). It does not reimplement
// any FMS logic - every feature, role, and permission continues to work
// exactly as it does in a browser, because it IS the same web app,
// running inside a dedicated window with an app icon, desktop shortcut,
// persistent login session, local encrypted login auto-fill, and
// optional auto-update.

const { app, BrowserWindow, shell, Menu, session, dialog, ipcMain, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_URL = 'https://omelfms.com';

// Keep a persistent session partition (not "incognito") so cookies/login
// survive app restarts, just like a normal browser profile would.
const SESSION_PARTITION = 'persist:forecourt360';

// ---- Local encrypted login auto-fill ----
// Electron does not include Chrome's built-in password-save/autofill
// service (that's a Google-proprietary component tied to a Google API
// key, not available in open-source Chromium/Electron). This is a free,
// local substitute: credentials are encrypted with the OS's own secure
// storage (Keychain on Mac, DPAPI on Windows) via Electron's built-in
// `safeStorage` API - nothing is ever sent anywhere, and it only works
// on the machine that saved it.
const CREDENTIALS_PATH = path.join(app.getPath('userData'), 'login-credentials.enc');

function saveLoginCredentials(payload) {
  try {
    if (!safeStorage.isEncryptionAvailable()) return;
    const enc = safeStorage.encryptString(JSON.stringify(payload));
    fs.writeFileSync(CREDENTIALS_PATH, enc);
  } catch (e) {
    console.log('Could not save login credentials:', e.message);
  }
}

function getSavedLoginCredentials() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    if (!fs.existsSync(CREDENTIALS_PATH)) return null;
    const enc = fs.readFileSync(CREDENTIALS_PATH);
    return JSON.parse(safeStorage.decryptString(enc));
  } catch (e) {
    return null;
  }
}

function forgetSavedLoginCredentials() {
  try {
    if (fs.existsSync(CREDENTIALS_PATH)) fs.unlinkSync(CREDENTIALS_PATH);
  } catch (e) {
    console.log('Could not remove saved login credentials:', e.message);
  }
}

ipcMain.handle('get-saved-login', () => getSavedLoginCredentials());
ipcMain.on('save-login-credentials', (event, payload) => saveLoginCredentials(payload));
ipcMain.on('forget-saved-login', () => forgetSavedLoginCredentials());

// Injected only on the login page. Fills in any saved credentials, and
// captures whatever is submitted so next time can be auto-filled too.
const AUTOFILL_SCRIPT = `
(function() {
  try {
    if (!window.forecourt360Desktop) return;
    var emailEl = document.querySelector('input[name="email"]');
    var stationEl = document.querySelector('input[name="station_number"]');
    var passEl = document.querySelector('input[name="password"]');
    var form = document.querySelector('form');

    window.forecourt360Desktop.getSavedLogin().then(function (creds) {
      if (!creds) return;
      function fill(el, val) {
        if (!el || !val) return;
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      fill(emailEl, creds.email);
      fill(stationEl, creds.stationNumber);
      fill(passEl, creds.password);
    });

    if (form) {
      form.addEventListener('submit', function () {
        try {
          window.forecourt360Desktop.saveLoginOnSubmit(
            emailEl ? emailEl.value : '',
            stationEl ? stationEl.value : '',
            passEl ? passEl.value : ''
          );
        } catch (e) {}
      });
    }
  } catch (e) {}
})();
`;

let mainWindow;

function isAllowedUrl(url) {
  try {
    const parsed = new URL(url);
    // Only ever navigate the main window itself to our own HTTPS domain.
    return parsed.protocol === 'https:' && parsed.hostname === new URL(APP_URL).hostname;
  } catch (e) {
    return false;
  }
}

function createWindow() {
  const ses = session.fromPartition(SESSION_PARTITION);

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1000,
    minHeight: 650,
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#ffffff',
    title: 'Forecourt 360',
    // On Mac, drop the separate light-gray title bar strip so the
    // traffic-light buttons float directly over the page instead of
    // sitting in their own bar above it. The page itself is untouched -
    // see the small padding-top added below, just enough so the buttons
    // don't overlap clickable content.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 14 } }
      : {}),
    webPreferences: {
      session: ses,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,   // security: renderer cannot touch Node/Electron internals directly
      nodeIntegration: false,   // security: no Node APIs exposed to the web page
      sandbox: true,            // security: renderer runs in Chromium's sandbox
      spellcheck: true,
    },
  });

  // Keep the window title fixed as "Forecourt 360" - without this, Electron
  // adopts whatever <title> the current page sets (e.g. "Omel Fms - Admin"),
  // which changes per-page and looks inconsistent in the title bar/dock.
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
  });

  mainWindow.loadURL(APP_URL);

  mainWindow.webContents.on('did-finish-load', () => {
    // Reserve just enough space at the top on Mac so the traffic-light
    // buttons (close/minimize/zoom) don't sit on top of clickable page
    // content, now that the separate native title bar strip is hidden.
    // The sidebars (.adm-sidebar, .mgr-sidebar, .dir-sidebar, .tp-sidebar
    // across the admin/manager/director/transport-officer layouts) are all
    // `position: fixed; top:0`, which ignores any padding on <body> - that's
    // why padding-top on body alone didn't move the logo out of the way.
    // Pushing the sidebars themselves down (and shrinking their height to
    // match, since they're all box-sizing:border-box) is what actually
    // works. This only adds spacing - it does not change any page colors,
    // so the app still looks exactly like the real site otherwise.
    if (process.platform === 'darwin') {
      mainWindow.webContents.insertCSS(`
        .adm-sidebar, .mgr-sidebar, .dir-sidebar, .tp-sidebar {
          padding-top: 28px !important;
        }
      `).catch(() => {});

      // With the native title bar hidden, nothing on the page is marked as
      // a draggable region, so the window can't be moved at all unless we
      // add one ourselves. This creates a thin, invisible strip confined to
      // the same top-left area we already cleared above (well within every
      // sidebar's width), so it can't cover any real button or link on any
      // page - it only adds the ability to click-and-drag the window there,
      // exactly like a normal title bar would.
      mainWindow.webContents.executeJavaScript(`
        (function() {
          var id = '__fc360_drag_region__';
          if (document.getElementById(id)) return;
          var el = document.createElement('div');
          el.id = id;
          el.style.position = 'fixed';
          el.style.top = '0';
          el.style.left = '0';
          el.style.width = '220px';
          el.style.height = '28px';
          el.style.zIndex = '2147483647';
          el.style.background = 'transparent';
          el.style.webkitAppRegion = 'drag';
          document.documentElement.appendChild(el);
        })();
      `).catch(() => {});
    }

    // Visible refresh button (both platforms). Reload already works via
    // Cmd/Ctrl+R or the File menu, but that menu lives in the system menu
    // bar at the very top of the screen - easy to miss, especially with
    // the window's own title bar hidden on Mac. This floating button in
    // the bottom-right corner makes "get the latest data" obvious: the
    // app is just showing the live site, so a reload is exactly like
    // pressing refresh in a browser tab - it pulls whatever is newest on
    // the server (new requests, new approvals, etc.) right away.
    mainWindow.webContents.executeJavaScript(`
      (function() {
        var id = '__fc360_reload_btn__';
        if (document.getElementById(id)) return;
        var btn = document.createElement('button');
        btn.id = id;
        btn.title = 'Reload (get latest data)';
        btn.innerHTML = '&#8635;';
        btn.style.position = 'fixed';
        btn.style.bottom = '20px';
        btn.style.right = '20px';
        btn.style.width = '46px';
        btn.style.height = '46px';
        btn.style.borderRadius = '50%';
        btn.style.border = 'none';
        btn.style.background = '#11305c';
        btn.style.color = '#ffffff';
        btn.style.fontSize = '22px';
        btn.style.lineHeight = '1';
        btn.style.cursor = 'pointer';
        btn.style.boxShadow = '0 4px 14px rgba(0,0,0,.35)';
        btn.style.zIndex = '2147483647';
        btn.onclick = function () { window.location.reload(); };
        document.documentElement.appendChild(btn);
      })();
    `).catch(() => {});

    // Only inject the auto-fill helper on the actual login page.
    try {
      const currentUrl = new URL(mainWindow.webContents.getURL());
      if (currentUrl.pathname === '/login') {
        mainWindow.webContents.executeJavaScript(AUTOFILL_SCRIPT).catch(() => {});
      }
    } catch (e) {
      // ignore
    }
  });

  // Any attempt to navigate the main window to a URL outside our own
  // domain (e.g. a phishing redirect) is blocked. This is the "secure
  // login" boundary: the window can only ever show the real FMS site.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Links that open a new window/tab (target="_blank", payment gateway
  // popups, mailto:, external report links, etc.) open in the user's
  // default browser instead of inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(url)) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    if (errorCode === -3) return; // aborted, usually a redirect - ignore
    mainWindow.loadURL(
      'data:text/html,' +
      encodeURIComponent(`
        <html><body style="font-family: sans-serif; text-align:center; padding-top:100px;">
          <h2>Could not reach Forecourt 360</h2>
          <p>${errorDescription} (${errorCode})</p>
          <p>Check your internet connection, then reopen the app.</p>
          <button onclick="location.reload()" style="padding:10px 20px;">Retry</button>
        </body></html>
      `)
    );
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => mainWindow && mainWindow.reload() },
        { label: 'Log out / Clear session', click: async () => {
            const ses = session.fromPartition(SESSION_PARTITION);
            await ses.clearStorageData();
            mainWindow.loadURL(APP_URL);
          }
        },
        { label: 'Forget saved login', click: () => {
            forgetSavedLoginCredentials();
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Forecourt 360',
              message: 'Saved login has been forgotten on this device.',
            });
          }
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Forecourt 360',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Forecourt 360',
              message: `Forecourt 360 Desktop\nVersion ${app.getVersion()}`,
              detail: 'Mighty Gas Company Limited',
            });
          },
        },
      ],
    },
  ];

  if (process.platform === 'darwin') {
    template.unshift({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Single instance lock: opening the app again just focuses the existing
// window instead of spawning a duplicate window/session.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    buildMenu();
    createWindow();
    setupAutoUpdate();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- Auto-update (free, via GitHub Releases) ----
// electron-updater checks the GitHub repo configured in package.json's
// "build.publish" block. No paid update service is required. If the repo
// isn't set up yet, this simply fails silently and the app works normally
// with no update prompts - it never blocks usage.
function setupAutoUpdate() {
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = false;

    autoUpdater.on('update-available', (info) => {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        buttons: ['Download now', 'Later'],
        title: 'Update available',
        message: `A new version (${info.version}) of Forecourt 360 is available.`,
      }).then((result) => {
        if (result.response === 0) autoUpdater.downloadUpdate();
      });
    });

    autoUpdater.on('update-downloaded', () => {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        buttons: ['Restart now', 'Later'],
        title: 'Update ready',
        message: 'The update has been downloaded. Restart to install it.',
      }).then((result) => {
        if (result.response === 0) autoUpdater.quitAndInstall();
      });
    });

    autoUpdater.on('error', (err) => {
      console.log('Auto-update check failed (safe to ignore if no releases published yet):', err == null ? 'unknown' : (err.stack || err).toString());
    });

    autoUpdater.checkForUpdates();
  } catch (e) {
    console.log('Auto-update not available:', e.message);
  }
}
