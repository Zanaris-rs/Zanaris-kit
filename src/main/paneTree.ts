import { COLUMN_PREFERRED_WIDTH, PANE_MIN_HEIGHT, PANE_MIN_WIDTH, SEAM } from '../shared/layout.ts';
import type { ToolId } from '../shared/ipc.ts';

/**
 * The pane tree: what a tab is arranged into, and how that arrangement maps
 * onto pixels.
 *
 * Pure, and reached by `node --test` without Electron, for the reason
 * `CLAUDE.md` gives: this is where every decidable question about the layout
 * is answered, and a corner found by a user instead of a test is a window that
 * looks broken for no reason anyone can point at.
 */

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export type PaneContent =
    | { kind: 'empty' }
    | { kind: 'game' }
    | { kind: 'page'; bookmark: string }
    | { kind: 'tool'; tool: ToolId };

export type PaneNode =
    | { kind: 'leaf'; paneId: string; content: PaneContent }
    | { kind: 'split'; splitId: string; axis: 'x' | 'y'; children: PaneNode[]; fractions: number[] };

export interface Seam {
    axis: 'x' | 'y';
    rect: Rect;
    splitId: string;
    /** The seam sits after this child of the split, so it moves children `index` and `index + 1`. */
    index: number;
}

export function leaf(paneId: string, content: PaneContent): PaneNode {
    return { kind: 'leaf', paneId, content };
}

export function split(splitId: string, axis: 'x' | 'y', children: PaneNode[], fractions: number[]): PaneNode {
    return { kind: 'split', splitId, axis, children, fractions };
}

export function layoutTree(node: PaneNode, rect: Rect): { panes: Map<string, Rect>; seams: Seam[]; splits: Map<string, number> } {
    const panes = new Map<string, Rect>();
    const seams: Seam[] = [];
    // Per split, the px it actually had to divide — what a seam drag converts
    // against. It is known only here, on the way down, since it depends on the
    // rect the split was handed rather than on anything in the tree.
    const splits = new Map<string, number>();
    walk(node, rect, panes, seams, splits);
    return { panes, seams, splits };
}

function walk(node: PaneNode, rect: Rect, panes: Map<string, Rect>, seams: Seam[], splits: Map<string, number>): void {
    if (node.kind === 'leaf') {
        panes.set(node.paneId, rect);
        return;
    }

    const across = node.axis === 'x';
    const n = node.children.length;
    const gross = (across ? rect.width : rect.height) - SEAM * (n - 1);
    splits.set(node.splitId, gross);
    const sizes = allocate(node.fractions, gross, node.children.map(child => minimumOf(child, node.axis)));

    let offset = across ? rect.x : rect.y;
    node.children.forEach((child, i) => {
        const size = sizes[i]!;
        walk(child, across ? { x: offset, y: rect.y, width: size, height: rect.height } : { x: rect.x, y: offset, width: rect.width, height: size }, panes, seams, splits);
        offset += size;
        if (i === n - 1) return;
        seams.push({
            axis: node.axis,
            rect: across ? { x: offset, y: rect.y, width: SEAM, height: rect.height } : { x: rect.x, y: offset, width: rect.width, height: SEAM },
            splitId: node.splitId,
            index: i
        });
        offset += SEAM;
    });
}

/**
 * Splits `gross` px between `fractions`, summing to `gross` exactly.
 *
 * Largest-remainder rather than a round per child, because rounding each
 * independently leaves the total short or long by a pixel or two, and the
 * error lands as a hairline of shell showing through between two native views
 * at some window sizes and not at others. The regions have to tile their
 * container exactly, which is the property `splitWindow` was careful about
 * before this and which every other bug here shows up as.
 */
function distribute(fractions: number[], gross: number): number[] {
    const exact = fractions.map(f => f * gross);
    const sizes = exact.map(value => Math.floor(value));
    // The pixels floor threw away, handed back to whoever was robbed most.
    const order = exact.map((value, i) => ({ i, remainder: value - Math.floor(value) })).sort((a, b) => b.remainder - a.remainder);
    let short = gross - sizes.reduce((sum, value) => sum + value, 0);
    for (let k = 0; short > 0 && order.length > 0; k++, short--) {
        const target = order[k % order.length]!.i;
        sizes[target] = sizes[target]! + 1;
    }
    return sizes;
}

/**
 * The least this node can be drawn at along one axis.
 *
 * A leaf's is the flat floor. A split's, along its own axis, is everything it
 * contains plus the seams between them — a minimum that omitted the seams
 * would let a deep tree claim a floor it cannot actually be drawn at, and the
 * shortfall would surface as the bottom pane clipped by a few pixels per level
 * of nesting. Across its axis every child has the full extent, so the largest
 * of them governs.
 */
export function minimumOf(node: PaneNode, axis: 'x' | 'y'): number {
    if (node.kind === 'leaf') return axis === 'x' ? PANE_MIN_WIDTH : PANE_MIN_HEIGHT;
    const children = node.children.map(child => minimumOf(child, axis));
    if (node.axis !== axis) return Math.max(...children);
    return children.reduce((sum, m) => sum + m, 0) + SEAM * (node.children.length - 1);
}

/**
 * `distribute`, with a floor under each share.
 *
 * Children that land under their minimum are pinned there and the deficit is
 * taken from the rest by their renormalised fractions, repeated until nobody
 * new drops through — at most one pass per child, since each pass pins at
 * least one. When even the minimums do not fit, every child is scaled down
 * proportionally instead: clipping everything a little is better than clipping
 * one pane to nothing, and it is reachable only at the window's own floor.
 */
function allocate(fractions: number[], gross: number, minimums: number[]): number[] {
    const floor = minimums.reduce((sum, m) => sum + m, 0);
    if (gross <= floor) return distribute(minimums.map(m => m / floor), Math.max(0, gross));

    const pinned = minimums.map(() => false);
    for (;;) {
        const free = fractions.reduce((sum, f, i) => (pinned[i] ? sum : sum + f), 0);
        const spare = gross - minimums.reduce((sum, m, i) => (pinned[i] ? sum + m : sum), 0);
        const dropped = fractions.findIndex((f, i) => !pinned[i] && (free <= 0 ? spare : (f / free) * spare) < minimums[i]!);
        if (dropped < 0) {
            const sizes = distribute(fractions.map((f, i) => (pinned[i] ? 0 : f / free)), spare);
            return minimums.map((m, i) => (pinned[i] ? m : sizes[i]!));
        }
        pinned[dropped] = true;
    }
}

/** A width and a height with no place: what a tab is laid out in, or what a pane asks to be. */
export interface Size {
    width: number;
    height: number;
}

/**
 * The tree refitted from one size to another with the game held where it was.
 *
 * Fractions alone would scale every pane with the window, and the game is the
 * one pane that should not grow: a canvas of fixed pixels in a pane bigger than
 * it is a border of nothing, and a player who sized the game tight wants it to
 * stay tight while the window changes around it. So on every split between the
 * tab's edge and the game, the game's side keeps its pixels and the panes
 * beside it share the difference in proportion to their size. When they cannot
 * — they are at their floor — the game gives way last.
 *
 * The game still grows along an axis where nothing sits beside it, since a pane
 * spanning the tab is as long as the tab: the game over chat a window opens
 * with widens with the window. Splits off the game's path keep their fractions.
 *
 * Returns the tree itself when there is no game in it or the size is unchanged.
 */
export function keepGame(node: PaneNode, from: Size, to: Size): PaneNode {
    if (from.width === to.width && from.height === to.height) return node;
    return holdGame(node, from, to, { width: 0, height: 0 });
}

/**
 * One tab's arrangement as the player left it, and what it became at the size
 * it was last drawn.
 *
 * A resize is fitted from `base` rather than from the tree on screen, and that
 * is load-bearing. Fitting frame from frame would lose the game's size for good
 * the first time a window shrank past the other panes' floors: the game gives
 * way there, and the next frame would hold it at the smaller size. Fitted from
 * the arrangement, growing the window back returns the game to where it was.
 */
export interface Fitted {
    /** The last tree a gesture produced. */
    base: PaneNode;
    /** The size `base` was arranged at. */
    from: Size;
    /** `base` fitted to `at`: the tree on screen. */
    shown: PaneNode;
    at: Size;
}

/**
 * The tree to draw at `size`, and the bookkeeping for the next one.
 *
 * `tree` is the tab's tree now. When it is still what the last fit showed,
 * nothing has changed but the size, so the arrangement is fitted again from
 * `base`. When it is anything else a gesture made it, on the tree shown at
 * `at`, so it becomes the arrangement and that is the size it was made at.
 */
export function refit(was: Fitted | null, tree: PaneNode, size: Size): Fitted {
    const kept = was !== null && was.shown === tree;
    const base = kept ? was.base : tree;
    const from = kept ? was.from : (was?.at ?? size);
    return { base, from, shown: keepGame(base, from, size), at: size };
}

/**
 * `tree` as the arrangement made at `at`, whatever size the tab is drawn at
 * next — what `makeRoom`'s tree is, since it is made for the size the window
 * is about to grow to.
 *
 * `refit` alone would take the size of the last frame, which is the size the
 * window was before it grew. Fitted from there, the growth would count as a
 * resize, and the game would be held at the size the new pane had squeezed it
 * to while the window grew around it.
 */
export function arrangedAt(tree: PaneNode, at: Size): Fitted {
    return { base: tree, from: at, shown: tree, at };
}

/**
 * A pane just added, paid for by the window rather than by the game.
 *
 * `after` is what a gesture made of `before` — Add pane's column, or a split —
 * laid out at `size`. Wherever that left the game smaller than it was, the
 * window grows by the difference, as far as `room` allows, and the game takes
 * the growth back. Every other pane keeps the pixels the gesture gave it, so
 * the new pane arrives at the size it would have had anyway.
 *
 * What `room` cannot cover the game gives, as it did before there was any
 * room: a window already filling its display has nowhere to grow. A gesture
 * that cost the game nothing — a split of any other pane, or a tab with no
 * game in it — grows nothing and returns `after` itself.
 *
 * The tree returned is arranged at `size` plus `grown` (`arrangedAt`).
 */
export function makeRoom(before: PaneNode, after: PaneNode, size: Size, room: Size): { tree: PaneNode; grown: Size } {
    const was = gameSize(before, size);
    const now = gameSize(after, size);
    const grown = {
        width: was && now ? Math.min(Math.max(0, was.width - now.width), Math.max(0, room.width)) : 0,
        height: was && now ? Math.min(Math.max(0, was.height - now.height), Math.max(0, room.height)) : 0
    };
    if (grown.width === 0 && grown.height === 0) return { tree: after, grown };
    return { tree: holdGame(after, size, { width: size.width + grown.width, height: size.height + grown.height }, grown), grown };
}

/**
 * The game back at `want`, by moving the seams around it — the game pane's
 * Reset Game Size.
 *
 * Works through the same splits `keepGame` does, taking the difference from the
 * panes beside the game down to their floors, so the game gets as close to
 * `want` as there is room for. It never reaches past the tab: along an axis the
 * game spans alone there is nobody to trade with, and a reset does not resize
 * the window — only a pane being added does that (`makeRoom`).
 *
 * Returns the tree itself when the game would not move — already at its size,
 * alone in its tab, or not in this tab — so a menu can grey the item by
 * identity.
 */
export function resetGame(node: PaneNode, size: Size, want: Size): PaneNode {
    const was = gameSize(node, size);
    if (!was) return node;
    const next = holdGame(node, size, size, { width: want.width - was.width, height: want.height - was.height });
    const now = gameSize(next, size)!;
    return now.width === was.width && now.height === was.height ? node : next;
}

function gameSize(node: PaneNode, size: Size): Size | null {
    const paneId = paneIds(node).find(id => contentOf(node, id)?.kind === 'game');
    if (!paneId) return null;
    const rect = layoutTree(node, { x: 0, y: 0, width: size.width, height: size.height }).panes.get(paneId)!;
    return { width: rect.width, height: rect.height };
}

function holdsGame(node: PaneNode): boolean {
    return node.kind === 'leaf' ? node.content.kind === 'game' : node.children.some(holdsGame);
}

/**
 * Down the game's path from `from` to `to`, the game's side of each split given
 * the px it had plus `grow` along that split's axis.
 *
 * One `grow` serves every level. A split across the axis hands each child its
 * whole extent, so the game's own change along an axis is also the change of
 * every split along that axis on its path — which is what lets a reset move
 * the outer seam by exactly the room the inner one then gives the game.
 */
function holdGame(node: PaneNode, from: Size, to: Size, grow: Size): PaneNode {
    if (node.kind === 'leaf') return node;
    const at = node.children.findIndex(holdsGame);
    if (at < 0) return node;

    const across = node.axis === 'x';
    const extent = (size: Size): number => (across ? size.width : size.height) - SEAM * (node.children.length - 1);
    const minimums = node.children.map(child => minimumOf(child, node.axis));
    const had = allocate(node.fractions, extent(from), minimums);
    const gross = extent(to);
    const held = share(had, at, had[at]! + (across ? grow.width : grow.height), gross, minimums);
    // Under the floors `allocate` scales everything and fractions do not
    // matter, so they are kept for when the window grows back.
    const sizes = held ?? allocate(node.fractions, gross, minimums);
    const resized = (size: Size, px: number): Size => (across ? { width: px, height: size.height } : { width: size.width, height: px });
    const child = holdGame(node.children[at]!, resized(from, had[at]!), resized(to, sizes[at]!), grow);
    return {
        ...node,
        children: node.children.map((c, i) => (i === at ? child : c)),
        fractions: held ? held.map(px => px / gross) : node.fractions
    };
}

/**
 * `gross` px with child `at` given `target` of it, as far as the floors allow,
 * and the rest shared by the others in proportion to what they `had`.
 *
 * Whole pixels, so the fractions made from them lay out to exactly these sizes
 * again. Null when the floors alone do not fit, where there is no share to hold.
 */
function share(had: number[], at: number, target: number, gross: number, minimums: number[]): number[] | null {
    const floors = minimums.filter((_, i) => i !== at);
    const room = gross - floors.reduce((sum, m) => sum + m, 0);
    if (room < minimums[at]!) return null;
    const held = Math.min(Math.max(target, minimums[at]!), room);
    const others = had.filter((_, i) => i !== at);
    const total = others.reduce((sum, px) => sum + px, 0);
    const weights = total > 0 ? others.map(px => px / total) : floors.map(m => m / (gross - room));
    const sizes = allocate(weights, gross - held, floors);
    sizes.splice(at, 0, held);
    return sizes;
}

/**
 * Whether one extent can hold two panes and the seam between them.
 *
 * The one test behind every way of halving a pane — the menus' Split Right and
 * Split Down, and a header dropped on another pane's edge — so none of them can
 * offer a split another would refuse.
 */
export function halvable(extent: number, floor: number): boolean {
    return extent >= floor * 2 + SEAM;
}

/**
 * Splits the named pane, putting an empty pane in the new half.
 *
 * Ids are handed in rather than counted here, so this stays a pure function of
 * its arguments — `serverWindow` owns the monotonic counter, exactly as it
 * does for page ids today.
 */
export function splitPane(node: PaneNode, paneId: string, axis: 'x' | 'y', ids: { paneId: string; splitId: string }): PaneNode {
    return insertBeside(node, paneId, axis, true, leaf(ids.paneId, { kind: 'empty' }), ids.splitId);
}

/**
 * Puts `added` beside the named leaf on `axis`, after it or before it: the
 * half of a split and of a move that is the same act.
 *
 * `splitId` names the split a lone leaf, or a leaf in a split running the other
 * way, is nested in. Along the grain it goes unused.
 */
function insertBeside(node: PaneNode, paneId: string, axis: 'x' | 'y', after: boolean, added: PaneNode, splitId: string): PaneNode {
    if (node.kind === 'leaf') {
        if (node.paneId !== paneId) return node;
        return split(splitId, axis, after ? [node, added] : [added, node], [0.5, 0.5]);
    }
    // Along the grain, the pane's own share is halved and a sibling takes the
    // other half — the parent absorbs it rather than a new split node nesting
    // inside it. Keeping the tree flat is what makes a seam drag move exactly
    // the two panes either side of it instead of reproportioning a subtree,
    // and it is why repeated splitting stays readable at any depth.
    if (node.axis === axis) {
        const at = node.children.findIndex(child => child.kind === 'leaf' && child.paneId === paneId);
        if (at >= 0) {
            const half = node.fractions[at]! / 2;
            const cut = after ? at + 1 : at;
            return {
                ...node,
                children: [...node.children.slice(0, cut), added, ...node.children.slice(cut)],
                fractions: [...node.fractions.slice(0, at), half, half, ...node.fractions.slice(at + 1)]
            };
        }
    }
    return { ...node, children: node.children.map(child => insertBeside(child, paneId, axis, after, added, splitId)) };
}

/** A pane's edge, as a dragged header is dropped on it. */
export type Side = 'left' | 'right' | 'top' | 'bottom';

/**
 * Moves a pane beside another, splitting the target on the side it was dropped
 * on — what a header dragged onto another pane's edge does.
 *
 * The pane is lifted out the way a close takes it, then put back the way a split
 * adds one: along the grain of the target's split it becomes a sibling taking
 * half the target's share, and across it the target nests in a new split with
 * it. Lifting comes first because it can change the answer. Taking the pane out
 * can collapse the split it was in, and when the target was in that split, which
 * way the target's parent runs is only known afterwards.
 *
 * The leaf keeps its id, for the reason `swapPanes` gives: a page's view is
 * keyed by it, so a page moved under a fresh id would reload.
 *
 * Returns the tree itself, by identity, when there is nothing to do: a pane
 * dropped on itself, a pane that is not in this tree, or a pane already directly
 * on that side of its target. That last would otherwise halve the two panes'
 * shares and nothing more, which reads as the drop having gone wrong.
 */
export function movePane(node: PaneNode, from: string, to: string, side: Side, splitId: string): PaneNode {
    const content = contentOf(node, from);
    if (from === to || !content || !contentOf(node, to)) return node;
    const axis = side === 'left' || side === 'right' ? 'x' : 'y';
    const after = side === 'right' || side === 'bottom';
    if (besideAlready(node, from, to, axis, after)) return node;
    return insertBeside(closePane(node, from), to, axis, after, leaf(from, content), splitId);
}

/** Whether `from` is the leaf directly after (or before) `to` in a split running along `axis`. */
function besideAlready(node: PaneNode, from: string, to: string, axis: 'x' | 'y', after: boolean): boolean {
    if (node.kind === 'leaf') return false;
    if (node.axis === axis) {
        const at = node.children.findIndex(child => child.kind === 'leaf' && child.paneId === to);
        if (at >= 0) {
            const neighbour = node.children[after ? at + 1 : at - 1];
            return neighbour?.kind === 'leaf' && neighbour.paneId === from;
        }
    }
    return node.children.some(child => besideAlready(child, from, to, axis, after));
}

/**
 * Adds a pane holding `content` as a new column down the tab's right edge —
 * what the tab bar's Add pane does.
 *
 * The whole tab's edge rather than beside the focused pane, because the control
 * that asks for it sits in the tab bar and belongs to no pane: a new pane landing
 * wherever focus happened to be is a guess the player cannot see coming. A tab
 * that is already a row gains a child, as a split along the grain does, so the
 * tree stays flat; any other tab is wrapped in a new row beside it.
 *
 * The column asks for `COLUMN_PREFERRED_WIDTH` of `width`, the px the tab is
 * laid out in, capped at an even share of the row. Whatever it takes comes out
 * of the columns already there in proportion, so their seams keep their
 * relative places. Whether it fits at all is `canAppendColumn`'s to say. The
 * game's part of that is then handed back by growing the window (`makeRoom`),
 * which is the host's to do with this tree, not this function's.
 */
export function appendColumn(node: PaneNode, content: PaneContent, width: number, ids: { paneId: string; splitId: string }): PaneNode {
    const row = node.kind === 'split' && node.axis === 'x' ? node : null;
    const columns = row ? row.children.length : 1;
    const gross = width - SEAM * columns;
    const even = 1 / (columns + 1);
    const share = gross > 0 ? Math.min(COLUMN_PREFERRED_WIDTH / gross, even) : even;
    const added = leaf(ids.paneId, content);
    if (row) return { ...row, children: [...row.children, added], fractions: [...row.fractions.map(f => f * (1 - share)), share] };
    return split(ids.splitId, 'x', [node, added], [1 - share, share]);
}

/** Whether a new column fits in `width` px with every column, the new one included, above its floor. */
export function canAppendColumn(node: PaneNode, width: number): boolean {
    return minimumOf(node, 'x') + SEAM + PANE_MIN_WIDTH <= width;
}

/**
 * Removes the named pane, and gives its share to whoever is left.
 *
 * Closing never empties a tab: the last pane standing becomes an empty one,
 * because a close that cascaded pane to tab to window would turn one keystroke
 * into a disconnect now that the game is an ordinary pane.
 */
export function closePane(node: PaneNode, paneId: string): PaneNode {
    if (node.kind === 'leaf') return node.paneId === paneId ? leaf(node.paneId, { kind: 'empty' }) : node;

    const at = node.children.findIndex(child => child.kind === 'leaf' && child.paneId === paneId);
    if (at < 0) return collapse(absorb({ ...node, children: node.children.map(child => closePane(child, paneId)) }));

    const children = node.children.filter((_, i) => i !== at);
    const kept = node.fractions.filter((_, i) => i !== at);
    const total = kept.reduce((sum, f) => sum + f, 0);
    return collapse({ ...node, children, fractions: kept.map(f => f / total) });
}

/**
 * A split holding one child is that child.
 *
 * Without this the tree accumulates single-child splits, and then a split
 * along what looks like the parent's axis finds a stranger between it and its
 * real parent and nests instead of appending — so close-then-split stops
 * behaving like split on a fresh pane, and the seams drift by a few pixels
 * every time. The one place it is load-bearing is the recursive branch above,
 * where a child that has just collapsed has to be seen as a leaf by the
 * parent that is about to be rebuilt around it.
 */
function collapse(node: PaneNode): PaneNode {
    if (node.kind === 'leaf' || node.children.length !== 1) return node;
    return node.children[0]!;
}

/**
 * A child split running the same way as its parent is merged into it, each of
 * its panes keeping the share of the whole it had.
 *
 * `collapse` can produce one: a row that loses a pane and collapses into the
 * column it held lands as a column inside a column. That nesting is
 * invisible, but it behaves wrongly. Even Out reaches only the inner panes, the
 * seam above them moves them as one, and a pane dropped below its neighbour
 * cannot see that it is already there. Splitting and moving never nest a
 * split along its parent's grain, so a close is the only place one can appear,
 * and this is where it is taken apart again.
 */
function absorb(node: PaneNode): PaneNode {
    if (node.kind === 'leaf' || !node.children.some(child => child.kind === 'split' && child.axis === node.axis)) return node;
    const children: PaneNode[] = [];
    const fractions: number[] = [];
    node.children.forEach((child, i) => {
        const share = node.fractions[i]!;
        if (child.kind === 'split' && child.axis === node.axis) {
            children.push(...child.children);
            fractions.push(...child.fractions.map(f => f * share));
        } else {
            children.push(child);
            fractions.push(share);
        }
    });
    return { ...node, children, fractions };
}

/**
 * Moves one seam: sets child `index` to `fraction` of its split, and gives the
 * difference to child `index + 1`.
 *
 * Only the two panes either side move. Every other child keeps the share it
 * had, which is what a splitter is expected to do and what keeps a drag at one
 * end of a row from reproportioning the other end of it.
 *
 * `gross` is the px the split has to divide, seams already taken off, and is
 * here only so the minimums — which are px — can be enforced in fractions. The
 * clamp lives here rather than in the renderer for the reason `grip.tsx`
 * documents at length: main owns the range, and a second copy of it in the
 * shell is a second copy to keep in step.
 */
export function setFraction(node: PaneNode, splitId: string, index: number, fraction: number, gross: number): PaneNode {
    if (node.kind === 'leaf') return node;
    if (node.splitId !== splitId) return { ...node, children: node.children.map(child => setFraction(child, splitId, index, fraction, gross)) };

    const next = node.children[index + 1];
    const here = node.children[index];
    if (!here || !next || gross <= 0) return node;

    const pair = node.fractions[index]! + node.fractions[index + 1]!;
    const lower = minimumOf(here, node.axis) / gross;
    const upper = pair - minimumOf(next, node.axis) / gross;
    // A split too small to hold both minimums has no legal position to stop
    // at; leaving it alone beats picking an arbitrary one, and `allocate`
    // is what actually draws it.
    if (lower > upper) return node;

    const settled = Math.min(Math.max(fraction, lower), upper);
    const fractions = [...node.fractions];
    fractions[index] = settled;
    fractions[index + 1] = pair - settled;
    return { ...node, fractions };
}

/** Puts something in a pane. What the launcher and a header's dropdown both do. */
export function setContent(node: PaneNode, paneId: string, content: PaneContent): PaneNode {
    if (node.kind === 'leaf') return node.paneId === paneId ? leaf(paneId, content) : node;
    return { ...node, children: node.children.map(child => setContent(child, paneId, content)) };
}

/**
 * The game leaf, wherever it is in this tree, emptied.
 *
 * Half of moving the game: there is one game view per window, so putting it
 * somewhere means taking it from where it was. The pane it leaves stays — it
 * becomes empty and shows the launcher — because the game moving out of a pane
 * is not the pane closing, and a split that silently healed under the user
 * would rearrange panes they never asked to lose.
 *
 * Returns the tree it was handed when there is no game in it, so a caller can
 * tell by identity whether anything moved.
 */
export function clearGame(node: PaneNode): PaneNode {
    if (node.kind === 'leaf') return node.content.kind === 'game' ? leaf(node.paneId, { kind: 'empty' }) : node;
    const children = node.children.map(clearGame);
    return children.some((child, i) => child !== node.children[i]) ? { ...node, children } : node;
}

/** Every pane in the tree, left to right and top to bottom. */
export function paneIds(node: PaneNode): string[] {
    return node.kind === 'leaf' ? [node.paneId] : node.children.flatMap(paneIds);
}

/** What a given pane holds, or null when the tree has no such pane. */
export function contentOf(node: PaneNode, paneId: string): PaneContent | null {
    if (node.kind === 'leaf') return node.paneId === paneId ? node.content : null;
    for (const child of node.children) {
        const found = contentOf(child, paneId);
        if (found) return found;
    }
    return null;
}

/**
 * Gives one split's children equal shares.
 *
 * The View menu's Even out, and what a double-click on a seam reaches for.
 * Repeated splitting halves each time — 1/2, 1/4, 1/8 — in iTerm and tmux as
 * much as here, so this is the command that answers "make these the same
 * size", rather than something the split gesture should have been doing.
 */
export function evenOut(node: PaneNode, splitId: string): PaneNode {
    if (node.kind === 'leaf') return node;
    if (node.splitId === splitId) return { ...node, fractions: node.children.map(() => 1 / node.children.length) };
    return { ...node, children: node.children.map(child => evenOut(child, splitId)) };
}

/**
 * Where a seam sits and how far it may travel, in the pixels `Grip` speaks.
 *
 * The grip drags a boundary, not a ratio, so the conversion happens here
 * rather than in the shell — which would otherwise need to know the tree, the
 * minimums and the seam count to turn a pointer position into a fraction.
 * Null when there is no such seam, so a stale request from a shell whose tree
 * has moved on is refused rather than acted on.
 */
export function seamPixels(node: PaneNode, splitId: string, index: number, gross: number): { size: number; min: number; max: number } | null {
    const found = findSplit(node, splitId);
    if (!found) return null;
    const here = found.children[index];
    const next = found.children[index + 1];
    if (!here || !next) return null;
    // The sizes the split was actually drawn at, not the ones its fractions ask
    // for. The two part company whenever `allocate` has had to pin somebody at
    // their floor — which needs no illegal drag to reach, only a window that
    // shrank, since a fraction off the game's path is never renormalised, and
    // one comfortable at one width can be under the floor at another. Reporting the fraction there
    // would hand `Grip` a position the pane is not at, and every later key press
    // would build on it.
    const sizes = allocate(found.fractions, gross, found.children.map(child => minimumOf(child, found.axis)));
    return {
        size: sizes[index]!,
        min: minimumOf(here, found.axis),
        max: sizes[index]! + sizes[index + 1]! - minimumOf(next, found.axis)
    };
}

/** Moves a seam to a pixel position. The px-facing twin of `setFraction`, which owns the clamp. */
export function setSeam(node: PaneNode, splitId: string, index: number, px: number, gross: number): PaneNode {
    return gross <= 0 ? node : setFraction(node, splitId, index, px / gross, gross);
}

function findSplit(node: PaneNode, splitId: string): (PaneNode & { kind: 'split' }) | null {
    if (node.kind === 'leaf') return null;
    if (node.splitId === splitId) return node;
    for (const child of node.children) {
        const found = findSplit(child, splitId);
        if (found) return found;
    }
    return null;
}

/**
 * The split a pane sits directly in, or null when it is the whole tree.
 *
 * The nearest one, not the root: Even out acts on the row or column the user is
 * standing in, which is the only split whose seams they can see moving.
 */
export function parentSplitOf(node: PaneNode, paneId: string): string | null {
    if (node.kind === 'leaf') return null;
    if (node.children.some(child => child.kind === 'leaf' && child.paneId === paneId)) return node.splitId;
    for (const child of node.children) {
        const found = parentSplitOf(child, paneId);
        if (found) return found;
    }
    return null;
}

/**
 * Trades two panes' places, leaving the tree's shape untouched.
 *
 * What a header dropped in the middle of another pane does. The slots keep
 * their sizes and their seams, so nothing else on screen shifts. Only the two
 * panes move between them, which makes the result predictable. `movePane` is
 * the drop on an edge, which does reshape the tree.
 *
 * The leaves move whole, each keeping its id, rather than trading contents under
 * fixed ids. Everything keyed by a pane id then follows its pane: a page's view
 * and its history, and whatever a tool pane was holding. Trading contents once
 * left two swapped pages' views where they were under each other's names, and
 * reloaded a page traded with a tool.
 *
 * Naming one pane twice, or naming one that is not in this tree, returns the
 * tree itself rather than a copy. That identity is load-bearing upstream: the
 * host compares against it to decide whether anything has to be laid out and
 * pushed at all.
 */
export function swapPanes(node: PaneNode, a: string, b: string): PaneNode {
    if (a === b) return node;
    const left = contentOf(node, a);
    const right = contentOf(node, b);
    if (!left || !right) return node;
    const traded = (n: PaneNode): PaneNode => {
        if (n.kind === 'split') return { ...n, children: n.children.map(traded) };
        if (n.paneId === a) return leaf(b, right);
        if (n.paneId === b) return leaf(a, left);
        return n;
    };
    return traded(node);
}

/** A side of the window: the one that moves when a close gives space back. */
export type Edge = 'left' | 'right' | 'top' | 'bottom';

/**
 * Closes a pane and, when that would have grown the game, gives the space back
 * to the screen instead — the explicit close's counterpart to `makeRoom`.
 *
 * `closePane` hands a closed pane's share to its siblings, and when the game is
 * one of them it grows: a canvas of fixed pixels in a bigger pane is a border of
 * nothing, and the player has to drag a seam back to where it was. So along the
 * closed pane's split, the window shrinks by the pane and its seam, and every
 * pane left keeps the pixels it had. `edge` is the side of the window that moves
 * in — the closed pane's own side of the game — so the game stays where it was
 * on screen, and null when nothing shrank.
 *
 * `room` is how far the window may shrink, per axis: nothing while it is
 * maximised or full screen. The shrink stops at the tree's own floor too. What
 * the window cannot give up is shared by the closed pane's siblings in
 * proportion, exactly as `closePane` shares it, so with no room at all the
 * answer is `closePane`'s own tree.
 *
 * Only the gesture that says "close" comes here. A drop also closes a pane on
 * its way to moving it, and a drop must never resize the window, so
 * `closePane` itself stays as it is.
 *
 * The tree returned is arranged at `size` less `shrunk` (`arrangedAt`).
 */
export function closeGivingBack(node: PaneNode, paneId: string, size: Size, room: Size): { tree: PaneNode; shrunk: Size; edge: Edge | null } {
    const after = closePane(node, paneId);
    const none = { tree: after, shrunk: { width: 0, height: 0 }, edge: null };
    const parent = parentOf(node, paneId);
    const was = gameSize(node, size);
    const now = gameSize(after, size);
    if (!parent || !was || !now) return none;
    const across = parent.axis === 'x';
    if ((across ? now.width - was.width : now.height - was.height) <= 0) return none;

    const panes = layoutTree(node, { x: 0, y: 0, width: size.width, height: size.height }).panes;
    const closed = panes.get(paneId)!;
    const game = panes.get(paneIds(node).find(id => contentOf(node, id)?.kind === 'game')!)!;
    const extent = (across ? closed.width : closed.height) + SEAM;
    const floor = (across ? size.width : size.height) - minimumOf(after, parent.axis);
    const shrink = Math.max(0, Math.min(extent, across ? room.width : room.height, floor));
    if (shrink === 0) return none;

    const to = across ? { width: size.width - shrink, height: size.height } : { width: size.width, height: size.height - shrink };
    const before = across ? closed.x < game.x : closed.y < game.y;
    return {
        tree: closePane(payFrom(node, paneId, size, to), paneId),
        shrunk: { width: size.width - to.width, height: size.height - to.height },
        edge: across ? (before ? 'left' : 'right') : before ? 'top' : 'bottom'
    };
}

/** The split holding `paneId` as a direct child, or null when the pane is the whole tree or not in it. */
function parentOf(node: PaneNode, paneId: string): Extract<PaneNode, { kind: 'split' }> | null {
    if (node.kind === 'leaf') return null;
    if (node.children.some(child => child.kind === 'leaf' && child.paneId === paneId)) return node;
    for (const child of node.children) {
        const found = parentOf(child, paneId);
        if (found) return found;
    }
    return null;
}

/**
 * `node` arranged at `to` rather than `from`, with the whole difference taken
 * from the named pane: down its path, each split's child on the path gives up
 * the difference along that split's axis and every other child keeps the pixels
 * it had.
 *
 * The pane about to be closed is the one named, so its share can end up at
 * nothing or a seam's width below it — a size no pane is ever drawn at, and
 * none is, since `closePane` removes it before anything lays the tree out. What
 * closing it then hands its siblings is exactly what is left of it, which is
 * nothing when the window gave up the whole pane and its seam.
 */
function payFrom(node: PaneNode, paneId: string, from: Size, to: Size): PaneNode {
    if (node.kind === 'leaf') return node;
    const at = node.children.findIndex(child => paneIds(child).includes(paneId));
    if (at < 0) return node;
    const across = node.axis === 'x';
    const seams = SEAM * (node.children.length - 1);
    const had = allocate(
        node.fractions,
        (across ? from.width : from.height) - seams,
        node.children.map(child => minimumOf(child, node.axis))
    );
    const gross = (across ? to.width : to.height) - seams;
    const lost = (across ? from.width : from.height) - (across ? to.width : to.height);
    const sizes = had.map((px, i) => (i === at ? px - lost : px));
    const resized = (size: Size, px: number): Size => (across ? { width: px, height: size.height } : { width: size.width, height: px });
    const child = payFrom(node.children[at]!, paneId, resized(from, had[at]!), resized(to, sizes[at]!));
    return { ...node, children: node.children.map((c, i) => (i === at ? child : c)), fractions: sizes.map(px => px / gross) };
}
