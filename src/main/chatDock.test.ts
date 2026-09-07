import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reduce, type Action, type Placement } from './chatDock.ts';
import type { ChatHome } from '../shared/chat.ts';
import type { ToolId } from '../shared/ipc.ts';
import { TOOL_IDS } from '../shared/ipc.ts';

const TOOLS: readonly ToolId[] = TOOL_IDS;

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
    assert.equal(r.activeTool, 'worlds', "'worlds' is the first entry in the rail order passed in");
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

test('the panel toggle opens empty when no tool in the rail is a legal side occupant', () => {
    const r = reduce(base({ home: 'bottom', activeTool: null, panelOpen: false }), { kind: 'toggle-panel' }, ['chat']);
    assert.equal(r.panelOpen, true, 'the panel still opens');
    assert.equal(r.activeTool, null, 'an empty panel is a real state, not an error, and Shell.tsx renders it');
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
        { kind: 'rail-tool', tool: 'chat' },
        { kind: 'rail-tool', tool: 'singleplayer' },
        { kind: 'move', to: 'bottom' },
        { kind: 'move', to: 'side' },
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
    const actions: Action[] = [{ kind: 'rail-chat' }, { kind: 'toggle-panel' }, ...toolActions, ...homes.map((to): Action => ({ kind: 'move', to }))];

    for (const start of starts) {
        assertInvariants(start, 'sanity: the starting placement itself');
        for (const action of actions) {
            const result = reduce(start, action, TOOLS);
            assertInvariants(result, `after ${JSON.stringify(action)} from ${JSON.stringify(start)}`);
        }
    }
});
