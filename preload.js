// Preload script, run in an isolated context before the FMS web page loads.
//
// contextIsolation is on and nodeIntegration is off (see main.js), so the
// web page itself has no direct access to Node.js or Electron internals -
// it behaves like a regular browser tab. The one deliberate exception is
// this narrow bridge, used only to auto-fill the login form from a local,
// OS-encrypted credential store (see main.js). It exposes exactly three
// functions and nothing else - no file system, no shell, no arbitrary IPC.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('forecourt360Desktop', {
  getSavedLogin: () => ipcRenderer.invoke('get-saved-login'),
  saveLoginOnSubmit: (email, stationNumber, password) =>
    ipcRenderer.send('save-login-credentials', { email, stationNumber, password }),
  forgetSavedLogin: () => ipcRenderer.send('forget-saved-login'),
});
