// electron-builder afterSign hook. There is no Developer ID, so the bundle
// is either ad-hoc signed by electron-builder or not signed at all; Apple
// Silicon refuses to launch the latter. Verify, and sign ad hoc if needed.
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

module.exports = async function afterSign(context) {
    if (context.electronPlatformName !== 'darwin') return;
    const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
    const verifies = () => {
        try {
            execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' });
            return true;
        } catch {
            return false;
        }
    };
    if (verifies()) {
        console.log(`  • after-sign: ${app} already verifies`);
        return;
    }
    console.log(`  • after-sign: ad-hoc signing ${app}`);
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
    if (!verifies()) throw new Error(`after-sign: ${app} still fails codesign --verify after ad-hoc signing`);
};
