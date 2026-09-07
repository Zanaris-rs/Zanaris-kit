import { app, Menu, type MenuItemConstructorOptions } from 'electron';
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
    /** Opens a web page in the system browser: the release page, the repository. */
    openExternal(url: string): void;
}

/**
 * The application menu is where new windows come from; there is no launcher.
 * Native menus follow the platform's Title Case; everything the renderer
 * draws is sentence case. Rebuilt whenever the catalog changes so the server
 * submenu stays current, whenever the switch warning is turned on or off so
 * its checkbox agrees, and once more when a newer release is found.
 */
export function installMenu(servers: readonly ServerDef[], actions: MenuActions, warnOnSwitch: boolean, update: LatestRelease | null): void {
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
                { label: 'Toggle Panel', accelerator: 'CmdOrCtrl+\\', click: () => actions.togglePanel() },
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
