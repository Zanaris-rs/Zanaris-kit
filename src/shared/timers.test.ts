import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertTitle, blankDraft, clockTone, clockValueAt, draftOf, formatClock, isCustomId, isTimerDef, parseDuration, readDraft, timerProblem, type TimerDef } from './timers.ts';

const COUNTDOWN: TimerDef = { id: 'thieving', name: 'Thieving', kind: 'countdown', durationMs: 300_000, thresholdMs: 30_000, volume: 0.8, afk: false };
const TIMER: TimerDef = { id: 'custom-0000abcd', name: 'Stopwatch', kind: 'timer', durationMs: null, thresholdMs: 20_000, volume: 0.5, afk: false };

test('a countdown runs 1 second to 24 hours, with a threshold shorter than it', () => {
    assert.equal(timerProblem(COUNTDOWN), null);
    assert.equal(timerProblem({ ...COUNTDOWN, durationMs: 1_000, thresholdMs: 0 }), null, 'a threshold of 0 alerts at zero');
    assert.equal(timerProblem({ ...COUNTDOWN, durationMs: 86_400_000, thresholdMs: 86_399_999 }), null);
    assert.equal(timerProblem({ ...COUNTDOWN, durationMs: 999 })?.field, 'durationMs');
    assert.equal(timerProblem({ ...COUNTDOWN, durationMs: 86_400_001 })?.field, 'durationMs');
    assert.equal(timerProblem({ ...COUNTDOWN, durationMs: null })?.field, 'durationMs');
    assert.equal(timerProblem({ ...COUNTDOWN, thresholdMs: 300_000 })?.field, 'thresholdMs');
    assert.equal(timerProblem({ ...COUNTDOWN, thresholdMs: -1 })?.field, 'thresholdMs');
    assert.equal(timerProblem({ ...COUNTDOWN, thresholdMs: 300_000 })?.message, 'The threshold must be shorter than the duration.');
});

test('a timer has no duration and a threshold of 1 second to 24 hours', () => {
    assert.equal(timerProblem(TIMER), null);
    assert.equal(timerProblem({ ...TIMER, durationMs: 60_000 })?.field, 'durationMs');
    assert.equal(timerProblem({ ...TIMER, thresholdMs: 999 })?.field, 'thresholdMs');
    assert.equal(timerProblem({ ...TIMER, thresholdMs: 86_400_001 })?.field, 'thresholdMs');
    assert.equal(timerProblem({ ...TIMER, thresholdMs: 86_400_000 }), null);
});

test('a name is 1 to 40 characters once trimmed, and volume is 0 to 1', () => {
    assert.equal(timerProblem({ ...COUNTDOWN, name: '   ' })?.field, 'name');
    assert.equal(timerProblem({ ...COUNTDOWN, name: 'x'.repeat(41) })?.field, 'name');
    assert.equal(timerProblem({ ...COUNTDOWN, name: ` ${'x'.repeat(40)} ` }), null);
    assert.equal(timerProblem({ ...COUNTDOWN, volume: 0 }), null);
    assert.equal(timerProblem({ ...COUNTDOWN, volume: 1 }), null);
    assert.equal(timerProblem({ ...COUNTDOWN, volume: 1.01 })?.field, 'volume');
    assert.equal(timerProblem({ ...COUNTDOWN, volume: Number.NaN })?.field, 'volume');
    assert.equal(timerProblem({ ...COUNTDOWN, kind: 'stopwatch' as never })?.field, 'kind');
});

test('isTimerDef wants the whole shape as well as valid numbers', () => {
    assert.equal(isTimerDef(COUNTDOWN), true);
    assert.equal(isTimerDef(TIMER), true);
    assert.equal(isTimerDef({ ...COUNTDOWN, id: '' }), false);
    assert.equal(isTimerDef({ ...COUNTDOWN, afk: 'yes' }), false);
    const { afk: _afk, ...noAfk } = COUNTDOWN;
    assert.equal(isTimerDef(noAfk), false);
    assert.equal(isTimerDef({ ...COUNTDOWN, thresholdMs: Number.NaN }), false);
    assert.equal(isTimerDef(null), false);
    assert.equal(isTimerDef('afk'), false);
});

test('a custom id is the prefix and something after it', () => {
    assert.equal(isCustomId('custom-0badf00d'), true);
    assert.equal(isCustomId('custom-'), false);
    assert.equal(isCustomId('afk'), false);
});

test('formatClock reads m:ss under an hour and h:mm:ss from one', () => {
    assert.equal(formatClock(0, 'countdown'), '0:00');
    assert.equal(formatClock(90_000, 'countdown'), '1:30');
    assert.equal(formatClock(3_599_000, 'timer'), '59:59');
    assert.equal(formatClock(3_600_000, 'timer'), '1:00:00');
    assert.equal(formatClock(86_400_000, 'countdown'), '24:00:00');
});

test('a countdown rounds up and a timer rounds down, so a countdown reads 0:00 only at zero', () => {
    assert.equal(formatClock(89_001, 'countdown'), '1:30');
    assert.equal(formatClock(1, 'countdown'), '0:01');
    assert.equal(formatClock(59_999, 'timer'), '0:59');
    assert.equal(formatClock(-5, 'countdown'), '0:00');
    assert.equal(formatClock(Number.NaN, 'timer'), '0:00');
});

test('parseDuration takes seconds, m:ss and h:mm:ss', () => {
    assert.equal(parseDuration('90'), 90_000);
    assert.equal(parseDuration(' 1:30 '), 90_000);
    assert.equal(parseDuration('80:00'), 4_800_000);
    assert.equal(parseDuration('1:00:00'), 3_600_000);
    assert.equal(parseDuration('0'), 0);
    assert.equal(parseDuration('0:30'), 30_000);
});

test('parseDuration refuses what it cannot read', () => {
    for (const text of ['', '1:60', '-5', 'five', '1:5', '1:00:60', '1.5', ':30', '1::00']) assert.equal(parseDuration(text), null, text);
});

test('the banner says what happened, in the words the spec gives', () => {
    const afk: TimerDef = { ...COUNTDOWN, id: 'afk', name: 'AFK', durationMs: 90_000, thresholdMs: 15_000, afk: true };
    assert.equal(alertTitle(afk, 'threshold'), 'AFK: 15s left');
    assert.equal(alertTitle({ ...COUNTDOWN, thresholdMs: 0 }, 'zero'), "Thieving: time's up");
    assert.equal(alertTitle(TIMER, 'threshold'), 'Stopwatch: 0:20 elapsed');
    assert.equal(alertTitle({ ...COUNTDOWN, thresholdMs: 90_000 }, 'threshold'), 'Thieving: 1:30 left');
});

test('clockValueAt counts a running clock on from its snapshot and leaves the rest alone', () => {
    const at = 1_000;
    assert.equal(clockValueAt({ def: COUNTDOWN, phase: 'running', valueMs: 60_000, at }, at + 10_000), 50_000);
    assert.equal(clockValueAt({ def: COUNTDOWN, phase: 'running', valueMs: 5_000, at }, at + 10_000), 0);
    assert.equal(clockValueAt({ def: TIMER, phase: 'running', valueMs: 5_000, at }, at + 10_000), 15_000);
    assert.equal(clockValueAt({ def: COUNTDOWN, phase: 'paused', valueMs: 60_000, at }, at + 10_000), 60_000);
    assert.equal(clockValueAt({ def: COUNTDOWN, phase: 'running', valueMs: 60_000, at }, at - 500), 60_000, 'a snapshot from the future counts nothing');
});

test('the digits are dim at rest, gold while running and alarm once alerted or expired', () => {
    assert.equal(clockTone({ phase: 'idle', alerted: false }), 'dim');
    assert.equal(clockTone({ phase: 'paused', alerted: false }), 'dim');
    assert.equal(clockTone({ phase: 'paused', alerted: true }), 'dim');
    assert.equal(clockTone({ phase: 'running', alerted: false }), 'gold');
    assert.equal(clockTone({ phase: 'running', alerted: true }), 'alarm');
    assert.equal(clockTone({ phase: 'expired', alerted: true }), 'alarm');
});

test('a form reads back to the definition it was made from', () => {
    assert.deepEqual(readDraft(draftOf(COUNTDOWN)), { ok: true, input: { ...COUNTDOWN } });
    assert.deepEqual(readDraft(draftOf(TIMER)), { ok: true, input: { ...TIMER } });
});

test('a blank form is a new countdown of 5:00 with a 0:30 threshold at 80%, wanting a name', () => {
    const blank = blankDraft();
    assert.deepEqual(blank, { id: null, name: '', kind: 'countdown', duration: '5:00', threshold: '0:30', volume: 0.8, afk: false });
    const read = readDraft(blank);
    assert.equal(read.ok, false);
    assert.equal(!read.ok && read.problem.field, 'name');
    assert.deepEqual(readDraft({ ...blank, name: 'Herbs' }), {
        ok: true,
        input: { id: null, name: 'Herbs', kind: 'countdown', durationMs: 300_000, thresholdMs: 30_000, volume: 0.8, afk: false }
    });
});

test('a form names the field it cannot read, the name first', () => {
    const named = { ...blankDraft(), name: 'Herbs' };
    const duration = readDraft({ ...named, duration: 'soon' });
    assert.equal(!duration.ok && duration.problem.field, 'durationMs');
    const threshold = readDraft({ ...named, threshold: 'soon' });
    assert.equal(!threshold.ok && threshold.problem.field, 'thresholdMs');
    const both = readDraft({ ...blankDraft(), duration: 'soon' });
    assert.equal(!both.ok && both.problem.field, 'name');
    const timer = readDraft({ ...named, kind: 'timer', duration: 'ignored', threshold: '0:20' });
    assert.equal(timer.ok && timer.input.durationMs, null, "a timer's form ignores the duration box");
    const tooLong = readDraft({ ...named, duration: '1:00', threshold: '2:00' });
    assert.equal(!tooLong.ok && tooLong.problem.message, 'The threshold must be shorter than the duration.');
});
