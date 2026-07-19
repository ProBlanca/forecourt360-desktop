// Preload script, run in an isolated context before the FMS web page loads.
//
// contextIsolation is on and nodeIntegration is off (see main.js), so the
// web page itself has zero access to Node.js or Electron APIs - it behaves
// exactly like it does in a regular browser tab. This file intentionally
// exposes nothing to the page. It exists as a place to add a minimal,
// explicit bridge later (via contextBridge.exposeInMainWorld) if a future
// feature ever needs it, without weakening the security boundary by
// default.
