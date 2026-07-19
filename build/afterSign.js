// electron-builder "afterSign" hook.
//
// The mac build intentionally skips real code signing (identity: null in
// package.json) because that requires a paid $99/year Apple Developer
// account. But a completely unsigned .app can trigger macOS's harshest
// Gatekeeper message - "app is damaged and can't be opened" - instead of
// the milder "unidentified developer, right-click to open" prompt.
//
// The fix is a free "ad-hoc" signature: codesign with identity "-" uses no
// certificate at all (no Apple account involved), but it's enough to give
// the app *a* signature, which is what avoids the "damaged" message.
//
// This only runs on macOS (electron-builder only invokes afterSign for the
// mac target), so it's a no-op / never called during the Windows build.

const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterSign(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== 'darwin') return;

  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`[afterSign] Ad-hoc signing ${appPath} (free, no Apple account, avoids "app is damaged" Gatekeeper message)`);

  execFileSync('codesign', [
    '--force',
    '--deep',
    '--sign', '-',      // "-" = ad-hoc identity, no certificate/Apple account needed
    appPath,
  ], { stdio: 'inherit' });

  console.log('[afterSign] Ad-hoc signing complete.');
};
