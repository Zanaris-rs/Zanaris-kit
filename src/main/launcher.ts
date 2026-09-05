import { BrowserWindow } from 'electron';
import { loadRenderer, preloadPath } from './renderer';

export function createLauncherWindow(onClosed: () => void): BrowserWindow {
    const win = new BrowserWindow({
        width: 460,
        height: 620,
        minWidth: 400,
        minHeight: 440,
        useContentSize: true,
        title: 'SwiftKit',
        backgroundColor: '#17120d',
        show: false,
        webPreferences: {
            preload: preloadPath(),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true
        }
    });
    win.once('ready-to-show', () => win.show());
    win.on('closed', onClosed);
    loadRenderer(win.webContents, 'launcher');
    return win;
}
