import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeTab, initialPane, paneLayoutWidth, paneOpen, reduce, type PaneAction, type PaneState } from './pagePane.ts';
import { PAGE_WIDTH_DEFAULT, PAGE_WIDTH_MIN } from '../shared/layout.ts';

const LIMITS = { maxWidth: 1200 };
const start = (): PaneState => initialPane(PAGE_WIDTH_DEFAULT);
const run = (state: PaneState, ...actions: PaneAction[]): PaneState => actions.reduce((s, a) => reduce(s, a, LIMITS), state);
const open = (bookmark: string, label: string): PaneAction => ({ kind: 'open', bookmark, label });

const CLUES = 'https://2004.losthq.rs/?p=clueguides';
const BESTIARY = 'https://2004.losthq.rs/?p=droptables';
const MAP = 'https://tools.losthq.rs/map';

test('a fresh pane is closed, and closed means no tabs rather than a flag of its own', () => {
    const pane = start();
    assert.equal(paneOpen(pane), false);
    assert.equal(activeTab(pane), null);
    assert.equal(paneLayoutWidth(pane), 0, 'a closed pane costs the layout nothing');
});

test('opening a link appends it and brings it to the front', () => {
    const pane = run(start(), open(CLUES, 'Clue Help'), open(BESTIARY, 'Bestiary'));
    assert.deepEqual(
        pane.tabs.map(t => t.label),
        ['Clue Help', 'Bestiary']
    );
    assert.equal(activeTab(pane)!.label, 'Bestiary');
    assert.equal(paneOpen(pane), true);
    assert.equal(paneLayoutWidth(pane), PAGE_WIDTH_DEFAULT);
});

test('a tab starts on its own bookmark, labelled by the link rather than by the page', () => {
    const tab = activeTab(run(start(), open(MAP, 'World Map')))!;
    assert.equal(tab.bookmark, MAP);
    assert.equal(tab.url, MAP);
    assert.equal(tab.label, 'World Map');
    assert.equal(tab.loading, true, 'it is loading from the moment it is opened');
});

test('clicking a link already open focuses its tab instead of opening a second one', () => {
    const pane = run(start(), open(CLUES, 'Clue Help'), open(BESTIARY, 'Bestiary'), open(CLUES, 'Clue Help'));
    assert.equal(pane.tabs.length, 2);
    assert.equal(activeTab(pane)!.label, 'Clue Help');
});

test('dedupe is on the bookmark, not the live url: a redirect must not open the page twice', () => {
    // LostHQ answers ?p=droptables with a redirect to ?p=npcdb.
    const once = run(start(), open(BESTIARY, 'Bestiary'));
    const navigated = run(once, {
        kind: 'navigated',
        id: once.activeId!,
        url: 'https://2004.losthq.rs/?p=npcdb',
        title: 'Bestiary',
        canGoBack: false,
        canGoForward: false
    });
    const again = run(navigated, open(BESTIARY, 'Bestiary'));
    assert.equal(again.tabs.length, 1, 'the same link is the same tab, wherever the page went');
});

test('ids never repeat, even after the tab holding one is closed', () => {
    const pane = run(start(), open(CLUES, 'Clue Help'));
    const id = pane.activeId!;
    const reopened = run(pane, { kind: 'close', id }, open(CLUES, 'Clue Help'));
    assert.notEqual(reopened.activeId, id);
});

test('closing the tab in front activates the one that took its place', () => {
    const pane = run(start(), open(CLUES, 'Clue Help'), open(BESTIARY, 'Bestiary'), open(MAP, 'World Map'));
    const bestiary = pane.tabs[1]!.id;
    const after = run(run(pane, { kind: 'activate', id: bestiary }), { kind: 'close', id: bestiary });
    assert.equal(activeTab(after)!.label, 'World Map');
});

test('closing the last tab in the row falls back to the one on its left', () => {
    const pane = run(start(), open(CLUES, 'Clue Help'), open(BESTIARY, 'Bestiary'));
    const after = run(pane, { kind: 'close', id: pane.activeId! });
    assert.equal(activeTab(after)!.label, 'Clue Help');
});

test('closing a tab that is not in front leaves the front one alone', () => {
    const pane = run(start(), open(CLUES, 'Clue Help'), open(BESTIARY, 'Bestiary'));
    const after = run(pane, { kind: 'close', id: pane.tabs[0]!.id });
    assert.equal(activeTab(after)!.label, 'Bestiary');
});

test('closing the only tab closes the pane, and clears a collapse it was carrying', () => {
    const pane = run(start(), open(CLUES, 'Clue Help'), { kind: 'set-collapsed', collapsed: true });
    const after = run(pane, { kind: 'close', id: pane.activeId! });
    assert.equal(paneOpen(after), false);
    assert.equal(after.activeId, null);
    assert.equal(after.collapsed, false, 'the next link opened must not arrive already hidden');
});

test('collapsing keeps every tab and which one is in front', () => {
    const pane = run(start(), open(CLUES, 'Clue Help'), open(BESTIARY, 'Bestiary'), { kind: 'set-collapsed', collapsed: true });
    assert.equal(pane.tabs.length, 2);
    assert.equal(activeTab(pane)!.label, 'Bestiary');
    assert.equal(paneOpen(pane), true, 'collapsed is hidden, not closed');
    assert.equal(paneLayoutWidth(pane), 0, 'but it costs the layout nothing while it is hidden');
});

test('picking a tab or a link while collapsed shows the pane again', () => {
    const collapsed = run(start(), open(CLUES, 'Clue Help'), { kind: 'set-collapsed', collapsed: true });
    assert.equal(reduce(collapsed, { kind: 'activate', id: collapsed.activeId! }, LIMITS).collapsed, false);
    assert.equal(reduce(collapsed, open(BESTIARY, 'Bestiary'), LIMITS).collapsed, false);
    assert.equal(reduce(collapsed, open(CLUES, 'Clue Help'), LIMITS).collapsed, false, 'even the link already in front');
});

test('a resize is clamped to the floor and to the ceiling main supplies', () => {
    const pane = run(start(), open(CLUES, 'Clue Help'));
    assert.equal(reduce(pane, { kind: 'resize', width: 10 }, LIMITS).width, PAGE_WIDTH_MIN);
    assert.equal(reduce(pane, { kind: 'resize', width: 9000 }, LIMITS).width, LIMITS.maxWidth);
    assert.equal(reduce(pane, { kind: 'resize', width: 640.4 }, LIMITS).width, 640, 'and rounded: a fractional pixel width means nothing');
});

test('a ceiling below the floor still yields the floor rather than something narrower', () => {
    const pane = run(start(), open(CLUES, 'Clue Help'));
    assert.equal(reduce(pane, { kind: 'resize', width: 800 }, { maxWidth: 100 }).width, PAGE_WIDTH_MIN);
});

test('an update that changes nothing returns the same state, so nothing downstream repaints', () => {
    const pane = run(start(), open(MAP, 'World Map'));
    const id = pane.activeId!;
    const navigated = reduce(pane, { kind: 'navigated', id, url: MAP, title: 'World map', canGoBack: false, canGoForward: false }, LIMITS);
    assert.notEqual(navigated, pane, 'the title did move');
    // The clue coordinator changes its hash on every click; each one arrives here.
    assert.equal(
        reduce(navigated, { kind: 'navigated', id, url: MAP, title: 'World map', canGoBack: false, canGoForward: false }, LIMITS),
        navigated
    );
    assert.equal(reduce(navigated, { kind: 'loading', id, loading: false }, LIMITS).tabs[0]!.loading, false);
    assert.equal(reduce(navigated, { kind: 'set-collapsed', collapsed: false }, LIMITS), navigated);
    assert.equal(reduce(navigated, { kind: 'activate', id }, LIMITS), navigated);
});

test('an update for a tab that has closed is dropped, not an error', () => {
    const pane = run(start(), open(MAP, 'World Map'));
    const closed = run(pane, { kind: 'close', id: pane.activeId! });
    assert.equal(reduce(closed, { kind: 'loading', id: pane.activeId!, loading: false }, LIMITS), closed);
    assert.equal(reduce(closed, { kind: 'close', id: pane.activeId! }, LIMITS), closed);
    assert.equal(reduce(closed, { kind: 'activate', id: pane.activeId! }, LIMITS), closed);
});

test('a pane with nothing in it cannot be collapsed, so no link ever opens into a hidden one', () => {
    const empty = start();
    assert.equal(reduce(empty, { kind: 'set-collapsed', collapsed: true }, LIMITS), empty);
    const closed = run(start(), open(CLUES, 'Clue Help'), { kind: 'close', id: 'page-1' });
    assert.equal(reduce(closed, { kind: 'set-collapsed', collapsed: true }, LIMITS), closed);
});

test('an update that says nothing about a field leaves it alone rather than blanking it', () => {
    const pane = run(start(), open(MAP, 'World Map'));
    const id = pane.activeId!;
    const titled = run(pane, { kind: 'navigated', id, url: MAP, title: 'World map', canGoBack: true, canGoForward: false });
    // `Partial` reads as "these fields"; a raw spread would read it as "and
    // blank the rest", and the guard would wave that through on any field that
    // was already undefined.
    const patched = reduce(titled, { kind: 'navigated', id, url: MAP, title: undefined as unknown as string, canGoBack: true, canGoForward: false }, LIMITS);
    assert.equal(patched.tabs[0]!.title, 'World map');
});
