import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstLegalSideOccupant, reduce, type Action, type Placement } from './chatDock.ts';
import type { ChatHome } from '../shared/chat.ts';
import type { ToolId } from '../shared/ipc.ts';
import { TOOL_IDS } from '../shared/ipc.ts';

const TOOLS: readonly ToolId[] = TOOL_IDS;

/**
 * The rail a window of the fullest kind actually offers, in the order
 * `serverWindow` builds it: chat, then the server's own tools. TOOL_IDS above
 * is the *set* of tools and is deliberately in a different order, so the
 * cases that turn on rail order say which of the two they mean.
 *
 * A third copy of that order, alongside the builder in `main/serverWindow.ts`
 * (which feeds `firstLegalSideOccupant`, and so `panelAvailable`) and `TOOLS`
 * in `renderer/Shell.tsx` (which decides what is drawn). Nothing links the
 * three and nothing here compares them: this literal is what the reducer is
 * tested against, not proof the window builds the same one. Reorder any of
 * them and the other two want the same edit.
 */
const RAIL: readonly ToolId[] = ['chat', 'worlds', 'hiscores', 'singleplayer'];

const base = (over: Partial<Placement> = {}): Placement => ({
    home: 'bottom',
    dockOpen: false,
    activeTool: null,
    panelOpen: false,
    ...over
});

// ── rail-chat ────────────────────────────────────────────────────────────

test("the rail's chat tab opens the dock without disturbing worlds", () => {
    const r = reduce(base({ home: 'bottom', dockOpen: false, activeTool: 'worlds', panelOpen: true }), { kind: 'rail-chat' }, TOOLS);
    assert.equal(r.dockOpen, true, 'the dock opens');
    assert.equal(r.activeTool, 'worlds', 'the side panel is untouched');
    assert.equal(r.panelOpen, true, 'the side panel is untouched');
});

test("the rail's chat tab closes the dock the same way", () => {
    const r = reduce(base({ home: 'bottom', dockOpen: true, activeTool: 'worlds', panelOpen: true }), { kind: 'rail-chat' }, TOOLS);
    assert.equal(r.dockOpen, false, 'the dock closes');
    assert.equal(r.activeTool, 'worlds', 'the side panel is still untouched');
    assert.equal(r.panelOpen, true, 'the side panel is still untouched');
});

test("the rail's chat tab closes the panel when chat is already open on the side", () => {
    const r = reduce(base({ home: 'side', activeTool: 'chat', panelOpen: true }), { kind: 'rail-chat' }, TOOLS);
    assert.equal(r.panelOpen, false, 'the panel closes');
    assert.equal(r.activeTool, 'chat', 'chat stays remembered as the panel occupant');
});

test("the rail's chat tab reopens the panel when chat is remembered but not currently shown", () => {
    // Same activeTool as the "already open" case above, but panelOpen is
    // false: chat is remembered, not showing. This must fall through to the
    // "otherwise" branch and open the panel, not stay closed — the close
    // branch requires panelOpen too, not just activeTool === 'chat'.
    const r = reduce(base({ home: 'side', activeTool: 'chat', panelOpen: false }), { kind: 'rail-chat' }, TOOLS);
    assert.equal(r.panelOpen, true, 'a closed panel opens rather than staying shut');
    assert.equal(r.activeTool, 'chat');
});

test("the rail's chat tab opens chat on the side when the panel is closed", () => {
    const r = reduce(base({ home: 'side', activeTool: null, panelOpen: false }), { kind: 'rail-chat' }, TOOLS);
    assert.equal(r.activeTool, 'chat');
    assert.equal(r.panelOpen, true);
});

test("the rail's chat tab takes over the side panel from whatever else was open", () => {
    const r = reduce(base({ home: 'side', activeTool: 'worlds', panelOpen: true }), { kind: 'rail-chat' }, TOOLS);
    assert.equal(r.activeTool, 'chat', 'chat becomes the open panel');
    assert.equal(r.panelOpen, true);
});

// ── rail-tool ────────────────────────────────────────────────────────────

test("a tool's rail tab closes the panel when that tool is already open", () => {
    const r = reduce(base({ home: 'side', activeTool: 'worlds', panelOpen: true }), { kind: 'rail-tool', tool: 'worlds' }, TOOLS);
    assert.equal(r.panelOpen, false, 'the panel closes');
    assert.equal(r.activeTool, 'worlds', 'the remembered tool stays');
});

test("a tool's rail tab reopens the panel when that tool is remembered but not currently shown", () => {
    // Mirrors the rail-chat case above: activeTool already matches the
    // requested tool, but panelOpen is false. The close branch must require
    // panelOpen too, or this would wrongly stay closed instead of reopening.
    const r = reduce(base({ home: 'side', activeTool: 'worlds', panelOpen: false }), { kind: 'rail-tool', tool: 'worlds' }, TOOLS);
    assert.equal(r.panelOpen, true, 'a closed panel opens rather than staying shut');
    assert.equal(r.activeTool, 'worlds');
});

test("a tool's rail tab switches to a different tool while the panel stays open", () => {
    const r = reduce(base({ home: 'side', activeTool: 'worlds', panelOpen: true }), { kind: 'rail-tool', tool: 'singleplayer' }, TOOLS);
    assert.equal(r.activeTool, 'singleplayer', 'the panel switches to the newly selected tool');
    assert.equal(r.panelOpen, true, 'the panel stays open across the switch, it never blinks closed');
});

test("a tool's rail tab opens the panel on that tool otherwise, leaving the dock alone", () => {
    const r = reduce(base({ home: 'bottom', dockOpen: true, activeTool: null, panelOpen: false }), { kind: 'rail-tool', tool: 'worlds' }, TOOLS);
    assert.equal(r.activeTool, 'worlds');
    assert.equal(r.panelOpen, true);
    assert.equal(r.dockOpen, true, 'the dock is untouched by a side-column action');
});

test("rail-tool with 'chat' is a caller mistake and returns the state unchanged", () => {
    const state = base({ home: 'side', activeTool: 'worlds', panelOpen: true });
    const r = reduce(state, { kind: 'rail-tool', tool: 'chat' }, TOOLS);
    assert.strictEqual(r, state, 'the exact same placement object comes back');
});

// ── move ─────────────────────────────────────────────────────────────────
// 'move' is fired only by the window the user is looking at, and is allowed
// to rearrange that window's own chrome. Contrast with 'sync-home' below,
// which every OTHER open window receives instead.

test('moving chat to the bottom closes the panel and clears activeTool if chat held it', () => {
    const r = reduce(base({ home: 'side', activeTool: 'chat', panelOpen: true }), { kind: 'move', to: 'bottom' }, TOOLS);
    assert.equal(r.home, 'bottom');
    assert.equal(r.dockOpen, true);
    assert.equal(r.panelOpen, false);
    assert.equal(r.activeTool, null, 'chat leaves no trace in the side column it just vacated');
});

test('moving chat to the bottom leaves an unrelated activeTool alone', () => {
    const r = reduce(base({ home: 'side', activeTool: 'worlds', panelOpen: true }), { kind: 'move', to: 'bottom' }, TOOLS);
    assert.equal(r.home, 'bottom');
    assert.equal(r.dockOpen, true);
    assert.equal(r.panelOpen, false, 'the panel still closes on the move');
    assert.equal(r.activeTool, 'worlds', 'worlds was not chat, so it is remembered rather than cleared');
});

test('moving chat to the side evicts whatever tool held the column', () => {
    const r = reduce(base({ home: 'bottom', dockOpen: true, activeTool: 'worlds', panelOpen: true }), { kind: 'move', to: 'side' }, TOOLS);
    assert.equal(r.home, 'side');
    assert.equal(r.dockOpen, false);
    assert.equal(r.activeTool, 'chat', 'chat evicts the previous occupant');
    assert.equal(r.panelOpen, true);
});

test('moving chat to the side opens the panel even if the evicted tool was only remembered, not shown', () => {
    // panelOpen starts false here, unlike the eviction test above. The result
    // must still open the panel on chat unconditionally — 'move to side'
    // does not carry panelOpen forward from the prior state.
    const r = reduce(base({ home: 'bottom', dockOpen: true, activeTool: 'worlds', panelOpen: false }), { kind: 'move', to: 'side' }, TOOLS);
    assert.equal(r.panelOpen, true, 'the panel opens on chat regardless of whether it was open before the move');
    assert.equal(r.activeTool, 'chat');
    assert.equal(r.dockOpen, false);
});

// ── sync-home ────────────────────────────────────────────────────────────
// What every window OTHER than the one that fired 'move' receives. Openness
// is per-window; only the home itself is meant to be shared, so these must
// never install chat in a column that never asked for it and never open a
// dock nobody here touched.

test("sync-home to 'side' leaves a window's own Worlds panel alone, closing only the dock", () => {
    const r = reduce(base({ home: 'bottom', dockOpen: true, activeTool: 'worlds', panelOpen: true }), { kind: 'sync-home', to: 'side' }, TOOLS);
    assert.equal(r.home, 'side');
    assert.equal(r.dockOpen, false, "invariant 2 forces the dock closed once home is 'side'");
    assert.equal(r.activeTool, 'worlds', 'this window never asked for chat, so its own tool is untouched — not evicted the way move does it');
    assert.equal(r.panelOpen, true, 'the panel stays open on whatever it already showed');
});

test("sync-home to 'side' closes this window's dock without installing chat in an untouched column", () => {
    const r = reduce(base({ home: 'bottom', dockOpen: true, activeTool: null, panelOpen: false }), { kind: 'sync-home', to: 'side' }, TOOLS);
    assert.equal(r.dockOpen, false, 'the dock closes');
    assert.equal(r.activeTool, null, 'chat is not installed on this window’s behalf');
    assert.equal(r.panelOpen, false, 'an untouched column stays untouched, it does not spring open');
});

test("sync-home to 'bottom' vacates a window's own chat from the column without opening its dock", () => {
    const r = reduce(base({ home: 'side', dockOpen: false, activeTool: 'chat', panelOpen: true }), { kind: 'sync-home', to: 'bottom' }, TOOLS);
    assert.equal(r.home, 'bottom');
    assert.equal(r.activeTool, null, "chat cannot stay in the column once home is 'bottom' (invariant 1)");
    assert.equal(r.panelOpen, false, 'nothing is left in the panel to show, so it closes with chat');
    assert.equal(r.dockOpen, false, "the dock does not open on this window's behalf");
});

test("sync-home to 'bottom' leaves a window's own Worlds panel completely untouched", () => {
    const r = reduce(base({ home: 'side', dockOpen: false, activeTool: 'worlds', panelOpen: true }), { kind: 'sync-home', to: 'bottom' }, TOOLS);
    assert.equal(r.home, 'bottom', 'only home changes');
    assert.equal(r.activeTool, 'worlds');
    assert.equal(r.panelOpen, true);
    assert.equal(r.dockOpen, false, 'sync-home never opens the dock on this window’s behalf');
});

// ── toggle-panel ─────────────────────────────────────────────────────────

test('the panel toggle closes an open panel without touching anything else', () => {
    const r = reduce(base({ home: 'bottom', dockOpen: true, activeTool: 'worlds', panelOpen: true }), { kind: 'toggle-panel' }, TOOLS);
    assert.equal(r.panelOpen, false);
    assert.equal(r.activeTool, 'worlds', 'the remembered tool is untouched');
    assert.equal(r.dockOpen, true, 'the dock is untouched');
});

test('the panel toggle reopens on the remembered tool when there is one', () => {
    const r = reduce(base({ activeTool: 'singleplayer', panelOpen: false }), { kind: 'toggle-panel' }, TOOLS);
    assert.equal(r.panelOpen, true);
    assert.equal(r.activeTool, 'singleplayer');
});

test('the panel toggle picks the first legal side occupant when nothing is remembered', () => {
    const r = reduce(base({ home: 'bottom', activeTool: null, panelOpen: false }), { kind: 'toggle-panel' }, TOOLS);
    assert.equal(r.panelOpen, true);
    assert.equal(r.activeTool, 'worlds', "'worlds' is the first entry in the list passed here — TOOL_IDS, whose order is not the rail's");
});

test('the panel toggle skips chat and keeps scanning for the next legal tool while home is bottom', () => {
    // Chat is first in this rail order, so this exercises the "skip, then
    // keep looking" path specifically — as opposed to the previous test,
    // where the winning tool was already first and the skip never ran.
    const r = reduce(base({ home: 'bottom', activeTool: null, panelOpen: false }), { kind: 'toggle-panel' }, ['chat', 'worlds']);
    assert.equal(r.activeTool, 'worlds', "chat is skipped because it isn't a legal side occupant while home is 'bottom', and the scan continues");
});

test('the panel toggle offers chat as the default once home is the side column', () => {
    const r = reduce(base({ home: 'side', activeTool: null, panelOpen: false }), { kind: 'toggle-panel' }, ['chat', 'worlds']);
    assert.equal(r.activeTool, 'chat', 'chat is a legal side occupant once it is not competing with the dock');
});

test("the panel toggle opens on chat alone when it is the window's only tool and home is the side column", () => {
    // Same single-tool rail as the "does not open" test below, but home is
    // 'side' here, so chat itself is the legal occupant. Distinguishes "no
    // tool available" from "home makes chat unavailable".
    const r = reduce(base({ home: 'side', activeTool: null, panelOpen: false }), { kind: 'toggle-panel' }, ['chat']);
    assert.equal(r.panelOpen, true);
    assert.equal(r.activeTool, 'chat');
});

test('the panel toggle does not open onto an empty column when no tool in the rail is a legal side occupant', () => {
    // A server with no worlds list ships with tools === ['chat'], and the
    // default home is 'bottom' — exactly the every-user-added-server case
    // the review caught. Opening here would widen the window onto a column
    // nothing can fill, so the toggle must be a complete no-op instead.
    const state = base({ home: 'bottom', activeTool: null, panelOpen: false });
    const r = reduce(state, { kind: 'toggle-panel' }, ['chat']);
    assert.equal(r.panelOpen, false, 'the panel stays closed rather than opening onto nothing');
    assert.deepEqual(r, state, 'the whole placement is unchanged, not just panelOpen');
});

test('the panel toggle can still close an open panel even when no tool would be a legal side occupant', () => {
    // Closing must never consult legality at all — only opening onto an
    // empty column is refused.
    const r = reduce(base({ home: 'bottom', activeTool: 'singleplayer', panelOpen: true }), { kind: 'toggle-panel' }, ['chat']);
    assert.equal(r.panelOpen, false, 'closing works regardless of what tools says');
    assert.equal(r.activeTool, 'singleplayer', 'the remembered tool is untouched');
});

// ── firstLegalSideOccupant, asked directly ───────────────────────────────
// The toggle-panel cases above prove what reduce does with the answer; these
// prove the answer itself, which main now also reads to decide whether the
// panel toggle is offered at all.

test('the legal side occupant is the first tool in rail order, chat skipped only while it lives at the bottom', () => {
    assert.equal(firstLegalSideOccupant(RAIL, 'bottom'), 'worlds', "the full rail's first legal occupant at the bottom is worlds, the tool right after chat");
    assert.equal(firstLegalSideOccupant(RAIL, 'side'), 'chat', 'and chat itself once the column is its home');
    assert.equal(firstLegalSideOccupant(['chat', 'worlds'], 'bottom'), 'worlds', 'chat is skipped at the bottom and the scan carries on past it');
    assert.equal(firstLegalSideOccupant(['chat', 'worlds'], 'side'), 'chat', 'chat is legal again once the side column is its home');
    assert.equal(firstLegalSideOccupant(['chat'], 'side'), 'chat', 'one tool is enough when it is a legal one');
    assert.equal(firstLegalSideOccupant(['chat'], 'bottom'), null, 'a chat-only window with chat docked has no legal occupant — the state that makes the panel toggle a dead control');
    assert.equal(firstLegalSideOccupant([], 'side'), null, 'and an empty rail has none either');
});

// ── the two headline scenarios from the design ──────────────────────────

test('headline: worlds on the side and chat at the bottom are visible at once', () => {
    let p = base();
    p = reduce(p, { kind: 'rail-tool', tool: 'worlds' }, TOOLS);
    p = reduce(p, { kind: 'rail-chat' }, TOOLS);
    assert.equal(p.home, 'bottom');
    assert.equal(p.dockOpen, true, 'the dock is open');
    assert.equal(p.panelOpen, true, 'the side panel is open');
    assert.equal(p.activeTool, 'worlds', 'worlds still holds the side column');
});

test('headline: moving chat from the bottom to the side evicts worlds and chat holds the column', () => {
    let p = base();
    p = reduce(p, { kind: 'rail-tool', tool: 'worlds' }, TOOLS);
    p = reduce(p, { kind: 'rail-chat' }, TOOLS);
    // p is now the state proven above: worlds on the side, chat at the bottom.
    p = reduce(p, { kind: 'move', to: 'side' }, TOOLS);
    assert.equal(p.home, 'side');
    assert.equal(p.dockOpen, false, 'the dock closes on the move');
    assert.equal(p.activeTool, 'chat', 'chat evicted worlds from the column');
    assert.equal(p.panelOpen, true);
});

// ── purity ───────────────────────────────────────────────────────────────

test('reduce does not mutate the state object it is given', () => {
    const actions: Action[] = [
        { kind: 'rail-chat' },
        { kind: 'rail-tool', tool: 'worlds' },
        { kind: 'rail-tool', tool: 'hiscores' },
        { kind: 'rail-tool', tool: 'chat' },
        { kind: 'rail-tool', tool: 'singleplayer' },
        { kind: 'move', to: 'bottom' },
        { kind: 'move', to: 'side' },
        { kind: 'sync-home', to: 'bottom' },
        { kind: 'sync-home', to: 'side' },
        { kind: 'toggle-panel' }
    ];
    const starts = [
        base(),
        base({ home: 'bottom', dockOpen: true, activeTool: 'worlds', panelOpen: true }),
        base({ home: 'side', activeTool: 'chat', panelOpen: true })
    ];
    for (const start of starts) {
        const frozen = Object.freeze({ ...start });
        for (const action of actions) {
            // Object.freeze makes an in-place write throw under ESM's implicit
            // strict mode, so a mutating implementation would fail this loop
            // outright rather than merely produce a wrong answer.
            reduce(frozen, action, TOOLS);
        }
        assert.deepEqual(frozen, start, 'the input placement reads the same after every action tried against it');
    }
});

// ── the invariants: the point of the module ─────────────────────────────

function assertInvariants(p: Placement, message: string): void {
    if (p.home === 'bottom') {
        assert.notEqual(p.activeTool, 'chat', `${message}: chat is never in both places (home is 'bottom')`);
    }
    if (p.home === 'side') {
        assert.equal(p.dockOpen, false, `${message}: the side column and the dock cannot both be chat's home`);
    }
    if (p.dockOpen) {
        assert.equal(p.home, 'bottom', `${message}: the dock is only open while chat's home is 'bottom'`);
    }
}

test('the three invariants hold after every action, from every representative starting placement', () => {
    const starts: Placement[] = [
        base(),
        base({ home: 'bottom', dockOpen: true, activeTool: 'worlds', panelOpen: true }),
        base({ home: 'bottom', activeTool: 'singleplayer', panelOpen: false }),
        base({ home: 'side', activeTool: 'singleplayer', panelOpen: true }),
        base({ home: 'side', activeTool: 'chat', panelOpen: true }),
        base({ home: 'side', activeTool: 'worlds', panelOpen: false })
    ];
    const homes: ChatHome[] = ['bottom', 'side'];
    const toolActions: Action[] = TOOL_IDS.map((tool) => ({ kind: 'rail-tool', tool }));
    const actions: Action[] = [
        { kind: 'rail-chat' },
        { kind: 'toggle-panel' },
        ...toolActions,
        ...homes.map((to): Action => ({ kind: 'move', to })),
        ...homes.map((to): Action => ({ kind: 'sync-home', to }))
    ];

    for (const start of starts) {
        assertInvariants(start, 'sanity: the starting placement itself');
        for (const action of actions) {
            const result = reduce(start, action, TOOLS);
            assertInvariants(result, `after ${JSON.stringify(action)} from ${JSON.stringify(start)}`);
        }
    }
});
