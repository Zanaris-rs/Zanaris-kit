import { BrowserWindow, screen } from 'electron';
import { IPC, type Rect, type SettingsState } from '../shared/ipc';
import { loadShell, preloadPath } from './renderer';
import { settingsBounds, type SettingsHandle } from './settingsWindow';

/** What Settings asks for: room for four servers and the add form without scrolling. */
const SIZE = { width: 520, height: 640 };

export interface SettingsWindow extends SettingsHandle {
    readonly window: BrowserWindow;
    /** Sends Settings its state. A no-op once the page is gone. */
    push(state: SettingsState): void;
}

/**
 * Builds the Settings window: the seam between the rules in
 * `settingsWindow.ts` and Electron, holding none of its own, as `paneHost.ts`
 * does for panes.
 *
 * No parent: parented to a game window it would close with that window, and
 * it belongs to no one window.
 */
export function createSettingsWindow(opts: { anchor: Rect | null; alwaysOnTop: boolean; onClosed: () => void }): SettingsWindow {
    const display = opts.anchor ? screen.getDisplayMatching(opts.anchor) : screen.getPrimaryDisplay();
    const win = new BrowserWindow({
        ...settingsBounds(opts.anchor, SIZE, display.workArea),
        minWidth: 380,
        minHeight: 420,
        title: 'Settings',
        backgroundColor: '#17120d',
        show: false,
        // Beside a pinned game window, an unpinned Settings would open behind it.
        alwaysOnTop: opts.alwaysOnTop,
        // Windows and Linux hang the app menu on every window, and nothing in it
        // but Settings… acts here. Its shortcuts still fire.
        autoHideMenuBar: true,
        webPreferences: {
            preload: preloadPath(),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true
        }
    });
    // The page is the kit's own, but the names and notes on it come from
    // servers.json, which people edit by hand. React renders them as text; this
    // is the line behind that, and the shell has no need of it because it shows
    // nothing of the kind.
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    // Keep "Settings": the page's own <title> is the shell's.
    win.on('page-title-updated', event => event.preventDefault());
    win.once('ready-to-show', () => win.show());
    win.on('closed', opts.onClosed);
    // Read now: once the window closes its contents are destroyed and the id with them.
    const contentsId = win.webContents.id;
    loadShell(win.webContents, 'settings');
    return {
        window: win,
        contentsId,
        focus: () => {
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
        },
        push: state => {
            if (win.isDestroyed() || win.webContents.isDestroyed()) return;
            win.webContents.send(IPC.settingsState, state);
        }
    };
}
