import { app, Menu, type MenuItemConstructorOptions } from 'electron';
import type { ServerDef } from '../shared/catalog';
import { serverMenuLabel } from './catalog';
import type { LatestRelease } from './update';
import { THEMES, type Theme } from '../shared/themes';

export interface MenuActions {
    /** Another window of the focused window's server, or of the first server when none is focused. */
    newWindow(): void;
    newWindowFor(serverId: string): void;
    /** Opens servers.json in the system editor. */
    editServers(): void;
    reloadServers(): void;
    /** Opens the Settings window, or brings the open one forward. */
    openSettings(): void;
    splitPane(axis: 'x' | 'y'): void;
    closePane(): void;
    evenOut(): void;
    newTab(): void;
    closeTab(): void;
    /** Cmd/Ctrl+1..9. Out of range is a no-op, so a window with three tabs ignores the other six. */
    selectTabAt(index: number): void;
    /** Whether a world or detail switch is confirmed before it reloads the game. */
    setWarnOnSwitch(value: boolean): void;
    /** Pins the focused window above other apps, and remembers the choice for the windows opened after it. */
    setAlwaysOnTop(value: boolean): void;
    /** Gives the focused window's server its own theme, or null to follow the app again. */
    setServerTheme(themeId: string | null): void;
    /** Opens a web page in the system browser: the release page, the repository. */
    openExternal(url: string): void;
}

/**
 * The application menu is where new windows come from — File's own items, and
 * Settings' Open buttons behind them; there is no launcher beyond that.
 * Native menus follow the platform's Title Case; everything the renderer
 * draws is sentence case. Rebuilt whenever the catalog changes so the server
 * submenu stays current, whenever the switch warning is turned on or off so
 * its checkbox agrees, when any of the window-scoped items below would
 * change, whenever a theme changes so Server Theme's radio agrees, and once
 * more when a newer release is found.
 *
 * `window` holds the inputs that belong to a window rather than to the app:
 * there is one menu for every window, so it tracks whichever has focus. With
 * nothing focused or with Settings focused, the two booleans read false and
 * `serverTheme` null — Settings is not a game window, so neither Always on Top
 * nor Server Theme has a window of that kind to act on. Everything else here,
 * `appTheme` included, is the app's and is the same whatever is in front.
 */
export interface MenuWindowState {
    /** Whether the focused window is pinned above other apps. */
    alwaysOnTop: boolean;
    /** Whether a game window has focus — Always on Top has nothing to act on otherwise. */
    canPin: boolean;
    /** The focused game window's server's own theme, or null when it follows the app; null altogether when no game window has focus, or its server is no longer in the catalog. */
    serverTheme: { override: string | null } | null;
}

/** Native menus are Title Case; a built-in's name is sentence case, as the renderer draws it. */
const menuName = (name: string): string => name.replace(/(^|\s)\S/g, c => c.toUpperCase());

/**
 * A theme as the menu names it: a built-in title-cased, a player's own as they
 * typed it. Windows and Linux read an `&` in a label as the mark for the next
 * letter's shortcut, so a typed one is doubled there to show as itself.
 */
function themeLabel(theme: Theme, isMac: boolean): string {
    if (THEMES.some(builtIn => builtIn.id === theme.id)) return menuName(theme.name);
    return isMac ? theme.name : theme.name.replace(/&/g, '&&');
}

export function installMenu(
    servers: readonly ServerDef[],
    actions: MenuActions,
    warnOnSwitch: boolean,
    update: LatestRelease | null,
    window: MenuWindowState,
    /** The app's theme, which Same as App names, and the player's own themes, listed after the built-ins. */
    themes: { app: Theme; custom: readonly Theme[] }
): void {
    const isMac = process.platform === 'darwin';
    const serverItems = (): MenuItemConstructorOptions[] =>
        servers.length === 0
            ? [{ label: 'No servers in the list', enabled: false }]
            : servers.map(server => ({ label: serverMenuLabel(server), click: () => actions.newWindowFor(server.id) }));

    const themeItems = (list: readonly Theme[]): MenuItemConstructorOptions[] =>
        list.map(theme => ({
            label: themeLabel(theme, isMac),
            type: 'checkbox' as const,
            checked: window.serverTheme?.override === theme.id,
            click: () => actions.setServerTheme(theme.id)
        }));

    const settingsItem: MenuItemConstructorOptions = { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => actions.openSettings() };
    // Spelled out rather than `role: 'appMenu'`, which cannot take an item of
    // ours, because Settings belongs in the app menu on macOS.
    const appMenu: MenuItemConstructorOptions = {
        label: app.name,
        submenu: [
            { role: 'about' },
            { type: 'separator' },
            settingsItem,
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
        ]
    };

    const template: MenuItemConstructorOptions[] = [
        ...(isMac ? [appMenu] : []),
        {
            label: 'File',
            submenu: [
                { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => actions.newWindow() },
                { label: 'New Window For', submenu: serverItems() },
                { type: 'separator' },
                { label: 'Edit Server List…', click: () => actions.editServers() },
                { label: 'Reload Server List', click: () => actions.reloadServers() },
                ...(isMac ? [] : [settingsItem]),
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
                { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => actions.newTab() },
                { label: 'Close Tab', accelerator: 'CmdOrCtrl+Shift+W', click: () => actions.closeTab() },
                /*
                 * Hidden, because nine items of "Select Tab 1..9" is most of a
                 * menu for something nobody reads it to discover — but real, so
                 * the accelerators fire. `visible: false` still registers them.
                 */
                ...Array.from({ length: 9 }, (_unused, i) => ({
                    label: `Select Tab ${i + 1}`,
                    accelerator: `CmdOrCtrl+${i + 1}`,
                    visible: false,
                    click: () => actions.selectTabAt(i)
                })),
                { type: 'separator' as const },
                { label: 'Split Right', accelerator: 'CmdOrCtrl+D', click: () => actions.splitPane('x') },
                { label: 'Split Down', accelerator: 'CmdOrCtrl+Shift+D', click: () => actions.splitPane('y') },
                { label: 'Close Pane', accelerator: 'CmdOrCtrl+W', click: () => actions.closePane() },
                { label: 'Even Out', accelerator: 'CmdOrCtrl+Alt+=', click: () => actions.evenOut() },
                // Acts on the focused window and reads back from it, so it is
                // disabled whenever there is no game window to act on —
                // nothing focused, or Settings, which is not one — rather
                // than showing the remembered value as though some window
                // were wearing it.
                {
                    label: 'Always on Top',
                    type: 'checkbox',
                    checked: window.alwaysOnTop,
                    enabled: window.canPin,
                    click: item => actions.setAlwaysOnTop(item.checked)
                },
                // Acts on the focused window's server, so every window of that
                // server restyles, not only the one in front — which is why it
                // says Server. Disabled with no game window focused, as Always
                // on Top is, and for a window whose server Settings has
                // removed. Checkboxes, not radios: Electron ticks the first
                // item of any radio group with nothing ticked as the menu
                // opens, and the separators here make groups — so radios
                // showed two or three ticks at once. Exactly one of these is
                // ticked, and the menu is rebuilt after every change.
                {
                    label: 'Server Theme',
                    enabled: window.serverTheme !== null,
                    submenu: [
                        {
                            label: `Same as App (${themeLabel(themes.app, isMac)})`,
                            type: 'checkbox',
                            checked: window.serverTheme?.override === null,
                            click: () => actions.setServerTheme(null)
                        },
                        { type: 'separator' },
                        ...themeItems(THEMES),
                        ...(themes.custom.length > 0 ? [{ type: 'separator' as const }, ...themeItems(themes.custom)] : [])
                    ]
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
