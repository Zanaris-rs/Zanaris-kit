import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatLine, Presence } from './chat.ts';
import { foldLog } from './chatLog.ts';

let id = 0;

function churn(text: string, presence: Presence): ChatLine {
    return { id: ++id, channel: '#04scape', kind: 'system', nick: null, text, at: 0, highlight: false, presence };
}

function say(text: string): ChatLine {
    return { id: ++id, channel: '#04scape', kind: 'say', nick: 'bob', text, at: 0, highlight: false };
}

function note(text: string): ChatLine {
    return { id: ++id, channel: '#04scape', kind: 'system', nick: null, text, at: 0, highlight: false };
}

test('a run of churn folds into one item that counts it, keyed by its first line', () => {
    const lines = [say('hi'), churn('a joined', 'join'), churn('b joined', 'join'), churn('c left', 'part'), churn('d quit', 'quit'), churn('e is now known as f', 'nick'), say('bye')];
    const items = foldLog(lines, null);
    assert.deepEqual(
        items.map(i => i.kind),
        ['line', 'fold', 'line']
    );
    const fold = items[1]!;
    assert.ok(fold.kind === 'fold');
    assert.equal(fold.summary, '2 joined, 2 left, 1 renamed');
    assert.equal(fold.key, lines[1]!.id);
    assert.deepEqual(fold.lines, lines.slice(1, 6));
});

test('churn alone stays a line, and what is not churn never folds', () => {
    const lines = [churn('a joined', 'join'), say('hi'), note('x was kicked by y'), note('y sets mode +m'), say('bye')];
    assert.deepEqual(
        foldLog(lines, null).map(i => i.kind),
        ['line', 'line', 'line', 'line', 'line']
    );
});

test('a run breaks where the new lines begin, so the divider has a boundary to sit on', () => {
    const lines = [churn('a joined', 'join'), churn('b joined', 'join'), churn('c joined', 'join')];
    assert.deepEqual(
        foldLog(lines, lines[2]!.id).map(i => i.kind),
        ['fold', 'line']
    );
    assert.deepEqual(
        foldLog(lines, lines[1]!.id).map(i => i.kind),
        ['line', 'fold']
    );
});

test('what did not happen is left out of the summary, and a part and a quit are both leaving', () => {
    const fold = foldLog([churn('a left', 'part'), churn('b quit', 'quit'), churn('c quit', 'quit')], null)[0]!;
    assert.ok(fold.kind === 'fold');
    assert.equal(fold.summary, '3 left');
});
