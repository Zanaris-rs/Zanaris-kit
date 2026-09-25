import { join } from 'node:path';

/**
 * What the app is called wherever the OS shows a name for it. A packaged
 * build gets it from electron-builder.yml's productName, and the test keeps
 * the two the same.
 */
export const APP_NAME = 'Zanaris Kit';
export const COPYRIGHT = 'Zanaris Kit contributors';

export interface DevBranding {
    /** app.name: the app menu's About/Hide/Quit items and the About panel. */
    name: string;
    /** The Dock icon, on macOS. */
    dockIcon: string;
    about: { applicationName: string; applicationVersion: string; copyright: string; iconPath: string };
}

/**
 * What an unpackaged run has to put on itself. `npm run dev` and `npm start`
 * run inside Electron's own bundle, so without this the Dock shows Electron's
 * atom, the About panel says Electron, and the app menu's items name the
 * package (`zanaris-kit`) rather than the app. A packaged build carries all
 * of it in its bundle already — productName, the icon, the copyright — so it
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
        name: APP_NAME,
        dockIcon: icon,
        about: { applicationName: APP_NAME, applicationVersion: env.version, copyright: COPYRIGHT, iconPath: icon }
    };
}
