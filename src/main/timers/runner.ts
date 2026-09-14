import { clockValueAt, type ClockPhase, type ClockView, type TimerDef } from '../../shared/timers.ts';
import type { ListedTimer } from './defs.ts';

/**
 * How often a run of game input may push the digits. Every mouse down and key
 * down restarts the AFK clocks, and a whole shell state per keystroke is a lot
 * to send for a restart the digits can barely show; between pushes they can
 * read up to this much low, which errs early, as the rest of AFK mode does.
 */
export const INPUT_PUSH_EVERY_MS = 1_000;

export interface TimersIo {
    now(): number;
    /** Runs `fn` once after `ms`; the returned function cancels it. */
    setTimer(fn: () => void, ms: number): () => void;
    alert(def: TimerDef, at: 'threshold' | 'zero'): void;
    /** Something the shell draws has changed. */
    changed(): void;
}

interface Clock {
    listed: ListedTimer;
    phase: ClockPhase;
    /** Remaining (countdown) or elapsed (timer), true at `at`. Frozen outside `running`. */
    valueMs: number;
    at: number;
    alerted: boolean;
}

function startValue(def: TimerDef): number {
    return def.kind === 'countdown' ? (def.durationMs ?? 0) : 0;
}

function idleClock(listed: ListedTimer, now: number): Clock {
    return { listed, phase: 'idle', valueMs: startValue(listed.def), at: now, alerted: false };
}

function runFromBeginning(clock: Clock, now: number): void {
    clock.phase = 'running';
    clock.valueMs = startValue(clock.listed.def);
    clock.at = now;
    clock.alerted = false;
}

function current(clock: Clock, now: number): number {
    return clockValueAt({ def: clock.listed.def, phase: clock.phase, valueMs: clock.valueMs, at: clock.at }, now);
}

function sameDef(a: TimerDef, b: TimerDef): boolean {
    return a.id === b.id && a.name === b.name && a.kind === b.kind && a.durationMs === b.durationMs && a.thresholdMs === b.thresholdMs && a.volume === b.volume && a.afk === b.afk;
}

function copyListed(listed: ListedTimer): ListedTimer {
    return { def: { ...listed.def }, builtIn: listed.builtIn, edited: listed.edited };
}

/**
 * One window's clocks.
 *
 * Nothing here ticks. The runner keeps at most one pending timer, set for the
 * earliest thing that can happen next — a threshold not yet alerted, or a
 * countdown reaching zero — and when it fires, every clock is judged against
 * `now()` rather than against how long the timer was meant to take. So a
 * countdown that crossed its threshold and reached zero with the lid shut
 * alerts once, and is expired. The timer itself does not count the time
 * asleep, though, so it can fire long after the wake; `settle()` is how main
 * judges the clocks at the wake instead.
 */
export class TimersRunner {
    private readonly io: TimersIo;
    private clocks: Clock[];
    private cancel: (() => void) | null = null;
    private disposed = false;
    private lastInputPush = Number.NEGATIVE_INFINITY;

    constructor(listed: readonly ListedTimer[], io: TimersIo) {
        this.io = io;
        const now = io.now();
        this.clocks = listed.map(l => idleClock(copyListed(l), now));
    }

    /** Every clock as the shell draws it, valued at this moment. */
    view(): ClockView[] {
        const now = this.io.now();
        return this.clocks.map(clock => ({
            def: { ...clock.listed.def },
            builtIn: clock.listed.builtIn,
            edited: clock.listed.edited,
            phase: clock.phase,
            valueMs: current(clock, now),
            at: now,
            alerted: clock.alerted
        }));
    }

    start(id: string): void {
        this.act(now => {
            const clock = this.find(id);
            if (!clock) return false;
            if (clock.phase === 'idle' || clock.phase === 'expired') {
                runFromBeginning(clock, now);
                return true;
            }
            if (clock.phase === 'paused') {
                clock.phase = 'running';
                clock.at = now;
                return true;
            }
            return false;
        });
    }

    pause(id: string): void {
        this.act(now => {
            const clock = this.find(id);
            if (!clock || clock.phase !== 'running') return false;
            clock.valueMs = current(clock, now);
            clock.at = now;
            clock.phase = 'paused';
            return true;
        });
    }

    /** Back to the beginning, and running: it is the press for "the target moved". */
    reset(id: string): void {
        this.act(now => {
            const clock = this.find(id);
            if (!clock) return false;
            runFromBeginning(clock, now);
            return true;
        });
    }

    /** A mouse down or key down in the game: every AFK clock the player has not paused runs from the beginning. */
    input(): void {
        if (this.disposed) return;
        const now = this.io.now();
        const due = this.process(now);
        let restarted = false;
        let notable = false;
        for (const clock of this.clocks) {
            if (!clock.listed.def.afk || clock.phase === 'paused') continue;
            if (clock.phase !== 'running' || clock.alerted) notable = true;
            runFromBeginning(clock, now);
            restarted = true;
        }
        if (!restarted && !due) return;
        this.schedule(now);
        if (!this.disposed && (due || notable || now - this.lastInputPush >= INPUT_PUSH_EVERY_MS)) {
            this.lastInputPush = now;
            this.io.changed();
        }
    }

    /**
     * For a wake from sleep, when the pending timeout is late because timers do
     * not count sleep: settles whatever is due at `now()`, reschedules, and
     * pushes only if something changed.
     */
    settle(): void {
        this.act(() => false);
    }

    /** The game view was destroyed or began loading a page: that login's idle timer is gone, so its AFK clocks wait for the next input. */
    gameGone(): void {
        this.act(now => {
            let changed = false;
            for (const clock of this.clocks) {
                if (!clock.listed.def.afk || clock.phase === 'paused' || clock.phase === 'idle') continue;
                Object.assign(clock, idleClock(clock.listed, now));
                changed = true;
            }
            return changed;
        });
    }

    /** The definitions changed somewhere in the app. A clock whose definition moved starts again from idle rather than alerting for the old one. */
    setDefs(listed: readonly ListedTimer[]): void {
        this.act(now => {
            const before = new Map(this.clocks.map(clock => [clock.listed.def.id, clock]));
            this.clocks = listed.map(l => {
                const next = copyListed(l);
                const kept = before.get(next.def.id);
                if (kept && sameDef(kept.listed.def, next.def)) {
                    kept.listed = next;
                    return kept;
                }
                return idleClock(next, now);
            });
            return true;
        });
    }

    dispose(): void {
        this.disposed = true;
        this.cancel?.();
        this.cancel = null;
    }

    private find(id: string): Clock | undefined {
        return this.clocks.find(clock => clock.listed.def.id === id);
    }

    /** Settles anything already due, applies one change, reschedules, and pushes if anything the shell draws moved. */
    private act(change: (now: number) => boolean): void {
        if (this.disposed) return;
        const now = this.io.now();
        const due = this.process(now);
        const changed = change(now);
        this.schedule(now);
        if (!this.disposed && (due || changed)) this.io.changed();
    }

    /** Alerts and expires whatever is due at `now`. Answers whether anything did. */
    private process(now: number): boolean {
        let changed = false;
        for (const clock of this.clocks) {
            if (clock.phase !== 'running') continue;
            const def = clock.listed.def;
            const value = current(clock, now);
            if (def.kind === 'timer') {
                if (!clock.alerted && value >= def.thresholdMs) {
                    clock.alerted = true;
                    this.io.alert({ ...def }, 'threshold');
                    changed = true;
                }
                continue;
            }
            if (!clock.alerted && def.thresholdMs > 0 && value <= def.thresholdMs) {
                clock.alerted = true;
                this.io.alert({ ...def }, 'threshold');
                changed = true;
            }
            if (value <= 0) {
                clock.phase = 'expired';
                clock.valueMs = 0;
                clock.at = now;
                changed = true;
                if (!clock.alerted) {
                    clock.alerted = true;
                    this.io.alert({ ...def }, 'zero');
                }
            }
        }
        return changed;
    }

    private schedule(now: number): void {
        if (this.disposed) return;
        this.cancel?.();
        this.cancel = null;
        let next = Number.POSITIVE_INFINITY;
        for (const clock of this.clocks) {
            if (clock.phase !== 'running') continue;
            const def = clock.listed.def;
            const value = current(clock, now);
            if (def.kind === 'timer') {
                if (!clock.alerted) next = Math.min(next, def.thresholdMs - value);
                continue;
            }
            if (!clock.alerted && def.thresholdMs > 0) next = Math.min(next, value - def.thresholdMs);
            next = Math.min(next, value);
        }
        if (next === Number.POSITIVE_INFINITY) return;
        this.cancel = this.io.setTimer(() => this.fire(), Math.max(0, next));
    }

    private fire(): void {
        this.cancel = null;
        if (this.disposed) return;
        const now = this.io.now();
        const changed = this.process(now);
        this.schedule(now);
        if (!this.disposed && changed) this.io.changed();
    }
}
