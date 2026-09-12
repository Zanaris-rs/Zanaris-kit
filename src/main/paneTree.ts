import { PANE_MIN_HEIGHT, PANE_MIN_WIDTH, SEAM } from '../shared/layout.ts';
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

/**
 * Splits the named pane, putting an empty pane in the new half.
 *
 * Ids are handed in rather than counted here, so this stays a pure function of
 * its arguments — `serverWindow` owns the monotonic counter, exactly as it
 * does for page ids today.
 */
export function splitPane(node: PaneNode, paneId: string, axis: 'x' | 'y', ids: { paneId: string; splitId: string }): PaneNode {
    if (node.kind === 'leaf') {
        if (node.paneId !== paneId) return node;
        return split(ids.splitId, axis, [node, leaf(ids.paneId, { kind: 'empty' })], [0.5, 0.5]);
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
            return {
                ...node,
                children: [...node.children.slice(0, at + 1), leaf(ids.paneId, { kind: 'empty' }), ...node.children.slice(at + 1)],
                fractions: [...node.fractions.slice(0, at), half, half, ...node.fractions.slice(at + 1)]
            };
        }
    }
    return { ...node, children: node.children.map(child => splitPane(child, paneId, axis, ids)) };
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
    if (at < 0) return collapse({ ...node, children: node.children.map(child => closePane(child, paneId)) });

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

/** Puts something in a pane. What the launcher and the rail both do. */
export function setContent(node: PaneNode, paneId: string, content: PaneContent): PaneNode {
    if (node.kind === 'leaf') return node.paneId === paneId ? leaf(paneId, content) : node;
    return { ...node, children: node.children.map(child => setContent(child, paneId, content)) };
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
    // shrank, since nothing renormalises a fraction that was comfortable at one
    // width and is under the floor at another. Reporting the fraction there
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
