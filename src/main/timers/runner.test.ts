import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INPUT_PUSH_EVERY_MS, TimersRunner, type TimersIo } from './runner.ts';
import type { ListedTimer } from './defs.ts';
import type { ClockView, TimerDef } from '../../shared/timers.ts';

const AFK: TimerDef = { id: 'afk', name: 'AFK', kind: 'countdown', durationMs: 90_000, thresholdMs: 15_000, volume: 0.8, afk: true };
const THIEVING: TimerDef = { id: 'thieving', name: 'Thieving', kind: 'countdown', durationMs: 300_000, thresholdMs: 30_000, volume: 0.8, afk: false };
const STOPWATCH: TimerDef = { id: 'custom-00000001', name: 'Stopwatch', kind: 'timer', durationMs: null, thresholdMs: 20_000, volume: 0.8, afk: false };

const listed = (def: TimerDef, edited = false): ListedTimer => ({ def, builtIn: !def.id.startsWith('custom-'), edited });

interface Pending {
    due: number;
    fn: () => void;
    cancelled: boolean;
}

/**
 * A runner over a hand-driven clock. `advance` fires each pending timer at its
 * own due time, as the event loop would; `sleep` moves time on with nothing
 * firing and then lets whatever was pending fire late, as a lid shut and
 * opened again does.
 */
function harness(defs: TimerDef[]) {
    let now = 1_000_000;
    const pending: Pending[] = [];
    let maxPending = 0;
    const alerts: string[] = [];
    let pushes = 0;
    const live = (): Pending[] => pending.filter(p => !p.cancelled);
    const io: TimersIo = {
        now: () => now,
        setTimer: (fn, ms) => {
            const entry: Pending = { due: now + ms, fn, cancelled: false };
            pending.push(entry);
            maxPending = Math.max(maxPending, live().length);
            return () => {
                entry.cancelled = true;
            };
        },
        alert: (def, at) => {
            alerts.push(`${def.id}:${at}`);
        },
        changed: () => {
            pushes++;
        }
    };
    const runner = new TimersRunner(defs.map(def => listed(def)), io);
    return {
        runner,
        alerts,
        live,
        pushes: () => pushes,
        maxPending: () => maxPending,
        now: () => now,
        advance(ms: number): void {
            const target = now + ms;
            for (;;) {
                const next = live()
                    .filter(p => p.due <= target)
                    .sort((a, b) => a.due - b.due)[0];
                if (!next) break;
                next.cancelled = true;
                now = Math.max(now, next.due);
                next.fn();
            }
            now = target;
        },
        sleep(ms: number): void {
            now += ms;
            for (const p of live()) {
                p.cancelled = true;
                p.fn();
            }
        },
        clock(id: string): ClockView {
            const found = runner.view().find(c => c.def.id === id);
            assert.ok(found, `no clock ${id}`);
            return found;
        }
    };
}

test('a clock starts idle, a countdown showing its duration and a timer 0:00', () => {
    const h = harness([THIEVING, STOPWATCH]);
    assert.equal(h.clock('thieving').phase, 'idle');
    assert.equal(h.clock('thieving').valueMs, 300_000);
    assert.equal(h.clock(STOPWATCH.id).valueMs, 0);
    assert.equal(h.clock(STOPWATCH.id).builtIn, false);
    assert.equal(h.live().length, 0, 'nothing running, nothing scheduled');
});

test('a countdown alerts once at its threshold, and not again', () => {
    const h = harness([THIEVING]);
    h.runner.start('thieving');
    h.advance(269_999);
    assert.deepEqual(h.alerts, []);
    h.advance(1);
    assert.deepEqual(h.alerts, ['thieving:threshold']);
    assert.equal(h.clock('thieving').alerted, true);
    h.advance(20_000);
    assert.deepEqual(h.alerts, ['thieving:threshold']);
});

test('a countdown holds at 0:00 as expired, with no second alert', () => {
    const h = harness([THIEVING]);
    h.runner.start('thieving');
    h.advance(300_000);
    assert.equal(h.clock('thieving').phase, 'expired');
    assert.equal(h.clock('thieving').valueMs, 0);
    h.advance(60_000);
    assert.equal(h.clock('thieving').phase, 'expired');
    assert.deepEqual(h.alerts, ['thieving:threshold']);
    assert.equal(h.live().length, 0);
});

test('a threshold of 0 alerts at zero, once', () => {
    const h = harness([{ ...THIEVING, durationMs: 10_000, thresholdMs: 0 }]);
    h.runner.start('thieving');
    h.advance(9_999);
    assert.deepEqual(h.alerts, []);
    h.advance(1);
    assert.deepEqual(h.alerts, ['thieving:zero']);
    h.advance(10_000);
    assert.deepEqual(h.alerts, ['thieving:zero']);
});

test('reset runs from the beginning and re-arms the alert', () => {
    const h = harness([THIEVING]);
    h.runner.start('thieving');
    h.advance(280_000);
    h.runner.reset('thieving');
    const clock = h.clock('thieving');
    assert.equal(clock.phase, 'running');
    assert.equal(clock.valueMs, 300_000);
    assert.equal(clock.alerted, false);
    h.advance(270_000);
    assert.deepEqual(h.alerts, ['thieving:threshold', 'thieving:threshold']);
});

test('reset runs an idle clock, and start runs an expired one from the beginning', () => {
    const h = harness([THIEVING]);
    h.runner.reset('thieving');
    assert.equal(h.clock('thieving').phase, 'running');
    h.advance(300_000);
    h.runner.start('thieving');
    assert.equal(h.clock('thieving').phase, 'running');
    assert.equal(h.clock('thieving').valueMs, 300_000);
    assert.equal(h.clock('thieving').alerted, false);
});

test('pause freezes the value, and start resumes without re-arming', () => {
    const h = harness([THIEVING]);
    h.runner.start('thieving');
    h.advance(280_000);
    h.runner.pause('thieving');
    h.advance(60_000);
    assert.equal(h.clock('thieving').phase, 'paused');
    assert.equal(h.clock('thieving').valueMs, 20_000);
    assert.equal(h.live().length, 0, 'a paused clock schedules nothing');
    h.runner.start('thieving');
    assert.equal(h.clock('thieving').alerted, true);
    h.advance(20_000);
    assert.equal(h.clock('thieving').phase, 'expired');
    assert.deepEqual(h.alerts, ['thieving:threshold']);
});

test('a clock paused before its threshold still alerts after resuming', () => {
    const h = harness([THIEVING]);
    h.runner.start('thieving');
    h.advance(100_000);
    h.runner.pause('thieving');
    h.advance(500_000);
    h.runner.start('thieving');
    h.advance(169_999);
    assert.deepEqual(h.alerts, []);
    h.advance(1);
    assert.deepEqual(h.alerts, ['thieving:threshold']);
});

test('a timer alerts once at its elapsed threshold and keeps counting', () => {
    const h = harness([STOPWATCH]);
    h.runner.start(STOPWATCH.id);
    h.advance(19_999);
    assert.deepEqual(h.alerts, []);
    h.advance(1);
    assert.deepEqual(h.alerts, [`${STOPWATCH.id}:threshold`]);
    h.advance(40_000);
    const clock = h.clock(STOPWATCH.id);
    assert.equal(clock.phase, 'running');
    assert.equal(clock.valueMs, 60_000);
    assert.equal(h.live().length, 0, 'an alerted timer has nothing left to wait for');
});

test('game input starts an idle AFK clock and restarts a running one', () => {
    const h = harness([AFK]);
    h.runner.input();
    assert.equal(h.clock('afk').phase, 'running');
    h.advance(50_000);
    h.runner.input();
    assert.equal(h.clock('afk').valueMs, 90_000);
    h.advance(74_999);
    assert.deepEqual(h.alerts, []);
    h.advance(1);
    assert.deepEqual(h.alerts, ['afk:threshold']);
});

test('game input restarts an expired AFK clock and clears its alert', () => {
    const h = harness([AFK]);
    h.runner.input();
    h.advance(90_000);
    assert.equal(h.clock('afk').phase, 'expired');
    h.runner.input();
    assert.equal(h.clock('afk').phase, 'running');
    assert.equal(h.clock('afk').alerted, false);
});

test('game input leaves a paused AFK clock and every non-AFK clock alone', () => {
    const h = harness([AFK, THIEVING]);
    h.runner.start('afk');
    h.runner.pause('afk');
    h.runner.input();
    assert.equal(h.clock('afk').phase, 'paused');
    assert.equal(h.clock('thieving').phase, 'idle');
    h.runner.start('thieving');
    h.advance(10_000);
    h.runner.input();
    assert.equal(h.clock('thieving').valueMs, 290_000);
});

test('a burst of game input pushes once a second, and a start pushes at once', () => {
    const h = harness([AFK]);
    h.runner.input();
    const afterStart = h.pushes();
    assert.equal(afterStart, 1, 'the idle clock starting is a phase change');
    h.advance(100);
    h.runner.input();
    h.advance(100);
    h.runner.input();
    assert.equal(h.pushes(), afterStart, 'restarts inside a second only move digits the shell can barely show');
    h.advance(INPUT_PUSH_EVERY_MS);
    h.runner.input();
    assert.equal(h.pushes(), afterStart + 1);
    assert.equal(h.clock('afk').valueMs, 90_000, 'the restart itself happened every time');
});

test('game input in a window with no AFK clock pushes nothing', () => {
    const h = harness([THIEVING]);
    h.runner.input();
    h.advance(2_000);
    h.runner.input();
    assert.equal(h.pushes(), 0);
});

test('when the game goes, AFK clocks go idle unless paused, and the rest keep running', () => {
    const pausedAfk: TimerDef = { ...AFK, id: 'custom-0000000a', name: 'Idle watch' };
    const h = harness([AFK, pausedAfk, THIEVING]);
    h.runner.input();
    h.runner.pause(pausedAfk.id);
    h.runner.start('thieving');
    h.advance(10_000);
    h.runner.gameGone();
    assert.equal(h.clock('afk').phase, 'idle');
    assert.equal(h.clock('afk').valueMs, 90_000);
    assert.equal(h.clock(pausedAfk.id).phase, 'paused');
    assert.equal(h.clock('thieving').phase, 'running');
    assert.equal(h.clock('thieving').valueMs, 290_000);
});

test('only one timer is ever pending, and it waits for the earliest event', () => {
    const h = harness([AFK, THIEVING, STOPWATCH]);
    h.runner.start('thieving');
    h.runner.start(STOPWATCH.id);
    h.runner.input();
    assert.equal(h.live().length, 1);
    assert.equal(h.live()[0]!.due - h.now(), 20_000, "the stopwatch's threshold comes first");
    h.advance(20_000);
    assert.equal(h.live()[0]!.due - h.now(), 55_000, "then AFK's");
    h.advance(300_000);
    assert.equal(h.maxPending(), 1);
    assert.deepEqual(h.alerts, [`${STOPWATCH.id}:threshold`, 'afk:threshold', 'thieving:threshold']);
});

test('waking from sleep past both threshold and zero alerts once and expires', () => {
    const h = harness([THIEVING]);
    h.runner.start('thieving');
    h.sleep(400_000);
    assert.deepEqual(h.alerts, ['thieving:threshold']);
    assert.equal(h.clock('thieving').phase, 'expired');
});

test('new definitions keep unchanged clocks, idle changed ones, drop removed ones and add new ones', () => {
    const h = harness([AFK, THIEVING]);
    h.runner.input();
    h.runner.start('thieving');
    h.advance(10_000);
    h.runner.setDefs([listed({ ...AFK }, true), listed(STOPWATCH), listed({ ...THIEVING, thresholdMs: 60_000 })]);
    assert.deepEqual(
        h.runner.view().map(c => c.def.id),
        ['afk', STOPWATCH.id, 'thieving']
    );
    assert.equal(h.clock('afk').phase, 'running');
    assert.equal(h.clock('afk').valueMs, 80_000);
    assert.equal(h.clock('afk').edited, true, 'a kept clock takes the new flags');
    assert.equal(h.clock('thieving').phase, 'idle');
    assert.equal(h.clock('thieving').def.thresholdMs, 60_000);
    assert.equal(h.clock(STOPWATCH.id).phase, 'idle');
    h.runner.setDefs([listed(AFK)]);
    assert.deepEqual(
        h.runner.view().map(c => c.def.id),
        ['afk']
    );
});

test('the view is a snapshot: its value is true at its `at`, and changing it changes nothing', () => {
    const h = harness([THIEVING]);
    h.runner.start('thieving');
    h.advance(1_234);
    const view = h.clock('thieving');
    assert.equal(view.at, h.now());
    assert.equal(view.valueMs, 298_766);
    view.def.name = 'mutated';
    assert.equal(h.clock('thieving').def.name, 'Thieving');
});

test('controls on an unknown id do nothing', () => {
    const h = harness([THIEVING]);
    h.runner.start('nope');
    h.runner.pause('nope');
    h.runner.reset('nope');
    assert.equal(h.clock('thieving').phase, 'idle');
    assert.equal(h.live().length, 0);
});

test('dispose cancels the pending timer and makes every later call a no-op', () => {
    const h = harness([THIEVING, AFK]);
    h.runner.start('thieving');
    h.runner.dispose();
    assert.equal(h.live().length, 0);
    const pushes = h.pushes();
    h.runner.start('afk');
    h.runner.input();
    h.runner.reset('thieving');
    h.runner.gameGone();
    h.runner.setDefs([listed(AFK)]);
    assert.equal(h.live().length, 0);
    assert.equal(h.pushes(), pushes);
});

test('a dispose from inside an alert leaves nothing scheduled', () => {
    let now = 1_000_000;
    const pending: Pending[] = [];
    const alerts: string[] = [];
    let pushes = 0;
    const live = (): Pending[] => pending.filter(p => !p.cancelled);
    const io: TimersIo = {
        now: () => now,
        setTimer: (fn, ms) => {
            const entry: Pending = { due: now + ms, fn, cancelled: false };
            pending.push(entry);
            return () => {
                entry.cancelled = true;
            };
        },
        alert: (def, at) => {
            alerts.push(`${def.id}:${at}`);
            if (at === 'threshold' && def.id === 'thieving') {
                runner.dispose();
            }
        },
        changed: () => {
            pushes++;
        }
    };
    const runner = new TimersRunner([listed(THIEVING)], io);
    runner.start('thieving');
    now = 1_300_000;
    const fn = live()[0]!.fn;
    live()[0]!.cancelled = true;
    fn();
    assert.equal(live().length, 0, 'no timer left scheduled after dispose in alert');
    assert.equal(pushes, 1, 'no changed() call after dispose in alert');
});
