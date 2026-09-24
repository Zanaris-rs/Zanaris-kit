import { clearGame, contentOf, leaf, paneIds, setContent, split, type PaneContent, type PaneNode } from './paneTree.ts';
import { CHAT_PREFERRED_HEIGHT, GAME_PREFERRED_HEIGHT, PANE_MIN_HEIGHT, SEAM } from '../shared/layout.ts';
import { paneName, type PaneLink } from './paneMenu.ts';

/**
 * A window's workspace tabs.
 *
 * Each is a whole arrangement — its own tree of panes and its own focus —
 * rather than a page in a strip. The window stays bound to one server for its
 * life, so a tab is a different *layout* of that server's things, not a
 * different server.
 *
 * Pure, like `paneTree` beside it, and for the same reason: which tab a close
 * lands on and what happens to the last one are exactly the corners a user
 * finds and a test should have.
 */

export interface Tab {
    id: string;
    tree: PaneNode;
    focusedPaneId: string;
}

export interface TabSet {
    tabs: Tab[];
    activeId: string;
}

/**
 * One tab holding one pane: the smallest arrangement there is, and the one a
 * window opened on before it opened on the game and chat together.
 */
export function openTabs(tabId: string, paneId: string, content: PaneContent): TabSet {
    return { tabs: [{ id: tabId, tree: leaf(paneId, content), focusedPaneId: paneId }], activeId: tabId };
}

/**
 * The arrangement a new window opens with: the game, and chat below it.
 *
 * On the game because a game window opens straight onto its game — Settings
 * is the app's one other window, and it has no tabs or panes of its own, so
 * whatever reaches this function is building a game window. With chat under
 * it because chat is the kit's own reason to be open instead of a browser
 * tab, and a pane nobody knows is there is a pane nobody opens. Below rather
 * than beside, where the 2004 client keeps its own chat box, so the
 * conversation gets the game's full width.
 *
 * `gameHeight` is the game pane's preferred height, which is the stock one
 * unless the server's client page needs more (`LOSTCITY_GAME_PREFERRED_HEIGHT`).
 *
 * The game keeps its preferred height whenever the window has room for that
 * and a chat pane above the floor: a canvas cut off at the bottom is the one
 * cost here a player cannot scroll or read past. On a display too short for
 * that, chat gives way down to the floor first and the game takes the rest;
 * only below two floors are they shared in proportion, and there the solver's
 * own minimums decide. Nothing in the tree remembers these numbers — they are
 * the shares the split starts with. A resize keeps the game at whatever size it
 * has, and Reset Game Size is the way back to these.
 *
 * Focus is on the game, so Cmd/Ctrl+D and a right-click's splits start from the
 * pane the player is looking at rather than from the chat below it.
 */
export function openWindowTabs(treeHeight: number, gameHeight: number = GAME_PREFERRED_HEIGHT): TabSet {
    const gross = Math.max(0, treeHeight - SEAM);
    const game = Math.min(gameHeight, gross - PANE_MIN_HEIGHT);
    const shares = game >= PANE_MIN_HEIGHT ? [game, gross - game] : [gameHeight, CHAT_PREFERRED_HEIGHT];
    const total = shares[0]! + shares[1]!;
    const tree = split(
        'split-1',
        'y',
        [leaf('pane-1', { kind: 'game' }), leaf('pane-2', { kind: 'tool', tool: 'chat' })],
        shares.map(share => share / total)
    );
    return { tabs: [{ id: 'tab-1', tree, focusedPaneId: 'pane-1' }], activeId: 'tab-1' };
}

export function newTab(set: TabSet, tabId: string, paneId: string): TabSet {
    return { tabs: [...set.tabs, { id: tabId, tree: leaf(paneId, { kind: 'empty' }), focusedPaneId: paneId }], activeId: tabId };
}

export function selectTab(set: TabSet, tabId: string): TabSet {
    if (set.activeId === tabId || !set.tabs.some(t => t.id === tabId)) return set;
    return { ...set, activeId: tabId };
}

export function closeTab(set: TabSet, tabId: string): TabSet | null {
    const at = set.tabs.findIndex(t => t.id === tabId);
    if (at < 0) return set;
    // The last tab closing is the window closing. Said by returning nothing
    // rather than by leaving an empty set, which would be a window with no
    // arrangement at all and nothing to draw.
    if (set.tabs.length === 1) return null;
    const tabs = set.tabs.filter(t => t.id !== tabId);
    if (set.activeId !== tabId) return { ...set, tabs };
    // The tab that took its place, or the one to its left when it was last.
    // One of the two always exists, because the list is not empty.
    const next = tabs[at] ?? tabs[at - 1]!;
    return { tabs, activeId: next.id };
}

/** Whether a tab's panes include the game. */
export function holdsGame(tree: PaneNode): boolean {
    return paneIds(tree).some(id => contentOf(tree, id)?.kind === 'game');
}

/**
 * What closing a tab would take with it, which is what decides whether the
 * close asks first.
 *
 * - `window`: it is the only tab, so closing it is closing the window, whose
 *   own confirm already says the player will be logged out. A second sheet
 *   about the same disconnect would be one too many, game or not.
 * - `game`: the game is in it. Closing it destroys the game view, exactly as
 *   closing the game's pane does, and asks first for the same reason. The one
 *   thing it must never do is drop the leaf and keep the view — a game still
 *   logged in with nowhere in the window to be shown.
 * - `tab`: nothing in it costs a login, so it just goes.
 * - `missing`: no such tab, so nothing happens.
 */
export type TabClosing = 'missing' | 'window' | 'game' | 'tab';

export function closingTab(set: TabSet, tabId: string): TabClosing {
    const tab = set.tabs.find(t => t.id === tabId);
    if (!tab) return 'missing';
    if (set.tabs.length === 1) return 'window';
    return holdsGame(tab.tree) ? 'game' : 'tab';
}

/**
 * Puts the game in a pane, taking it from wherever in the window it was.
 *
 * A move rather than a placement, and it works across every tab rather than
 * within one, because the window has exactly one game view: two game leaves are
 * unrepresentable, and the old answer — refuse the second and grey the
 * launcher's row — left the row looking live in any tab the game was not in,
 * since the launcher could only see the tab it was drawn in.
 *
 * It costs nothing to move. The view is repositioned, never reloaded, so the
 * login survives a move exactly as it survives a seam drag; `loadURL` is the
 * only thing that costs a login and nothing here calls it.
 *
 * Returns the set it was handed when the pane already holds the game or when no
 * tab has that pane, so a caller can tell by identity whether anything moved.
 */
export function moveGame(set: TabSet, paneId: string): TabSet {
    const holder = set.tabs.find(tab => paneIds(tab.tree).includes(paneId));
    if (!holder || contentOf(holder.tree, paneId)?.kind === 'game') return set;
    return {
        ...set,
        tabs: set.tabs.map(tab => {
            const tree = tab === holder ? setContent(clearGame(tab.tree), paneId, { kind: 'game' }) : clearGame(tab.tree);
            return tree === tab.tree ? tab : { ...tab, tree };
        })
    };
}

/**
 * What a tab button says: the name of its first pane, the top-left one, in the
 * words that pane's own header uses.
 *
 * Not the focused pane's. Naming a tab after focus reads fine until you use
 * one: clicking between the game and the chat beside it renamed the tab on
 * every click, which makes the bar move under the pointer for no reason the
 * user asked for. The first pane only changes when its content does, or when
 * a close, a swap or a move puts something else in that corner — each of which
 * the user did to that very pane. And not the game's either: a tab is named for
 * where it starts, so the same arrangement always reads the same, and a page
 * gets its curated link name rather than a bare "Page".
 */
export function labelOfTab(tree: PaneNode, links: readonly PaneLink[] = []): string {
    return paneName(contentOf(tree, paneIds(tree)[0]!) ?? { kind: 'empty' }, links);
}

/**
 * Loading a saved layout into one tab, and what that costs.
 *
 * The tab's panes are replaced by the layout's, and the tab is brought to the
 * front, since that is where the player asked for it. The game is the one thing
 * that needs care, because the window has one game view and the tab being
 * replaced may hold it, or the layout may want it, or both:
 *
 * - **The layout has a game pane.** The game moves into it from wherever it
 *   was — this tab or another — the same move `moveGame` makes, so it costs no
 *   reload and no login. Any other tab's game leaf is emptied in the same
 *   breath, or the window would claim two games and have one view.
 * - **This tab held the game and the layout has none.** The game's leaf goes
 *   with the old panes, which is closing the game: `dropsGame` says so, and the
 *   window asks first and destroys the view, exactly as a tab close does. It
 *   must never drop the leaf and keep the view.
 * - **Neither.** The game stays wherever it is, untouched.
 *
 * Focus lands on the game when the layout brought it — that is what the player
 * is about to look at — and otherwise on the layout's first pane.
 *
 * Null when there is no such tab.
 */
export function loadingLayout(set: TabSet, tabId: string, tree: PaneNode): { set: TabSet; dropsGame: boolean } | null {
    const target = set.tabs.find(tab => tab.id === tabId);
    if (!target) return null;
    const bringsGame = holdsGame(tree);
    const gamePane = paneIds(tree).find(id => contentOf(tree, id)?.kind === 'game');
    return {
        dropsGame: holdsGame(target.tree) && !bringsGame,
        set: {
            activeId: tabId,
            tabs: set.tabs.map(tab => {
                if (tab === target) return { id: tab.id, tree, focusedPaneId: gamePane ?? paneIds(tree)[0]! };
                if (!bringsGame) return tab;
                const cleared = clearGame(tab.tree);
                return cleared === tab.tree ? tab : { ...tab, tree: cleared };
            })
        }
    };
}

/**
 * Where the id counters have to resume so a window's first arrangement cannot
 * be handed an id something in it already answers to.
 *
 * Splits included, now that a window can open on one. Two splits answering to
 * one id in the same tree would make a seam drag ambiguous — the game-and-chat
 * split a window opens with would share `split-1` with the first split the
 * player made inside it. Panes matter for a longer-lived reason: a view is keyed
 * by a pane id for as long as it lives.
 */
export function nextIds(set: TabSet): { pane: number; tab: number; split: number } {
    const after = (values: string[], prefix: string): number =>
        values.reduce((top, value) => {
            const n = value.startsWith(prefix) ? Number(value.slice(prefix.length)) : NaN;
            return Number.isInteger(n) && n >= top ? n + 1 : top;
        }, 1);
    return {
        pane: after(set.tabs.flatMap(tab => paneIds(tab.tree)), 'pane-'),
        tab: after(set.tabs.map(tab => tab.id), 'tab-'),
        split: after(set.tabs.flatMap(tab => splitIds(tab.tree)), 'split-')
    };
}

function splitIds(node: PaneNode): string[] {
    return node.kind === 'leaf' ? [] : [node.splitId, ...node.children.flatMap(splitIds)];
}
