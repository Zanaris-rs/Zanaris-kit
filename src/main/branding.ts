import { join } from 'node:path';

/**
 * What the app is called wherever the OS shows a name for it. The bundle a
 * packaged build ships gets it from electron-builder.yml's productName, and
 * the test keeps the two the same. `app.name` does not: electron-builder
 * keeps productName to the bundle and leaves the package.json it packs
 * without one, so Electron names a packaged app after the package,
 * `zanaris-kit`, unless main sets this — which it does in every run.
 */
export const APP_NAME = 'Zanaris Kit';

/**
 * electron-builder.yml's appId, which the Windows installer gives the Start
 * menu shortcut. Windows shows a notification only for the app id a shortcut
 * carries, so a packaged run on Windows takes this one; the test keeps the
 * two the same.
 */
export const APP_ID = 'rs.zanaris.kit';
export const COPYRIGHT = 'Zanaris Kit contributors';

export interface DevBranding {
    /** The Dock icon, on macOS. */
    dockIcon: string;
    about: { applicationName: string; applicationVersion: string; copyright: string; iconPath: string };
}

/**
 * What an unpackaged run has to put on itself beyond the name, which main
 * sets in every run (`APP_NAME`). `npm run dev` and `npm start` run inside
 * Electron's own bundle, so without this the Dock shows Electron's atom and
 * the About panel says Electron. A packaged build carries both in its bundle
 * already — the icon, the name and the copyright in its Info.plist — so it
 * applies nothing.
 *
 * The one thing this cannot reach is the menu bar's title next to the Apple
 * menu. macOS reads that from the running bundle's Info.plist, which in dev
 * is Electron's, whatever `app.setName` says.
 *
 * `build/icon.png` is read from the repository, found from the bundle the way
 * `static/` is (`root` is two above out/main); it is not among the files the
 * pack ships, and need not be.
 */
export function devBranding(env: { packaged: boolean; root: string; version: string }): DevBranding | null {
    if (env.packaged) return null;
    const icon = join(env.root, 'build', 'icon.png');
    return {
        dockIcon: icon,
        about: { applicationName: APP_NAME, applicationVersion: env.version, copyright: COPYRIGHT, iconPath: icon }
    };
}
