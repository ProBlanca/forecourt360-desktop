// Forecourt 360 desktop wrapper.
//
// This app is intentionally a thin, secure shell around the existing
// Forecourt 360 web app (https://omelfms.com). It does not reimplement
// any FMS logic - every feature, role, and permission continues to work
// exactly as it does in a browser, because it IS the same web app,
// running inside a dedicated window with an app icon, desktop shortcut,
// persistent login session, and optional auto-update.

const { app, BrowserWindow, shell, Menu, session, dialog } = require('electron');
const path = require('path');

const APP_URL = 'https://omelfms.com';

// Keep a persistent session partition (not "incognito") so cookies/login
// survive app restarts, just like a normal browser profile would.
const SESSION_PARTITION = 'persist:forecourt360';

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
    webPreferences: {
      session: ses,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,   // security: renderer cannot touch Node/Electron internals directly
      nodeIntegration: false,   // security: no Node APIs exposed to the web page
      sandbox: true,            // security: renderer runs in Chromium's sandbox
      spellcheck: true,
    },
  });

  mainWindow.loadURL(APP_URL);

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
        { type: 'separator' },
        { role: 'quit' },
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
