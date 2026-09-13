import { PANE_MIN_HEIGHT, PANE_MIN_WIDTH, SEAM } from '../shared/layout.ts';
import type { ToolId } from '../shared/ipc.ts';
import { contentOf, paneIds, parentSplitOf, type PaneContent, type PaneNode } from './paneTree.ts';

/**
 * What a pane is called, and what its two menus offer: the gestures a
 * right-click gives it, and the contents its header's dropdown can put in it —
 * followed there by the gesture menu's two splits.
 *
 * Pure and tested for the usual reason, and for one specific to a menu: an item
 * that is offered and then refused is worse than one that was never offered,
 * and whether a split is legal depends on the same minimums the solver
 * enforces. Working that out here means the menu and the layout cannot
 * disagree — the alternative is the shell guessing, which `CLAUDE.md` calls a
 * defect rather than a shortcut. The launcher inside an empty pane is the same
 * list in a different dress and is built from the same function, so the two
 * cannot come to offer different things.
 */

export interface PaneMenuItem {
    id: 'split-x' | 'split-y' | 'even-out' | 'close';
    label: string;
    enabled: boolean;
    /**
     * The View menu's shortcut for the same act, shown beside the item so a
     * menu teaches it. Shown, not registered: the application menu already
     * owns these shortcuts, and a popup menu is not where they should live.
     */
    accelerator: string;
}

/** One of this server's curated links, as much of it as naming a pane needs. */
export interface PaneLink {
    url: string;
    name: string;
}

/** What the header's dropdown and the launcher both offer: one thing the pane could become. */
export interface PaneContentItem {
    content: PaneContent;
    label: string;
    /** The launcher's grouping, kept here so the native menu can rule the same lines. */
    group: 'tool' | 'game' | 'link';
    /** True when the pane already holds exactly this, so a menu can mark it and the launcher can say "open". */
    current: boolean;
}

const TOOL_NAMES: Record<ToolId, string> = { chat: 'Chat', worlds: 'Worlds', hiscores: 'Hiscores', singleplayer: 'Single player' };

/**
 * What a pane's header calls it.
 *
 * A page is named for the catalog's curated link rather than for the page's own
 * `<title>`: the name is the pane's identity, and a title that changes as you
 * click through a wiki is the pane's *content* moving under a name that should
 * not. A bookmark the server no longer offers falls back to its url, which is
 * ugly and honest — a blank header would leave a pane with no name at all.
 */
export function paneName(content: PaneContent, links: readonly PaneLink[] = []): string {
    switch (content.kind) {
        case 'empty':
            return 'Empty';
        case 'game':
            return 'Game';
        case 'tool':
            return TOOL_NAMES[content.tool];
        case 'page':
            return links.find(link => link.url === content.bookmark)?.name ?? content.bookmark;
    }
}

/**
 * Everything a pane may be turned into: this window's tools, the game, and this
 * server's links, in that order.
 *
 * The game is never refused and never greyed. There is one game view per
 * window, so choosing it *moves* the game out of whatever pane holds it —
 * which costs nothing, since the view is repositioned rather than reloaded —
 * and the label says so. The old answer greyed the row while a game lived
 * anywhere, and a launcher can only see the tab it is drawn in, so in a second
 * tab the row looked live and main silently refused it.
 */
export function paneContentItems(opts: { trees: readonly PaneNode[]; paneId: string; tools: readonly ToolId[]; links: readonly PaneLink[] }): PaneContentItem[] {
    const here = opts.trees.reduce<PaneContent | null>((found, tree) => found ?? contentOf(tree, opts.paneId), null);
    const gameElsewhere = here?.kind !== 'game' && opts.trees.some(tree => paneIds(tree).some(id => contentOf(tree, id)?.kind === 'game'));
    const item = (content: PaneContent, group: PaneContentItem['group'], label?: string): PaneContentItem => ({
        content,
        label: label ?? paneName(content, opts.links),
        group,
        current: here !== null && sameContent(here, content)
    });
    return [
        ...opts.tools.map(tool => item({ kind: 'tool', tool }, 'tool')),
        item({ kind: 'game' }, 'game', gameElsewhere ? 'Move game here' : undefined),
        ...opts.links.map(link => item({ kind: 'page', bookmark: link.url }, 'link'))
    ];
}

function sameContent(a: PaneContent, b: PaneContent): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'page' && b.kind === 'page') return a.bookmark === b.bookmark;
    if (a.kind === 'tool' && b.kind === 'tool') return a.tool === b.tool;
    return true;
}

/** Whether one extent can hold two panes and the seam between them. */
function halvable(extent: number, floor: number): boolean {
    return extent >= floor * 2 + SEAM;
}

/**
 * Whether closing a pane would do anything.
 *
 * Every pane can be closed but one: the tab's only pane when it is already
 * empty. The last pane in a tab empties rather than vanishing — a close that
 * cascaded pane to tab to window would turn one keystroke into a disconnect —
 * so closing that one would empty an empty pane, and a control that does
 * nothing is the same failure as one offered and then refused. The right-click
 * menu and the header's close both ask this, so the two cannot disagree.
 */
export function canClosePane(tree: PaneNode, paneId: string): boolean {
    const content = contentOf(tree, paneId);
    if (content === null) return false;
    return !(tree.kind === 'leaf' && content.kind === 'empty');
}

export function paneMenuItems(tree: PaneNode, paneId: string, rect: { width: number; height: number }): PaneMenuItem[] {
    const isGame = contentOf(tree, paneId)?.kind === 'game';
    return [
        { id: 'split-x', label: 'Split Right', enabled: halvable(rect.width, PANE_MIN_WIDTH), accelerator: 'CmdOrCtrl+D' },
        { id: 'split-y', label: 'Split Down', enabled: halvable(rect.height, PANE_MIN_HEIGHT), accelerator: 'CmdOrCtrl+Shift+D' },
        // Nothing to even out when the pane is the whole tab: there are no
        // siblings to share with, and the item would be a no-op wearing the
        // same face as the working one.
        { id: 'even-out', label: 'Even Out', enabled: parentSplitOf(tree, paneId) !== null, accelerator: 'CmdOrCtrl+Alt+=' },
        {
            id: 'close',
            // Named for what it costs. Closing the game destroys its view and
            // disconnects the player — there is a confirm behind it, but a menu
            // item that reads the same as the harmless one is a menu item that
            // gets clicked by accident first and read second.
            label: isGame ? 'Close Game' : 'Close Pane',
            // The last pane in a tab empties rather than vanishing, so there is
            // no state this can leave the window in that it cannot draw — the
            // one pane it is withheld from is the lone one already empty.
            enabled: canClosePane(tree, paneId),
            accelerator: 'CmdOrCtrl+W'
        }
    ];
}

/**
 * The two ways to make a new pane, for the header's dropdown.
 *
 * The same items the right-click menu opens with, taken from it rather than
 * restated, so the dropdown greys a split under exactly the floor the gesture
 * menu does. They are repeated there because a right-click is invisible: the
 * arrow on the header is the one control a player can see, and a menu reached
 * from it that could change a pane but not add one left splitting as something
 * only the people who already knew about it would ever do. Even Out and Close
 * stay off it — the close sits beside the arrow already, and evening out is
 * about the panes around this one rather than this one.
 */
export function paneSplitItems(tree: PaneNode, paneId: string, rect: { width: number; height: number }): PaneMenuItem[] {
    return paneMenuItems(tree, paneId, rect).filter(item => item.id === 'split-x' || item.id === 'split-y');
}
