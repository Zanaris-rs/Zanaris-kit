import type { WindowFrame } from '../shared/ipc.ts';
import type { ThemeLook } from '../shared/themes.ts';
import { TAB_BAR_HEIGHT } from '../shared/layout.ts';

/*
 * How the OS frames the kit's windows: the rule behind `WindowFrame`, which a
 * game window's shell and Settings each draw their top row from.
 *
 * On macOS and Windows the system's title bar is not drawn. It cannot wear a
 * theme — its colour is the system's, whatever the kit's frame is — so it sat
 * as a band above every theme. With it gone, the window's own top row runs to
 * the top edge and stands in for it: macOS draws the window buttons over that
 * row's left end, and Windows over its right.
 *
 * Windows hung the app menu in its title bar, and the menu went with it, so a
 * game window's row starts with a button that opens the menu instead
 * (`menuButton`). Every shortcut still fires: Electron registers a menu's
 * accelerators whether or not it has a bar to draw it in.
 *
 * Linux keeps the system's frame, and its menu bar in it: its window managers
 * treat a hidden title bar unevenly.
 */

/**
 * macOS's window buttons: 14px circles on a 23px pitch. Measured off a real
 * window's `standardWindowButton` frames on macOS 27, since nothing documents
 * them.
 */
export const MAC_BUTTON = { size: 14, pitch: 23 } as const;

/**
 * Where the close button's top left goes. 9 in from the left edge is macOS
 * 27's own inset. Down, the buttons' middle meets the tabs': the bar less its
 * 2px rule and the strip's 2px bevelled underside is 36, the tabs are centred
 * in that, and 18 less half a button is 11.
 */
export const MAC_BUTTONS_AT = { x: 9, y: (TAB_BAR_HEIGHT - 4) / 2 - MAC_BUTTON.size / 2 };

/** Where the top row's first control starts: past the zoom button by the same 9px the buttons sit in from the edge. */
export const MAC_BUTTONS_CLEAR = MAC_BUTTONS_AT.x + 2 * MAC_BUTTON.pitch + MAC_BUTTON.size + MAC_BUTTONS_AT.x;

/** Windows' window buttons, which Windows draws over the right end of the top row: the options `titleBarOverlay` and `setTitleBarOverlay` take. */
export interface TitleBarOverlay {
    color: string;
    symbolColor: string;
    height: number;
}

/**
 * Windows' buttons, as a window wearing `look` shows them, or null where the
 * system draws its own title bar or, on macOS, its own buttons.
 *
 * No ground of their own: Electron fills a caption button's ground only when
 * its colour has some alpha, so with none the stone shows behind them, and a
 * theme's picture through it. Their hover is a tenth of the glyph colour, and
 * close's is Windows' red. The glyphs are the theme's text colour. They stand
 * in the strip and its bevelled underside, so the 2px rule under the bar runs
 * on beneath them.
 */
export function overlayFor(platform: NodeJS.Platform, look: ThemeLook): TitleBarOverlay | null {
    if (platform !== 'win32') return null;
    return { color: '#00000000', symbolColor: look.colors.cream, height: TAB_BAR_HEIGHT - 2 };
}

/** The frame a window opens with, spread into its `BrowserWindow` options. Empty keeps the system's own. */
export function frameOptions(
    platform: NodeJS.Platform,
    look: ThemeLook
): { titleBarStyle?: 'hidden'; trafficLightPosition?: { x: number; y: number }; titleBarOverlay?: TitleBarOverlay } {
    if (platform === 'darwin') return { titleBarStyle: 'hidden', trafficLightPosition: MAC_BUTTONS_AT };
    const overlay = overlayFor(platform, look);
    return overlay ? { titleBarStyle: 'hidden', titleBarOverlay: overlay } : {};
}

/** How a window's top row is framed now. Full screen matters because macOS takes the window buttons away there. */
export function windowFrame(platform: NodeJS.Platform, fullScreen: boolean): WindowFrame {
    if (platform === 'darwin') return { ownTitleBar: true, buttonsInset: fullScreen ? 0 : MAC_BUTTONS_CLEAR, menuButton: false };
    if (platform === 'win32') return { ownTitleBar: true, buttonsInset: 0, menuButton: true };
    return { ownTitleBar: false, buttonsInset: 0, menuButton: false };
}
