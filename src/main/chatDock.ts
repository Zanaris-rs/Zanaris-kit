import type { ChatHome } from '../shared/chat.ts';
import type { ToolId } from '../shared/ipc.ts';

/**
 * Where chat lives, and what the side column shows because of it.
 *
 * Until chat could dock, a window had one rule: exactly one tool is open in
 * the side column, because all three tools competed for the same 320px. Chat
 * now competes for a second region that nothing else can use, so there are
 * two regions and a set of rules about which one chat occupies — and those
 * rules have corners. Moving chat to the side must evict whatever held the
 * column; moving it to the bottom must close the panel rather than leave it
 * open on a tool nobody can see. A corner like that, discovered by a user
 * instead of a test, is a window that looks broken for no reason anyone can
 * point at. So the transition lives here, as a pure function over a small
 * state, in a file with no Electron import — the one shape `npm test` can
 * reach directly and prove exhaustively.
 */

/** Where chat is and what the side column holds. The whole of a window's tool placement. */
export interface Placement {
    home: ChatHome;
    dockOpen: boolean;
    activeTool: ToolId | null;
    panelOpen: boolean;
}

export type Action =
    /** The rail's Chat tab. */
    | { kind: 'rail-chat' }
    /** The rail's Worlds or Single player tab. */
    | { kind: 'rail-tool'; tool: ToolId }
    /** The →| control, in either home. */
    | { kind: 'move'; to: ChatHome }
    /** The strip's panel toggle. */
    | { kind: 'toggle-panel' };

/**
 * The first tool in rail order that could legally sit in the side column
 * right now. Every tool qualifies except chat while it lives at the bottom:
 * chat living in the dock and the panel at once is exactly the state these
 * rules exist to prevent, so it is skipped rather than offered as a default.
 * Null means no tool in `tools` can currently open there — a real, empty-panel
 * state, not an error.
 */
function firstLegalSideOccupant(tools: readonly ToolId[], home: ChatHome): ToolId | null {
    for (const tool of tools) {
        if (tool === 'chat' && home === 'bottom') continue;
        return tool;
    }
    return null;
}

/** `tools` is the window's rail order, needed to pick a default when the panel opens empty. */
export function reduce(state: Placement, action: Action, tools: readonly ToolId[]): Placement {
    switch (action.kind) {
        case 'rail-chat': {
            if (state.home === 'bottom') {
                // Chat at the bottom has nothing to do with the panel: the tab
                // just opens or closes the dock in place.
                return { ...state, dockOpen: !state.dockOpen };
            }
            if (state.panelOpen && state.activeTool === 'chat') {
                return { ...state, panelOpen: false };
            }
            return { ...state, activeTool: 'chat', panelOpen: true };
        }

        case 'rail-tool': {
            // Chat's own rail tab dispatches 'rail-chat', never this one. A
            // 'rail-tool' carrying 'chat' is therefore a caller mistake, not a
            // reachable state — and this is a UI reducer, not a validator, so
            // it answers a misrouted click by leaving placement alone rather
            // than throwing and taking the window down over it.
            if (action.tool === 'chat') return state;
            if (state.panelOpen && state.activeTool === action.tool) {
                return { ...state, panelOpen: false };
            }
            return { ...state, activeTool: action.tool, panelOpen: true };
        }

        case 'move': {
            if (action.to === 'bottom') {
                return {
                    home: 'bottom',
                    dockOpen: true,
                    panelOpen: false,
                    // Chat leaves the column; anything else parked there is
                    // left in place, ready to reopen the panel on its own.
                    activeTool: state.activeTool === 'chat' ? null : state.activeTool
                };
            }
            // Moving to the side is an eviction, not a merge: chat becomes the
            // column's occupant unconditionally, whatever was open before.
            return { home: 'side', dockOpen: false, activeTool: 'chat', panelOpen: true };
        }

        case 'toggle-panel': {
            if (state.panelOpen) return { ...state, panelOpen: false };
            if (state.activeTool !== null) return { ...state, panelOpen: true };
            return { ...state, panelOpen: true, activeTool: firstLegalSideOccupant(tools, state.home) };
        }
    }
}
