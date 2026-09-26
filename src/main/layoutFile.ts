import { leaf, split, type PaneContent, type PaneNode, type Size } from './paneTree.ts';
import type { PaneLink } from './paneMenu.ts';
import { TOOL_IDS, type ToolId } from '../shared/ipc.ts';

/**
 * A saved setup: one tab's panes, as a file the player chose to write.
 *
 * Nothing is saved on its own any more. The window used to write its whole
 * arrangement to `state.json` after every split and every seam drag, which made
 * "how I left it" and "how I want it" the same thing — so an experiment could
 * not be walked away from, and there was nothing to hand anyone else. A setup
 * is now a file, saved from the tab bar's Setups menu into that server's own
 * `setups/` folder, opened from the same menu, and shared by copying it.
 *
 * Pure for the reason every rule in this kit is, and for one of its own: a file
 * that came from somebody else is untrusted input, so what it may contain and
 * what it turns into in *this* window are decided here, where a test can reach
 * them, rather than in the window that acts on the answer.
 */

/** What the file says it is, so a stray `.json` in the folder is refused rather than half-read. */
export const LAYOUT_KIND = 'zanaris-kit-layout';
export const LAYOUT_VERSION = 1;

/**
 * A pane tree as a file holds it: its shape, its seams and what each pane
 * shows, with none of the ids.
 *
 * The ids are the window's, not the setup's. A view is keyed by its pane id for
 * as long as it lives, and a tab opened beside others would collide with them if
 * it brought its own — so a file carries none, and `instantiateLayout` hands out
 * fresh ones from the window's counters on the way in.
 */
export type StoredNode = { kind: 'leaf'; content: PaneContent } | { kind: 'split'; axis: 'x' | 'y'; fractions: number[]; children: StoredNode[] };

export function storeTree(node: PaneNode): StoredNode {
    if (node.kind === 'leaf') return { kind: 'leaf', content: node.content };
    return { kind: 'split', axis: node.axis, fractions: [...node.fractions], children: node.children.map(storeTree) };
}

/**
 * The file's text. `server` is a note about where it was made, not a lock: a
 * setup saved on one server opens on another, and whatever that server does
 * not offer comes up empty (see `instantiateLayout`).
 *
 * `size` is the tab's own size in pixels when it was saved. It is what lets a
 * setup open with every pane at the size it was saved at and the window sized
 * around them (`paneTree.arrangeForGame`), where fractions alone would stretch
 * or squeeze everything, the game included, to whatever window it opens in.
 */
export function writeLayout(tree: PaneNode, serverId: string, size?: Size): string {
    const sized = size ? { size: { width: Math.round(size.width), height: Math.round(size.height) } } : {};
    return `${JSON.stringify({ kind: LAYOUT_KIND, version: LAYOUT_VERSION, server: serverId, ...sized, tree: storeTree(tree) }, null, 2)}\n`;
}

/** A setup's size: no side under a pixel or past any display there is. */
const SIZE_MAX = 16384;

/**
 * A setup file's tree and the size it was saved at, or null when anything at
 * all about it is wrong.
 *
 * Refused whole rather than repaired, as saved setups always were: a half-
 * understood file is a tab that opens wrong with nothing to say about why,
 * while a refusal can say "that isn't a setup" and leave the tab as it was.
 *
 * The refusals that are not merely shape: at most one game, because the window
 * has exactly one game view and a second leaf would point at nothing; and a
 * version newer than this kit knows, because a later kit may mean something by
 * it that this one would silently get wrong. A file with no size is a setup
 * saved before sizes were, and reads with a null one; a size that is there
 * and wrong refuses the file like any other bad field.
 */
export function readSetup(text: string): { tree: StoredNode; size: Size | null } | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;
    const file = parsed as Record<string, unknown>;
    if (file.kind !== LAYOUT_KIND || file.version !== LAYOUT_VERSION) return null;
    const size = file.size === undefined ? null : readSize(file.size);
    if (file.size !== undefined && size === null) return null;
    let games = 0;
    const tree = readNode(file.tree, () => games++);
    return tree && games <= 1 ? { tree, size } : null;
}

function readSize(x: unknown): Size | null {
    if (typeof x !== 'object' || x === null) return null;
    const { width, height } = x as Record<string, unknown>;
    const side = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= SIZE_MAX;
    return side(width) && side(height) ? { width, height } : null;
}

function readNode(x: unknown, countGame: () => void): StoredNode | null {
    if (typeof x !== 'object' || x === null) return null;
    const node = x as Record<string, unknown>;

    if (node.kind === 'leaf') {
        const content = readContent(node.content);
        if (!content) return null;
        if (content.kind === 'game') countGame();
        return { kind: 'leaf', content };
    }

    if (node.kind !== 'split') return null;
    const { axis, children, fractions } = node;
    if (axis !== 'x' && axis !== 'y') return null;
    // Two children at least: a split of one is the thing `paneTree`'s collapse
    // exists to prevent, so one arriving in a file is a file that has been
    // edited into a state the app cannot reach on its own.
    if (!Array.isArray(children) || children.length < 2) return null;
    if (!Array.isArray(fractions) || fractions.length !== children.length) return null;
    if (!fractions.every(f => typeof f === 'number' && Number.isFinite(f) && f > 0)) return null;
    const read: StoredNode[] = [];
    for (const child of children) {
        const node = readNode(child, countGame);
        if (!node) return null;
        read.push(node);
    }
    // Renormalised rather than required to sum to 1: floats that went through
    // JSON need not come back summing to exactly 1, and a hand-edited file is
    // likelier to say [2, 1] than [0.667, 0.333]. The solver wants a proportion.
    const total = (fractions as number[]).reduce((sum, f) => sum + f, 0);
    return { kind: 'split', axis, children: read, fractions: (fractions as number[]).map(f => f / total) };
}

function readContent(x: unknown): PaneContent | null {
    if (typeof x !== 'object' || x === null) return null;
    const content = x as Record<string, unknown>;
    if (content.kind === 'empty' || content.kind === 'game') return { kind: content.kind };
    if (content.kind === 'page') return typeof content.bookmark === 'string' && content.bookmark !== '' ? { kind: 'page', bookmark: content.bookmark } : null;
    if (content.kind !== 'tool') return null;
    return (TOOL_IDS as readonly string[]).includes(content.tool as string) ? { kind: 'tool', tool: content.tool as ToolId } : null;
}

/**
 * A stored tree made real in one window: fresh ids, and anything this window
 * cannot show turned into an empty pane.
 *
 * Empty rather than refused, because the rest of the setup is still worth
 * having. A tool this window does not offer — Hiscores on a server with
 * no lookup, Your world anywhere but its own window — and a page that is not
 * one of this server's links both come up as the launcher, which is honest
 * about the gap and one click from filling it. The page rule is not a nicety:
 * a page view may only ever hold one of the server's own links, and a file is
 * exactly the kind of input that rule exists to keep out.
 */
export function instantiateLayout(
    stored: StoredNode,
    opts: { tools: readonly ToolId[]; links: readonly PaneLink[]; nextPane: () => string; nextSplit: () => string }
): PaneNode {
    if (stored.kind === 'split') {
        return split(
            opts.nextSplit(),
            stored.axis,
            stored.children.map(child => instantiateLayout(child, opts)),
            [...stored.fractions]
        );
    }
    const content = stored.content;
    const unavailable =
        (content.kind === 'tool' && !opts.tools.includes(content.tool)) || (content.kind === 'page' && !opts.links.some(link => link.url === content.bookmark));
    return leaf(opts.nextPane(), unavailable ? { kind: 'empty' } : content);
}

/**
 * What Save This Tab as a Setup… suggests calling the file: the tab's own
 * label, made safe to be a file name on all three platforms.
 *
 * Windows is the strict one — no `<>:"/\|?*`, no control characters, no
 * trailing dot or space — and a leading dot would hide the file on the other
 * two, which in a folder whose whole point is to be opened and copied from is
 * its own kind of loss. The save dialog lets the player rename it anyway; this
 * is only the name it opens with.
 */
export function layoutFileName(label: string): string {
    const name = label
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^\.+/, '')
        .replace(/[. ]+$/, '')
        .slice(0, 80)
        .trim();
    return `${name || 'Layout'}.json`;
}

/**
 * The Setups menu's saved setups: the setup files among a folder's entries,
 * named without their extension and in the order a person would look for them.
 *
 * Hidden files are left out — `.DS_Store` is not a setup, and nor is anything
 * else a platform puts in a folder uninvited.
 */
export function layoutEntries(files: readonly string[]): { name: string; file: string }[] {
    return files
        .filter(file => !file.startsWith('.') && /\.json$/i.test(file))
        .map(file => ({ name: file.replace(/\.json$/i, ''), file }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
}
