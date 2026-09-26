import { BrowserWindow, dialog, screen, type NativeImage } from 'electron';
import { IPC, type Rect, type SettingsState } from '../shared/ipc';
import { loadShell, preloadPath } from './renderer';
import { paintsFrames } from './serverWindow';
import { settingsBounds, type SettingsHandle } from './settingsWindow';

/** What Settings asks for: room for four servers and the add form without scrolling. */
const SIZE = { width: 520, height: 640 };

export interface SettingsWindow extends SettingsHandle {
    readonly window: BrowserWindow;
    /** Sends Settings its state. A no-op once the page is gone. */
    push(state: SettingsState): void;
    /** What Settings wears changed — the app theme, or the theme being edited: the window's own ground follows, as a game window's does in `themeChanged`. */
    setBackground(colour: string): void;
    /** Resolves once the page has loaded, for capture. */
    readonly loaded: Promise<void>;
    /** Whether the page paints, as a server window's `settle` answers for its shell: a page that is not painting would hand capture its last frame. */
    settle(): Promise<boolean>;
    /** The page as it is drawn now, for capture. Named for the shot it takes, a shell shot, so capture can treat it as any other. */
    captureShell(): Promise<NativeImage>;
}

/**
 * Builds the Settings window: the seam between the rules in
 * `settingsWindow.ts` and Electron, holding none of its own, as `paneHost.ts`
 * does for panes.
 *
 * No parent: parented to a game window it would close with that window, and
 * it belongs to no one window.
 *
 * `closeQuestion` is what closing asks first, or null to close at once;
 * `onDiscard` runs when the answer is Discard, before the window closes.
 * `onReload` runs each time the page finishes loading, the first time
 * included.
 */
export function createSettingsWindow(opts: {
    anchor: Rect | null;
    onClosed: () => void;
    background: string;
    closeQuestion: () => { message: string; detail: string } | null;
    onDiscard: () => void;
    onReload: () => void;
}): SettingsWindow {
    const display = opts.anchor ? screen.getDisplayMatching(opts.anchor) : screen.getPrimaryDisplay();
    const win = new BrowserWindow({
        ...settingsBounds(opts.anchor, SIZE, display.workArea),
        minWidth: 380,
        minHeight: 420,
        title: 'Settings',
        // The ground of what Settings wears — the app theme, or the theme
        // being edited: what shows before the page draws, and at an edge a
        // resize has not yet repainted. `setBackground` keeps it to the theme
        // after a change.
        backgroundColor: opts.background,
        show: false,
        // No initial pin: `openSettings` in index.ts sets it right after this
        // returns, to match whichever window asked (or the app's remembered
        // pin with none), and does so again on a re-open — a pin set here
        // once would not follow a second gear pressed on an already-open
        // Settings.
        // Windows and Linux hang the app menu on every window; here, the
        // pane and tab items — Split, Close Pane, Close Tab, Even Out,
        // Select Tab — have nothing to act on. Everything else still does,
        // and every shortcut still fires.
        autoHideMenuBar: true,
        webPreferences: {
            preload: preloadPath(),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true
        }
    });
    // `loadShell`, below, holds the page to itself, as it does a game window's shell.
    // Keep "Settings": the page's own <title> is the shell's.
    win.on('page-title-updated', event => event.preventDefault());
    win.once('ready-to-show', () => win.show());
    win.on('closed', opts.onClosed);
    // Asked here and decided in `appearance.closeQuestion`: a draft with
    // changes asks before it is thrown away, since every window reverts with
    // it. Prevented synchronously, as `close` must be, and closed again once
    // the answer is Discard. A close while the question is up — Cmd/Ctrl+W
    // again — is refused rather than asked twice.
    let discarded = false;
    let asking = false;
    win.on('close', event => {
        if (discarded) return;
        if (asking) {
            event.preventDefault();
            return;
        }
        const question = opts.closeQuestion();
        if (!question) return;
        event.preventDefault();
        asking = true;
        void dialog
            .showMessageBox(win, { type: 'question', buttons: ['Keep Editing', 'Discard'], defaultId: 0, cancelId: 0, message: question.message, detail: question.detail })
            .then(({ response }) => {
                asking = false;
                if (response !== 1 || win.isDestroyed()) return;
                discarded = true;
                opts.onDiscard();
                win.close();
            });
    });
    // A page that loads again has no editor open, so a draft left behind would
    // be worn by every window with nothing on screen to end it: Vite's full
    // reload in development, or a reload from the developer tools.
    win.webContents.on('did-finish-load', opts.onReload);
    // Read now: once the window closes its contents are destroyed and the id with them.
    const contentsId = win.webContents.id;
    const loaded = new Promise<void>(resolve => win.webContents.once('did-finish-load', () => resolve()));
    loadShell(win.webContents, 'settings');
    return {
        window: win,
        contentsId,
        loaded,
        focus: () => {
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
        },
        settle: () => paintsFrames(win.webContents),
        captureShell: () => win.webContents.capturePage(),
        push: state => {
            if (win.isDestroyed() || win.webContents.isDestroyed()) return;
            win.webContents.send(IPC.settingsState, state);
        },
        setBackground: colour => {
            if (!win.isDestroyed()) win.setBackgroundColor(colour);
        }
    };
}
