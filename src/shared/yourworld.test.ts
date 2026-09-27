import { test } from 'node:test';
import assert from 'node:assert/strict';
import { characterMenu, formatPlaytime, isSection, isXpRate, lineTitle, PROBLEM_LABEL, PROBLEM_TEXT, sectionsOffered, worldRunning, XP_RATES, type CharacterMenuItem } from './yourworld.ts';

test('worldRunning is every status but stopped and failed', () => {
    assert.equal(worldRunning('stopped'), false);
    assert.equal(worldRunning('failed'), false);
    for (const status of ['preparing', 'starting', 'ready', 'stopping'] as const) assert.equal(worldRunning(status), true, status);
});

test('isXpRate takes the four offered rates and nothing else', () => {
    assert.deepEqual([...XP_RATES], [1, 2, 5, 10]);
    for (const rate of XP_RATES) assert.equal(isXpRate(rate), true);
    for (const other of [0, 3, 100, -1, 1.5, '5', null, undefined, Number.NaN]) assert.equal(isXpRate(other), false, String(other));
});

test('formatPlaytime reads ticks of 600 ms as minutes, hours and days', () => {
    assert.equal(formatPlaytime(0), 'under a minute');
    assert.equal(formatPlaytime(99), 'under a minute');
    assert.equal(formatPlaytime(-5), 'under a minute');
    assert.equal(formatPlaytime(100), '1m');
    assert.equal(formatPlaytime(3529), '35m');
    assert.equal(formatPlaytime(6000), '1h 00m');
    assert.equal(formatPlaytime(6100), '1h 01m');
    assert.equal(formatPlaytime(143_999), '23h 59m');
    assert.equal(formatPlaytime(144_000), '1d 0h');
});

test('every file problem has a sentence and a label', () => {
    for (const problem of ['not-a-save', 'too-new', 'corrupt', 'unreadable'] as const) {
        assert.match(PROBLEM_TEXT[problem], /\.$/);
        assert.ok(PROBLEM_LABEL[problem].length > 0);
    }
});

const labels = (items: CharacterMenuItem[]): string[] => items.map(item => (item.kind === 'separator' ? '—' : item.label));
const summary = { version: 6, combatLevel: 3, totalLevel: 32, playtimeTicks: 0 };

test('characterMenu offers each change, then Delete apart from them', () => {
    const items = characterMenu({ summary }, [289]);
    assert.deepEqual(labels(items), ['Rename…', 'Copy as…', 'Copy to rev 289', 'Export…', '—', 'Delete']);
    assert.ok(items.every(item => item.kind === 'separator' || item.enabled));
    assert.deepEqual(
        items.flatMap(item => (item.kind === 'item' ? [item.action] : [])),
        [{ kind: 'rename' }, { kind: 'duplicate' }, { kind: 'copy-to', revision: 289 }, { kind: 'export' }, { kind: 'delete' }]
    );
});

test('characterMenu copies to each other revision, and to none where there is none', () => {
    assert.deepEqual(labels(characterMenu({ summary }, [289, 317])).filter(label => label.startsWith('Copy to')), ['Copy to rev 289', 'Copy to rev 317']);
    assert.deepEqual(labels(characterMenu({ summary }, [])), ['Rename…', 'Copy as…', 'Export…', '—', 'Delete']);
});

test('characterMenu greys what main refuses for a damaged save, and keeps Export and Delete', () => {
    const enabled = characterMenu({ summary: null }, [289]).flatMap(item => (item.kind === 'item' ? [`${item.label} ${item.enabled}`] : []));
    assert.deepEqual(enabled, ['Rename… false', 'Copy as… false', 'Copy to rev 289 false', 'Export… true', 'Delete true']);
});

test('sectionsOffered lists Friends only where there is a share', () => {
    assert.deepEqual(sectionsOffered(true).map(s => s.id), ['world', 'characters', 'commands', 'builds', 'friends']);
    assert.deepEqual(sectionsOffered(false).map(s => s.id), ['world', 'characters', 'commands', 'builds']);
    for (const id of ['world', 'friends']) assert.equal(isSection(id), true, id);
    for (const other of ['World', 'settings', '', null, 1]) assert.equal(isSection(other), false, String(other));
});

test('lineTitle adds the revision only where the name does not say it', () => {
    assert.equal(lineTitle({ name: 'Lost City 274', revision: 274 }), 'Lost City 274');
    assert.equal(lineTitle({ name: '274 classic', revision: 274 }), '274 classic');
    assert.equal(lineTitle({ name: 'Lost City', revision: 274 }), 'Lost City · rev 274');
    assert.equal(lineTitle({ name: 'Lost City 2745', revision: 274 }), 'Lost City 2745 · rev 274');
    assert.equal(lineTitle({ name: 'Build 1274', revision: 274 }), 'Build 1274 · rev 274');
});
