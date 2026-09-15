import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEdit, deleteTimer, emptyTimersState, newCustomId, newServerTimers, readSaveInput, readTimers, restoreTimer, saveTimer, timersFor } from './defs.ts';
import type { TimerDef, TimerSaveInput, TimersState } from '../../shared/timers.ts';

const AFK: TimerDef = { id: 'afk', name: 'AFK', kind: 'countdown', durationMs: 90_000, thresholdMs: 15_000, volume: 0.8, afk: true };
const THIEVING: TimerDef = { id: 'thieving', name: 'Thieving', kind: 'countdown', durationMs: 300_000, thresholdMs: 30_000, volume: 0.8, afk: false };
const MINE: TimerDef = { id: 'custom-0badf00d', name: 'Herb run', kind: 'countdown', durationMs: 4_800_000, thresholdMs: 60_000, volume: 1, afk: false };
const SERVER = [AFK, THIEVING];

const state = (over: Partial<TimersState> = {}): TimersState => ({ custom: [], edits: {}, ...over });
const input = (def: TimerDef, over: Partial<TimerSaveInput> = {}): TimerSaveInput => ({ ...def, ...over });
/** Hands out custom-00000001, custom-00000002, … so a test can say which id a new clock got. */
const counter = (): (() => string) => {
    let n = 0;
    return () => `custom-${String(++n).padStart(8, '0')}`;
};

test('every new server gets AFK and Thieving, as the spec sets them, in its own objects', () => {
    assert.deepEqual(newServerTimers(), [AFK, THIEVING]);
    const a = newServerTimers();
    a[0]!.thresholdMs = 1;
    assert.equal(newServerTimers()[0]!.thresholdMs, 15_000);
});

test('timersFor lists the built-ins with their edits, then the player\'s own', () => {
    const listed = timersFor(SERVER, state({ custom: [MINE], edits: { thieving: { thresholdMs: 60_000 } } }));
    assert.deepEqual(
        listed.map(l => [l.def.id, l.builtIn, l.edited]),
        [
            ['afk', true, false],
            ['thieving', true, true],
            ['custom-0badf00d', false, false]
        ]
    );
    assert.equal(listed[1]!.def.thresholdMs, 60_000);
});

test('an edit applies to every server that has that built-in', () => {
    const edits = { afk: { thresholdMs: 20_000 } };
    for (const serverTimers of [newServerTimers(), newServerTimers()]) {
        assert.equal(timersFor(serverTimers, state({ edits }))[0]!.def.thresholdMs, 20_000);
    }
});

test('an edit field that would break the clock is skipped, and the rest still apply', () => {
    assert.deepEqual(applyEdit(AFK, { name: 'Idle', thresholdMs: 120_000 }), { ...AFK, name: 'Idle' });
    // The kit shortens a built-in under a threshold the player had raised.
    const shorter: TimerDef = { ...AFK, durationMs: 10_000, thresholdMs: 5_000 };
    assert.deepEqual(applyEdit(shorter, { thresholdMs: 15_000, volume: 0.2 }), { ...shorter, volume: 0.2 });
    // A duration and a threshold raised together both apply.
    assert.deepEqual(applyEdit(AFK, { durationMs: 600_000, thresholdMs: 120_000 }), { ...AFK, durationMs: 600_000, thresholdMs: 120_000 });
    assert.deepEqual(applyEdit(AFK, undefined), AFK);
});

test('a duration and a threshold lowered together both apply', () => {
    // Field by field, the lower duration alone would sit under the built-in's threshold.
    assert.deepEqual(applyEdit(THIEVING, { durationMs: 20_000, thresholdMs: 10_000 }), { ...THIEVING, durationMs: 20_000, thresholdMs: 10_000 });
    assert.deepEqual(applyEdit(AFK, { durationMs: 10_000, thresholdMs: 5_000 }), { ...AFK, durationMs: 10_000, thresholdMs: 5_000 });
});

test('a built-in saved with a lower duration and threshold is listed with both', () => {
    const saved = saveTimer(state(), SERVER, input(THIEVING, { durationMs: 20_000, thresholdMs: 10_000 }), counter());
    assert.ok(saved.ok);
    const def = timersFor(SERVER, saved.state)[1]!.def;
    assert.equal(def.durationMs, 20_000);
    assert.equal(def.thresholdMs, 10_000);
});

test('saving a built-in stores only the fields that differ from this server\'s', () => {
    const saved = saveTimer(state(), SERVER, input(AFK, { thresholdMs: 20_000 }), counter());
    assert.deepEqual(saved, { ok: true, state: state({ edits: { afk: { thresholdMs: 20_000 } } }) });
});

test('saving a built-in unchanged removes its edit', () => {
    const saved = saveTimer(state({ edits: { afk: { thresholdMs: 20_000 } } }), SERVER, input(AFK), counter());
    assert.deepEqual(saved, { ok: true, state: state() });
});

test('restore clears a built-in\'s edit, and refuses a custom clock', () => {
    assert.deepEqual(restoreTimer(state({ edits: { afk: { volume: 0 } } }), 'afk'), { ok: true, state: state() });
    assert.deepEqual(restoreTimer(state(), 'afk'), { ok: true, state: state() }, 'nothing to clear is still fine');
    assert.equal(restoreTimer(state({ custom: [MINE] }), MINE.id).ok, false);
});

test('a built-in cannot change kind or be deleted', () => {
    const asTimer = saveTimer(state(), SERVER, input(AFK, { kind: 'timer', durationMs: null, thresholdMs: 20_000 }), counter());
    assert.deepEqual(asTimer, { ok: false, error: "A built-in clock's kind can't be changed." });
    assert.deepEqual(deleteTimer(state(), 'afk'), { ok: false, error: "Built-in clocks can't be deleted." });
});

test('saving an id this server has no built-in for is refused', () => {
    const saved = saveTimer(state(), [AFK], input(THIEVING), counter());
    assert.equal(saved.ok, false);
});

test('save adds a custom clock with a fresh id and a trimmed name, and refuses the 21st', () => {
    const saved = saveTimer(state(), SERVER, { ...MINE, id: null, name: '  Herb run ' }, counter());
    assert.deepEqual(saved, { ok: true, state: state({ custom: [{ ...MINE, id: 'custom-00000001' }] }) });

    const full = state({ custom: Array.from({ length: 20 }, (_, i) => ({ ...MINE, id: `custom-${i}` })) });
    assert.deepEqual(saveTimer(full, SERVER, { ...MINE, id: null }, counter()), { ok: false, error: 'You already have 20 of your own.' });
});

test('save replaces a custom clock in place, and refuses one that is gone', () => {
    const other: TimerDef = { ...MINE, id: 'custom-00000002', name: 'Birdhouses' };
    const saved = saveTimer(state({ custom: [MINE, other] }), SERVER, input(MINE, { kind: 'timer', durationMs: null, thresholdMs: 20_000 }), counter());
    assert.deepEqual(saved, { ok: true, state: state({ custom: [{ ...MINE, kind: 'timer', durationMs: null, thresholdMs: 20_000 }, other] }) });
    assert.deepEqual(saveTimer(state(), SERVER, input(MINE), counter()), { ok: false, error: 'That clock no longer exists.' });
});

test('save refuses an invalid definition with the reason the form would give', () => {
    assert.deepEqual(saveTimer(state(), SERVER, input(AFK, { thresholdMs: 90_000 }), counter()), { ok: false, error: 'The threshold must be shorter than the duration.' });
});

test('delete removes a custom clock and leaves the rest', () => {
    const other: TimerDef = { ...MINE, id: 'custom-00000002' };
    const edits = { afk: { volume: 0.5 } };
    assert.deepEqual(deleteTimer(state({ custom: [MINE, other], edits }), MINE.id), { ok: true, state: state({ custom: [other], edits }) });
    assert.equal(deleteTimer(state(), MINE.id).ok, false);
});

test('nothing here changes the state it was given', () => {
    const before = state({ custom: [MINE], edits: { afk: { thresholdMs: 20_000 } } });
    const copy = structuredClone(before);
    saveTimer(before, SERVER, input(AFK, { thresholdMs: 30_000 }), counter());
    saveTimer(before, SERVER, input(MINE, { name: 'Changed' }), counter());
    saveTimer(before, SERVER, { ...MINE, id: null }, counter());
    deleteTimer(before, MINE.id);
    restoreTimer(before, 'afk');
    timersFor(SERVER, before)[0]!.def.name = 'mutated';
    assert.deepEqual(before, copy);
});

test('readTimers keeps good entries beside bad ones', () => {
    const read = readTimers({
        custom: [MINE, { junk: true }, { ...MINE, id: 'afk' }, MINE, { ...MINE, id: 'custom-2', thresholdMs: Number.NaN }],
        edits: {
            afk: { thresholdMs: 20_000, volume: 'loud', afk: 'yes', kind: 'timer' },
            thieving: 'nope',
            'custom-0badf00d': { name: 'x' },
            '': { name: 'y' },
            lostcity: {}
        }
    });
    assert.deepEqual(read, state({ custom: [MINE], edits: { afk: { thresholdMs: 20_000 } } }));
});

test('readTimers keeps at most 20 custom clocks, and a missing block is the empty one', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ ...MINE, id: `custom-${i}` }));
    assert.equal(readTimers({ custom: many, edits: {} }).custom.length, 20);
    assert.deepEqual(readTimers(undefined), emptyTimersState());
    assert.deepEqual(readTimers({ custom: 'no', edits: [] }), emptyTimersState());
});

test('readSaveInput takes a well-typed clock and refuses anything else', () => {
    assert.deepEqual(readSaveInput({ ...MINE, id: null }), { ...MINE, id: null });
    assert.deepEqual(readSaveInput({ ...MINE, extra: 1 }), MINE, 'unknown fields are not carried');
    assert.equal(readSaveInput({ ...MINE, id: '' }), null);
    assert.equal(readSaveInput({ ...MINE, afk: 1 }), null);
    assert.equal(readSaveInput({ ...MINE, durationMs: '5:00' }), null);
    assert.equal(readSaveInput({ ...MINE, kind: 'stopwatch' }), null);
    assert.equal(readSaveInput(null), null);
});

test('newCustomId draws again until the id is free', () => {
    const draws = ['aaaaaaaa', 'bbbbbbbb', 'cccccccc'];
    const id = newCustomId(() => draws.shift()!, new Set(['custom-aaaaaaaa', 'custom-bbbbbbbb']));
    assert.equal(id, 'custom-cccccccc');
});
