import { Menu, type MenuItemConstructorOptions } from 'electron';

export interface MenuActions {
    newWindow(): void;
    togglePanel(): void;
}

/** Native menus follow the platform's Title Case; everything the renderer draws is sentence case. */
export function installMenu(actions: MenuActions): void {
    const isMac = process.platform === 'darwin';
    const template: MenuItemConstructorOptions[] = [
        ...(isMac ? [{ role: 'appMenu' as const }] : []),
        {
            label: 'File',
            submenu: [
                { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => actions.newWindow() },
                { type: 'separator' },
                { role: 'close' }
            ]
        },
        { role: 'editMenu' },
        {
            label: 'View',
            submenu: [
                { label: 'Toggle Panel', accelerator: 'CmdOrCtrl+\\', click: () => actions.togglePanel() },
                { type: 'separator' },
                { role: 'togglefullscreen' },
                { role: 'toggleDevTools' }
            ]
        },
        { role: 'windowMenu' }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
