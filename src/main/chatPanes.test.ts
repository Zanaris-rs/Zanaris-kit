import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatPanes, chatSight, freshRoom, maySend, panelFor, panelledRooms, renamePaneRooms, renameRoom, renameRoomIn, renameSight, renamedFit, renamedRoom, roomOf, rowOf, rowRoom, unionSight, type ChatPaneState } from './chatPanes.ts';
import { arrangedAt, contentOf, leaf, refit, split, type PaneContent } from './paneTree.ts';
import type { TabSet } from './tabs.ts';

const CHAT: PaneContent = { kind: 'tool', tool: 'chat' };
const panel = (room: string): PaneContent => ({ kind: 'tool', tool: 'chat', room });

const CHANNELS = ['*', '#a', '#b', '#c'];
const ON_CHAT = (room: string | null): ChatPaneState => ({ page: 'chat', room });
const FRESH = (): ChatPaneState => ON_CHAT('#a');

// ── what a room panel is ─────────────────────────────────────────────────

test('a room panel has a room, and a chat pane, another tool and an empty pane have none', () => {
    assert.equal(roomOf(panel('#a')), '#a');
    assert.equal(roomOf(panel('*')), '*', 'Status is a room too');
    assert.equal(roomOf(CHAT), null, 'a chat pane lists rooms rather than naming one');
    assert.equal(roomOf({ kind: 'tool', tool: 'worlds' }), null);
    assert.equal(roomOf({ kind: 'game' }), null);
    assert.equal(roomOf({ kind: 'empty' }), null);
    assert.equal(roomOf(null), null, 'a pane the tree does not have');
});

// ── the rooms a window has given a panel ─────────────────────────────────

test('the rooms with a panel are each named once, however the name is cased', () => {
    const trees = [leaf('p1', panel('#a')), split('s', 'x', [leaf('p2', panel('#A')), leaf('p3', CHAT)], [0.5, 0.5])];
    assert.deepEqual(panelledRooms(trees), ['#a']);
});

test('the rooms with a panel come in the order they are first met, across every tab', () => {
    const trees = [
        split('s1', 'x', [leaf('p1', panel('zed')), leaf('p2', { kind: 'game' })], [0.5, 0.5]),
        split('s2', 'y', [leaf('p3', panel('#b')), leaf('p4', panel('zed'))], [0.5, 0.5]),
        leaf('p5', panel('*'))
    ];
    assert.deepEqual(panelledRooms(trees), ['zed', '#b', '*']);
});

test('a chat pane and the other tools give no room a panel', () => {
    assert.deepEqual(panelledRooms([split('s', 'x', [leaf('p1', CHAT), leaf('p2', { kind: 'tool', tool: 'worlds' })], [0.5, 0.5])]), []);
});

test('the row lists every room chat has except those with a panel, in chat\'s order', () => {
    assert.deepEqual(rowOf(['*', '#a', '#b', 'zed'], ['#B']), ['*', '#a', 'zed'], 'matched however the name is cased');
    assert.deepEqual(rowOf(['*', '#a'], []), ['*', '#a']);
    assert.deepEqual(rowOf(['*', '#a'], ['#a', '*']), []);
});

test('the row is a copy of chat\'s list, so changing one does not change the other', () => {
    const channels = ['*', '#a'];
    const row = rowOf(channels, []);
    row.push('#z');
    assert.deepEqual(channels, ['*', '#a']);
});

test('a room with a panel in one window is still in the row of another', () => {
    const channels = ['*', '#a', '#b'];
    const windowA = [leaf('p1', panel('#a'))];
    const windowB = [leaf('p2', CHAT)];
    assert.deepEqual(rowOf(channels, panelledRooms(windowA)), ['*', '#b']);
    assert.deepEqual(rowOf(channels, panelledRooms(windowB)), ['*', '#a', '#b']);
});

// ── the room a new chat pane starts on ───────────────────────────────────

test('a new chat pane starts on the room last picked, when this row has it', () => {
    assert.equal(freshRoom(['*', '#a', '#b'], '#b'), '#b');
    assert.equal(freshRoom(['*', '#a', '#b'], '*'), '*', 'Status can be the one last picked');
});

test('the room last picked is matched however the name is cased, and answered as the row spells it', () => {
    assert.equal(freshRoom(['*', '#Lost'], '#lost'), '#Lost');
});

test('a new chat pane starts on the first room that is not Status, when the one last picked is not in the row', () => {
    assert.equal(freshRoom(['*', '#a'], '#gone'), '#a');
    assert.equal(freshRoom(['*', '#a', '#b'], null), '#a');
});

test('a new chat pane starts on Status when Status is all the row has, and on nothing when it has nothing', () => {
    assert.equal(freshRoom(['*'], null), '*');
    assert.equal(freshRoom(['*'], '#gone'), '*');
    assert.equal(freshRoom([], '#a'), null);
    assert.equal(freshRoom([], null), null);
});

test('a row with no Status has its first room, whatever that is', () => {
    assert.equal(freshRoom(['#a', 'zed'], null), '#a');
    assert.equal(freshRoom(['zed'], null), 'zed');
});

// ── each chat pane's page and room ───────────────────────────────────────

test('a new chat pane gets what fresh() gives, and fresh() is asked once however many panes are new', () => {
    let asked = 0;
    const fresh = (): ChatPaneState => {
        asked++;
        return ON_CHAT('#b');
    };
    const trees = [split('s', 'x', [leaf('p1', CHAT), leaf('p2', CHAT)], [0.5, 0.5]), leaf('p3', CHAT)];
    const panes = chatPanes(trees, new Map(), CHANNELS, [], fresh);
    assert.deepEqual([...panes], [['p1', ON_CHAT('#b')], ['p2', ON_CHAT('#b')], ['p3', ON_CHAT('#b')]]);
    assert.equal(asked, 1);
});

test('fresh() is not asked when no chat pane is new', () => {
    let asked = 0;
    const fresh = (): ChatPaneState => {
        asked++;
        return FRESH();
    };
    const known = new Map([['p1', ON_CHAT('#b')], ['p2', { page: 'settings' as const, room: '#c' }]]);
    chatPanes([leaf('p1', CHAT), leaf('p2', CHAT)], known, CHANNELS, [], fresh);
    assert.equal(asked, 0);
});

test('a chat pane keeps its page and its room, in every tab', () => {
    const trees = [split('s', 'y', [leaf('p1', { kind: 'game' }), leaf('p2', CHAT)], [0.5, 0.5]), leaf('p3', CHAT)];
    const known = new Map([['p2', { page: 'settings' as const, room: '#c' }], ['p3', ON_CHAT('#b')]]);
    const panes = chatPanes(trees, known, CHANNELS, [], FRESH);
    assert.deepEqual([...panes], [['p2', { page: 'settings', room: '#c' }], ['p3', ON_CHAT('#b')]]);
});

test('room panels are not in the map, their room being in their content', () => {
    const trees = [split('s', 'x', [leaf('p1', CHAT), leaf('p2', panel('#b'))], [0.5, 0.5])];
    const panes = chatPanes(trees, new Map(), CHANNELS, ['#b'], FRESH);
    assert.deepEqual([...panes.keys()], ['p1']);
});

test('a pane on a room that becomes panelled lands on the next room of the row', () => {
    const panes = chatPanes([leaf('p1', CHAT)], new Map([['p1', ON_CHAT('#b')]]), CHANNELS, ['#b'], FRESH);
    assert.deepEqual(panes.get('p1'), ON_CHAT('#c'));
});

test('with no room after it in the row, a pane lands on the nearest one before it', () => {
    const panes = chatPanes([leaf('p1', CHAT)], new Map([['p1', ON_CHAT('#b')]]), CHANNELS, ['#b', '#c'], FRESH);
    assert.deepEqual(panes.get('p1'), ON_CHAT('#a'));
    const nearest = chatPanes([leaf('p1', CHAT)], new Map([['p1', ON_CHAT('#c')]]), CHANNELS, ['#b', '#c'], FRESH);
    assert.deepEqual(nearest.get('p1'), ON_CHAT('#a'), 'not Status, which is further back');
});

test('the next room is the next in chat\'s order, even when rooms between have panels', () => {
    const channels = ['*', '#a', '#b', '#c', '#d'];
    const panes = chatPanes([leaf('p1', CHAT)], new Map([['p1', ON_CHAT('#a')]]), channels, ['#a', '#b', '#c'], FRESH);
    assert.deepEqual(panes.get('p1'), ON_CHAT('#d'));
});

test('a panel is matched to the pane\'s room however the name is cased', () => {
    const panes = chatPanes([leaf('p1', CHAT)], new Map([['p1', ON_CHAT('#b')]]), CHANNELS, ['#B'], FRESH);
    assert.deepEqual(panes.get('p1'), ON_CHAT('#c'));
});

test('a pane on a room that is not panelled stays where it is', () => {
    const panes = chatPanes([leaf('p1', CHAT)], new Map([['p1', ON_CHAT('#b')]]), CHANNELS, ['#c'], FRESH);
    assert.deepEqual(panes.get('p1'), ON_CHAT('#b'));
});

test('a pane keeps the room as it spelled it while the row has it by another spelling', () => {
    const panes = chatPanes([leaf('p1', CHAT)], new Map([['p1', ON_CHAT('#B')]]), CHANNELS, [], FRESH);
    assert.deepEqual(panes.get('p1'), ON_CHAT('#B'));
});

test('a pane on a room chat no longer has lands on Status', () => {
    const channels = ['*', '#a', '#c'];
    const panes = chatPanes([leaf('p1', CHAT)], new Map([['p1', ON_CHAT('#b')]]), channels, [], FRESH);
    assert.deepEqual(panes.get('p1'), ON_CHAT('*'));
});

test('a pane on a room chat no longer has lands on Status itself, not just on whatever the row lists first', () => {
    const channels = ['#a', '*', '#c'];
    const panes = chatPanes([leaf('p1', CHAT)], new Map([['p1', ON_CHAT('#b')]]), channels, [], FRESH);
    assert.deepEqual(panes.get('p1'), ON_CHAT('*'));
});

test('a pane on a room chat no longer has lands on the first room of the row when Status has a panel', () => {
    const channels = ['*', '#a', '#c'];
    const panes = chatPanes([leaf('p1', CHAT)], new Map([['p1', ON_CHAT('#b')]]), channels, ['*'], FRESH);
    assert.deepEqual(panes.get('p1'), ON_CHAT('#a'));
});

test('a room closed while it also has a panel still lands on Status, not on a neighbour', () => {
    const channels = ['*', '#a', '#c'];
    const panes = chatPanes([leaf('p1', CHAT)], new Map([['p1', ON_CHAT('#b')]]), channels, ['#b'], FRESH);
    assert.deepEqual(panes.get('p1'), ON_CHAT('*'));
});

test('with every room panelled a pane has no room, and keeps its page', () => {
    const known = new Map([['p1', { page: 'settings' as const, room: '#a' }], ['p2', ON_CHAT('#b')]]);
    const panes = chatPanes([leaf('p1', CHAT), leaf('p2', CHAT)], known, CHANNELS, CHANNELS, FRESH);
    assert.deepEqual([...panes], [['p1', { page: 'settings', room: null }], ['p2', { page: 'chat', room: null }]]);
});

test('with no rooms at all, as when chat has no connection yet, a pane has no room', () => {
    const panes = chatPanes([leaf('p1', CHAT)], new Map([['p1', ON_CHAT('#a')]]), [], [], FRESH);
    assert.deepEqual(panes.get('p1'), ON_CHAT(null));
});

test('a pane with no room takes the room fresh() gives once the row has one again, keeping its page', () => {
    const known = new Map([['p1', { page: 'settings' as const, room: null }]]);
    const panes = chatPanes([leaf('p1', CHAT)], known, CHANNELS, [], () => ON_CHAT('#c'));
    assert.deepEqual(panes.get('p1'), { page: 'settings', room: '#c' });
});

test('a pane with no room stays so while the row has none, and fresh() is not asked', () => {
    let asked = 0;
    const known = new Map([['p1', ON_CHAT(null)]]);
    const panes = chatPanes([leaf('p1', CHAT)], known, CHANNELS, CHANNELS, () => {
        asked++;
        return FRESH();
    });
    assert.deepEqual(panes.get('p1'), ON_CHAT(null));
    assert.equal(asked, 0);
});

test('fresh() is asked once for a new pane and a pane with no room together', () => {
    let asked = 0;
    const known = new Map([['p1', ON_CHAT(null)]]);
    const panes = chatPanes([leaf('p1', CHAT), leaf('p2', CHAT)], known, CHANNELS, [], () => {
        asked++;
        return ON_CHAT('#b');
    });
    assert.deepEqual([...panes], [['p1', ON_CHAT('#b')], ['p2', ON_CHAT('#b')]]);
    assert.equal(asked, 1);
});

test('a pane that no longer holds chat drops out, so chat put back in it starts afresh', () => {
    const known = new Map([['p1', { page: 'settings' as const, room: '#c' }]]);
    const gone = chatPanes([leaf('p1', { kind: 'tool', tool: 'worlds' })], known, CHANNELS, [], FRESH);
    assert.deepEqual([...gone], []);
    const back = chatPanes([leaf('p1', CHAT)], gone, CHANNELS, [], () => ON_CHAT('#b'));
    assert.deepEqual([...back], [['p1', ON_CHAT('#b')]]);
});

test('a chat pane that comes to hold a room drops out of the map, and one that stops holding it starts afresh', () => {
    const known = new Map([['p1', ON_CHAT('#c')]]);
    const asPanel = chatPanes([leaf('p1', panel('#c'))], known, CHANNELS, ['#c'], FRESH);
    assert.deepEqual([...asPanel], []);
    const back = chatPanes([leaf('p1', CHAT)], asPanel, CHANNELS, [], () => ON_CHAT('#b'));
    assert.deepEqual([...back], [['p1', ON_CHAT('#b')]]);
});

test('the map it is handed is not changed', () => {
    const known = new Map([['p1', ON_CHAT('#b')]]);
    chatPanes([leaf('p1', CHAT)], known, CHANNELS, ['#b'], FRESH);
    assert.deepEqual([...known], [['p1', ON_CHAT('#b')]]);
});

// ── what the tab in front shows of chat ──────────────────────────────────

const FRONT = split('s', 'x', [leaf('p1', CHAT), leaf('p2', CHAT), leaf('p3', panel('zed'))], [0.3, 0.3, 0.4]);
const ROW = ['*', '#b', '#c'];

test('the front tab reads the room of each chat pane on its conversation and of each room panel, and lists the whole row', () => {
    const panes = new Map([['p1', ON_CHAT('#a')], ['p2', { page: 'settings' as const, room: '#b' }]]);
    assert.deepEqual(chatSight(FRONT, panes, ROW), { reading: ['#a', 'zed'], rowed: ROW });
});

test('with every chat pane on its Settings page only the room panels are read, and no row is', () => {
    const panes = new Map([['p1', { page: 'settings' as const, room: '#a' }], ['p2', { page: 'settings' as const, room: '#b' }]]);
    assert.deepEqual(chatSight(FRONT, panes, ROW), { reading: ['zed'], rowed: [] });
});

test('a chat pane whose state is missing counts for nothing', () => {
    assert.deepEqual(chatSight(FRONT, new Map(), ROW), { reading: ['zed'], rowed: [] });
    assert.deepEqual(chatSight(leaf('p1', CHAT), new Map(), ROW), { reading: [], rowed: [] });
});

test('a chat pane with no room is on its conversation, and reads nothing there', () => {
    const sight = chatSight(leaf('p1', CHAT), new Map([['p1', ON_CHAT(null)]]), []);
    assert.deepEqual(sight, { reading: [], rowed: [] });
});

test('a room panel is read whatever the panes state says, and shows no row', () => {
    const sight = chatSight(leaf('p1', panel('#a')), new Map(), ROW);
    assert.deepEqual(sight, { reading: ['#a'], rowed: [] });
});

test('a room shown twice in the front tab is read once, however its name is cased', () => {
    const tree = split('s', 'x', [leaf('p1', CHAT), leaf('p2', panel('#A')), leaf('p3', panel('#a'))], [0.3, 0.3, 0.4]);
    const sight = chatSight(tree, new Map([['p1', ON_CHAT('#a')]]), ROW);
    assert.deepEqual(sight.reading, ['#a']);
});

test('a tab with no chat in it shows nothing of chat', () => {
    const tree = split('s', 'x', [leaf('p1', { kind: 'game' }), leaf('p2', { kind: 'tool', tool: 'worlds' })], [0.5, 0.5]);
    assert.deepEqual(chatSight(tree, new Map(), ROW), { reading: [], rowed: [] });
});

test('the row a sight carries is a copy', () => {
    const row = ['*', '#a'];
    const sight = chatSight(leaf('p1', CHAT), new Map([['p1', ON_CHAT('*')]]), row);
    sight.rowed.push('#z');
    assert.deepEqual(row, ['*', '#a']);
});

// ── finding and renaming panels ──────────────────────────────────────────

function twoTabs(): TabSet {
    return {
        tabs: [
            { id: 'a', tree: leaf('p1', { kind: 'game' }), focusedPaneId: 'p1' },
            { id: 'b', tree: split('s', 'x', [leaf('p2', CHAT), leaf('p3', panel('#Lost')), leaf('p4', panel('zed'))], [0.3, 0.3, 0.4]), focusedPaneId: 'p2' }
        ],
        activeId: 'a'
    };
}

test('a panel is found by its room however the name is cased, with its tab and pane', () => {
    assert.deepEqual(panelFor(twoTabs().tabs, '#lost'), { tabId: 'b', paneId: 'p3' });
    assert.deepEqual(panelFor(twoTabs().tabs, 'zed'), { tabId: 'b', paneId: 'p4' });
});

test('no panel is found for a room that has none, or for one only a chat pane is on', () => {
    assert.equal(panelFor(twoTabs().tabs, '#nobody'), null);
    assert.equal(panelFor([{ id: 'a', tree: leaf('p1', CHAT) }], '#a'), null);
});

test('the first panel in tab order is the one found when a room has two', () => {
    const tabs = [
        { id: 'a', tree: leaf('p1', { kind: 'empty' }) },
        { id: 'b', tree: leaf('p2', panel('#a')) },
        { id: 'c', tree: leaf('p3', panel('#a')) }
    ];
    assert.deepEqual(panelFor(tabs, '#a'), { tabId: 'b', paneId: 'p2' });
});

test('a panel for a conversation follows the person to their new nick, in a tab behind', () => {
    const renamed = renameRoom(twoTabs(), 'zed', 'zed_');
    assert.equal(renamed.activeId, 'a');
    assert.deepEqual(renamed.tabs[1]!.tree, split('s', 'x', [leaf('p2', CHAT), leaf('p3', panel('#Lost')), leaf('p4', panel('zed_'))], [0.3, 0.3, 0.4]));
    assert.equal(renamed.tabs[1]!.focusedPaneId, 'p2');
});

test('a rename finds the panel however the old nick is cased, and leaves the other tabs as they were', () => {
    const set = twoTabs();
    const renamed = renameRoom(set, 'ZED', 'zed_');
    assert.deepEqual(panelledRooms(renamed.tabs.map(t => t.tree)), ['#Lost', 'zed_']);
    assert.equal(renamed.tabs[0], set.tabs[0], 'a tab with nothing to rename is the one it was');
});

test('a rename leaves chat panes and other rooms\' panels alone', () => {
    const trees = renameRoom(twoTabs(), 'zed', 'zed_').tabs.map(t => t.tree);
    assert.deepEqual(panelledRooms(trees), ['#Lost', 'zed_']);
    assert.deepEqual([...chatPanes(trees, new Map(), CHANNELS, [], FRESH).keys()], ['p2']);
});

test('a rename of a room no panel is for returns the set it was handed', () => {
    const set = twoTabs();
    assert.equal(renameRoom(set, 'nobody', 'somebody'), set);
    const chatOnly: TabSet = { tabs: [{ id: 'a', tree: leaf('p1', CHAT), focusedPaneId: 'p1' }], activeId: 'a' };
    assert.equal(renameRoom(chatOnly, '#a', '#b'), chatOnly, 'a chat pane is not a panel for any room');
});

test('a rename to the name a panel already has changes nothing', () => {
    const set = twoTabs();
    assert.equal(renameRoom(set, 'zed', 'zed'), set);
});

// ── a conversation's panes following it to a new nick ────────────────────

test('a room renamed is the new name, matched however the old one is cased, and any other room is itself', () => {
    assert.equal(renamedRoom('zed', 'ZED', 'zed_'), 'zed_');
    assert.equal(renamedRoom('#a', 'zed', 'zed_'), '#a');
    assert.equal(renamedRoom('zed', 'zed', 'Zed'), 'Zed', 'a rename that only changes the case is still one');
});

test('a chat pane on a conversation follows the person to their new nick, on the page it was on', () => {
    const panes = new Map<string, ChatPaneState>([
        ['p1', ON_CHAT('Zed')],
        ['p2', { page: 'settings', room: 'zed' }],
        ['p3', ON_CHAT('#a')],
        ['p4', ON_CHAT(null)]
    ]);
    const renamed = renamePaneRooms(panes, 'zed', 'zed_');
    assert.deepEqual([...renamed], [
        ['p1', ON_CHAT('zed_')],
        ['p2', { page: 'settings', room: 'zed_' }],
        ['p3', ON_CHAT('#a')],
        ['p4', ON_CHAT(null)]
    ]);
    assert.deepEqual(panes.get('p1'), ON_CHAT('Zed'), 'the map it was handed is left as it was');
});

test('a pane renamed onto the conversation stays on it, rather than stepping aside, once chat has the new name', () => {
    const known = renamePaneRooms(new Map([['p1', ON_CHAT('zed')]]), 'zed', 'zed_');
    const panes = chatPanes([leaf('p1', CHAT)], known, ['*', '#a', 'zed_'], [], FRESH);
    assert.deepEqual(panes.get('p1'), ON_CHAT('zed_'));
});

test('what a window shows of chat follows a rename, in what it reads and in its row', () => {
    const renamed = renameSight({ reading: ['#a', 'ZED'], rowed: ['*', '#a', 'zed'] }, 'zed', 'zed_');
    assert.deepEqual(renamed, { reading: ['#a', 'zed_'], rowed: ['*', '#a', 'zed_'] });
});

// ── the row's spelling of a room ─────────────────────────────────────────

test('a room is found in the row however it is cased, and answered as the row spells it', () => {
    assert.equal(rowRoom(['*', '#LostHQ'], '#losthq'), '#LostHQ');
    assert.equal(rowRoom(['*', '#a'], '*'), '*');
});

test('a room the row does not list, because it has a panel or chat lacks it, is not found', () => {
    assert.equal(rowRoom(['*', '#a'], '#b'), null);
    assert.equal(rowRoom([], '*'), null);
});

// ── what every window shows of chat, together ────────────────────────────

test('the windows together read and list each room once, in the order first met, however it is cased', () => {
    const union = unionSight([
        { reading: ['#a'], rowed: ['*', '#a', '#b'] },
        { reading: ['#B', 'zed'], rowed: [] },
        { reading: ['#A'], rowed: ['*', '#B', 'zed'] }
    ]);
    assert.deepEqual(union, { reading: ['#a', '#B', 'zed'], rowed: ['*', '#a', '#b', 'zed'] });
});

test('no window shows anything of chat when there are none, or none shows chat', () => {
    assert.deepEqual(unionSight([]), { reading: [], rowed: [] });
    assert.deepEqual(unionSight([{ reading: [], rowed: [] }]), { reading: [], rowed: [] });
});

// ── where a typed line may go ────────────────────────────────────────────

const ROOMS = [
    { name: '*', kicked: false },
    { name: '#a', kicked: false },
    { name: '#gone', kicked: true },
    { name: 'bob', kicked: false }
];

test('Status, a room chat has and a conversation take any line', () => {
    assert.equal(maySend('*', '/whois bob', ROOMS), true);
    assert.equal(maySend('#a', 'hello', ROOMS), true);
    assert.equal(maySend('#A', 'hello', ROOMS), true, 'matched however it is cased');
    assert.equal(maySend('bob', 'hello', ROOMS), true);
});

test('a conversation chat has closed takes a line, which opens it again', () => {
    assert.equal(maySend('carol', 'are you there', ROOMS), true);
});

test('a channel chat is not in, or was kicked from, takes a join and nothing else', () => {
    for (const at of ['#notjoined', '#gone']) {
        assert.equal(maySend(at, `/join ${at}`, ROOMS), true, `a join from ${at}`);
        assert.equal(maySend(at, `/j ${at}`, ROOMS), true, `the short form, from ${at}`);
        assert.equal(maySend(at, 'hello', ROOMS), false, `a line said in ${at} would be a PRIVMSG into a room we are not in`);
        assert.equal(maySend(at, '/me waves', ROOMS), false);
        assert.equal(maySend(at, '/whois bob', ROOMS), false, 'its answer would land in a room we are not in');
        assert.equal(maySend(at, '/join', ROOMS), false, 'a join that names nothing joins nothing');
    }
});

test('a room no room can be is refused whatever is typed', () => {
    assert.equal(maySend('not a nick', 'hello', ROOMS), false);
    assert.equal(maySend('', '/join #a', ROOMS), false);
});

// ── a rename and the arrangement a resize is fitted from ─────────────────

test('a tree is renamed by its panels for the room, and with none for it is the tree it was', () => {
    const tree = split('s', 'x', [leaf('p1', CHAT), leaf('p2', panel('#a'))], [0.5, 0.5]);
    assert.equal(renameRoomIn(tree, 'zed', 'zed_'), tree);
    assert.deepEqual(contentOf(renameRoomIn(leaf('p1', panel('Zed')), 'zed', 'zed_'), 'p1'), panel('zed_'));
});

test('a rename is chat\'s, not a gesture: a resize after it is still fitted from the arrangement the player left', () => {
    const base = split('s', 'x', [leaf('p1', { kind: 'game' }), leaf('p2', panel('zed'))], [0.7, 0.3]);
    // The window shrank, so the tree on screen is `base` fitted smaller.
    const shrunk = refit(arrangedAt(base, { width: 1000, height: 600 }), base, { width: 800, height: 600 });
    const now = renameRoomIn(shrunk.shown, 'zed', 'zed_');
    const carried = renamedFit(shrunk, shrunk.shown, now, 'zed', 'zed_');
    assert.equal(carried.shown, now, 'the renamed tree is the one the fit showed');
    assert.deepEqual(carried.base, renameRoomIn(base, 'zed', 'zed_'));
    assert.deepEqual(carried.from, { width: 1000, height: 600 });
    const grown = refit(carried, now, { width: 1000, height: 600 });
    assert.equal(grown.base, carried.base, 'growing back fits from the arrangement, not from the squeezed frame');
});

test('a fit the rename did not touch, or that showed another tree, is left as it was', () => {
    const tree = leaf('p1', panel('zed'));
    const fit = arrangedAt(tree, { width: 800, height: 600 });
    assert.equal(renamedFit(fit, tree, tree, 'nobody', 'somebody'), fit);
    assert.equal(renamedFit(fit, leaf('p9', CHAT), renameRoomIn(tree, 'zed', 'zed_'), 'zed', 'zed_'), fit, 'a gesture since, which the next layout fits as one');
});
