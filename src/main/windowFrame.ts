import type { WindowFrame } from '../shared/ipc.ts';
import { TAB_BAR_HEIGHT } from '../shared/layout.ts';

/*
 * How the OS frames the kit's windows: the rule behind `WindowFrame`, which a
 * game window's shell and Settings each draw their top row from.
 *
 * On macOS the system's title bar is not drawn. It cannot wear a theme — its
 * colour is the system's light or dark, whatever the kit's frame is — so it
 * sat as a grey band above every theme. With it gone, the window's own top
 * row runs to the top edge and stands in for it, and macOS draws the window
 * buttons over that row's left end.
 *
 * Windows and Linux keep the system's frame. They hang the app menu in it, and
 * a window with no frame there has no menu bar.
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
 * 2px rule and the strip's 2px bevelled underside is 32, the tabs are centred
 * in that, and 16 less half a button is 9.
 */
export const MAC_BUTTONS_AT = { x: 9, y: (TAB_BAR_HEIGHT - 4) / 2 - MAC_BUTTON.size / 2 };

/** Where the top row's first control starts: past the zoom button by the same 9px the buttons sit in from the edge. */
export const MAC_BUTTONS_CLEAR = MAC_BUTTONS_AT.x + 2 * MAC_BUTTON.pitch + MAC_BUTTON.size + MAC_BUTTONS_AT.x;

/** The frame a window opens with, spread into its `BrowserWindow` options. Empty keeps the system's own. */
export function frameOptions(platform: NodeJS.Platform): { titleBarStyle?: 'hidden'; trafficLightPosition?: { x: number; y: number } } {
    if (platform !== 'darwin') return {};
    return { titleBarStyle: 'hidden', trafficLightPosition: MAC_BUTTONS_AT };
}

/** How a window's top row is framed now. Full screen matters because macOS takes the window buttons away there. */
export function windowFrame(platform: NodeJS.Platform, fullScreen: boolean): WindowFrame {
    const own = platform === 'darwin';
    return { ownTitleBar: own, buttonsInset: own && !fullScreen ? MAC_BUTTONS_CLEAR : 0 };
}
