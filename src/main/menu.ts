import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';
import type { ServerDef } from '../shared/catalog';
import { serverMenuLabel } from './catalog';
import type { LatestRelease } from './update';

export interface MenuActions {
    /** Another window of the focused window's server, or of the first server when none is focused. */
    newWindow(): void;
    newWindowFor(serverId: string): void;
    /** Opens servers.json in the system editor. */
    editServers(): void;
    reloadServers(): void;
    togglePanel(): void;
    /** Whether a world or detail switch is confirmed before it reloads the game. */
    setWarnOnSwitch(value: boolean): void;
    /** Pins the focused window above other apps, and remembers the choice for the windows opened after it. */
    setAlwaysOnTop(value: boolean): void;
    /** Opens a web page in the system browser: the release page, the repository. */
    openExternal(url: string): void;
}

/**
 * The application menu is where new windows come from; there is no launcher.
 * Native menus follow the platform's Title Case; everything the renderer
 * draws is sentence case. Rebuilt whenever the catalog changes so the server
 * submenu stays current, whenever the switch warning is turned on or off so
 * its checkbox agrees, when either of the two window-scoped items below would
 * change, and once more when a newer release is found.
 *
 * `window` holds the inputs that belong to a window rather than to the app:
 * there is one menu for every window, so they track whichever has focus, and
 * both read false when none does — each item acts on the focused window, and
 * with no focus there is nothing for either to act on. Everything else here is
 * the app's and is the same whatever is in front.
 */
export interface MenuWindowState {
    /** Whether the focused window's side column has anything that could open in it. */
    panelAvailable: boolean;
    /** Whether the focused window is pinned above other apps. */
    alwaysOnTop: boolean;
}

export function installMenu(
    servers: readonly ServerDef[],
    actions: MenuActions,
    warnOnSwitch: boolean,
    update: LatestRelease | null,
    window: MenuWindowState
): void {
    const isMac = process.platform === 'darwin';
    const serverItems = (): MenuItemConstructorOptions[] =>
        servers.length === 0
            ? [{ label: 'No servers in the list', enabled: false }]
            : servers.map(server => ({ label: serverMenuLabel(server), click: () => actions.newWindowFor(server.id) }));

    const template: MenuItemConstructorOptions[] = [
        ...(isMac ? [{ role: 'appMenu' as const }] : []),
        {
            label: 'File',
            submenu: [
                { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => actions.newWindow() },
                { label: 'New Window For', submenu: serverItems() },
                { type: 'separator' },
                { label: 'Edit Server List…', click: () => actions.editServers() },
                { label: 'Reload Server List', click: () => actions.reloadServers() },
                { type: 'separator' },
                { role: 'close' }
            ]
        },
        { role: 'editMenu' },
        {
            label: 'View',
            submenu: [
                // The only way back once the switch dialog's "Don't ask again" has been ticked.
                { label: 'Warn Before Switching Worlds', type: 'checkbox', checked: warnOnSwitch, click: item => actions.setWarnOnSwitch(item.checked) },
                { type: 'separator' },
                // Disabled rather than hidden where the panel has no legal
                // occupant — a chat-only server with chat in the dock — so the
                // shortcut reads as unavailable here instead of broken.
                { label: 'Toggle Panel', accelerator: 'CmdOrCtrl+\\', enabled: window.panelAvailable, click: () => actions.togglePanel() },
                // Acts on the focused window and reads back from it, so with
                // nothing focused it is disabled rather than showing the
                // remembered value as though some window were wearing it.
                {
                    label: 'Always on Top',
                    type: 'checkbox',
                    checked: window.alwaysOnTop,
                    enabled: BrowserWindow.getFocusedWindow() !== null,
                    click: item => actions.setAlwaysOnTop(item.checked)
                },
                { type: 'separator' },
                { role: 'togglefullscreen' },
                { role: 'toggleDevTools' }
            ]
        },
        { role: 'windowMenu' },
        {
            role: 'help',
            submenu: [
                ...(update?.newer ? [{ label: `Update Available: ${update.latest}`, click: () => actions.openExternal(update.url) }] : []),
                { label: 'Zanaris Kit on GitHub', click: () => actions.openExternal('https://github.com/Zanaris-rs/Zanaris-kit') }
            ]
        }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));

    // With no windows open on macOS the dock is the other way in.
    if (isMac) app.dock?.setMenu(Menu.buildFromTemplate([{ label: 'New Window For', submenu: serverItems() }]));
}
