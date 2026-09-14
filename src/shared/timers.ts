/**
 * Countdowns and timers: what a clock is, when its definition is valid, how its
 * digits read, and the form that edits one. Shared by main, which runs the
 * clocks and refuses a bad definition at the IPC boundary, and the shell,
 * which draws them and checks the same rules before sending.
 *
 * Pure and tested, because the renderer is not.
 */

export type TimerKind = 'countdown' | 'timer';

export interface TimerDef {
    /** 'afk' and 'thieving' for the built-ins; 'custom-<8 hex>' for the player's own. */
    id: string;
    name: string;
    kind: TimerKind;
    /** Countdowns only; null for a timer. */
    durationMs: number | null;
    /** Countdown: alert when this much is left. Timer: alert when this much has elapsed. */
    thresholdMs: number;
    /** 0–1. Zero means banner only. */
    volume: number;
    /** A mouse down or key down in the game view restarts this clock. */
    afk: boolean;
}

/** What a player may change about a built-in. Its kind is not among them. */
export type TimerEdit = Partial<Pick<TimerDef, 'name' | 'durationMs' | 'thresholdMs' | 'volume' | 'afk'>>;

/** The player's half, as `state.json` keeps it: their own clocks, and their changes to the kit's. */
export interface TimersState {
    custom: TimerDef[];
    edits: Record<string, TimerEdit>;
}

/** What the form sends. A null id is a new clock, which main names. */
export type TimerSaveInput = Omit<TimerDef, 'id'> & { id: string | null };

export type ClockPhase = 'idle' | 'running' | 'paused' | 'expired';

export interface ClockView {
    def: TimerDef;
    builtIn: boolean;
    /** A built-in with an edit, so the form can offer Restore default. */
    edited: boolean;
    phase: ClockPhase;
    /** Remaining (countdown) or elapsed (timer) ms, true at `at`. */
    valueMs: number;
    /** The `Date.now()` at which `valueMs` was true. */
    at: number;
    alerted: boolean;
}

export interface TimersView {
    clocks: ClockView[];
    /** True at the most custom clocks, so the add button can say why it is off. */
    customsFull: boolean;
}

/** Main's request to a window's shell: play the alert, this loud. */
export interface TimerAlert {
    volume: number;
}

export const TIMER_NAME_MAX = 40;
export const TIMER_MIN_MS = 1_000;
export const TIMER_MAX_MS = 86_400_000;
export const CUSTOM_TIMERS_MAX = 20;
export const CUSTOM_ID_PREFIX = 'custom-';

export interface TimerProblem {
    field: 'name' | 'kind' | 'durationMs' | 'thresholdMs' | 'volume';
    message: string;
}

const isFiniteNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function nameProblem(name: string): TimerProblem | null {
    const trimmed = name.trim();
    if (trimmed === '') return { field: 'name', message: 'Enter a name.' };
    if (trimmed.length > TIMER_NAME_MAX) return { field: 'name', message: `Keep the name to ${TIMER_NAME_MAX} characters.` };
    return null;
}

/** Why a definition cannot be used, as the form shows it; null when it can. The id is not judged here. */
export function timerProblem(def: Omit<TimerDef, 'id'>): TimerProblem | null {
    const named = nameProblem(typeof def.name === 'string' ? def.name : '');
    if (named) return named;
    if (def.kind === 'countdown') {
        if (!isFiniteNumber(def.durationMs) || def.durationMs < TIMER_MIN_MS || def.durationMs > TIMER_MAX_MS) {
            return { field: 'durationMs', message: 'A countdown runs for 1 second to 24 hours.' };
        }
        if (!isFiniteNumber(def.thresholdMs) || def.thresholdMs < 0 || def.thresholdMs >= def.durationMs) {
            return { field: 'thresholdMs', message: 'The threshold must be shorter than the duration.' };
        }
    } else if (def.kind === 'timer') {
        if (def.durationMs !== null) return { field: 'durationMs', message: 'A timer has no duration.' };
        if (!isFiniteNumber(def.thresholdMs) || def.thresholdMs < TIMER_MIN_MS || def.thresholdMs > TIMER_MAX_MS) {
            return { field: 'thresholdMs', message: "A timer's threshold is 1 second to 24 hours." };
        }
    } else {
        return { field: 'kind', message: 'Choose countdown or timer.' };
    }
    if (!isFiniteNumber(def.volume) || def.volume < 0 || def.volume > 1) return { field: 'volume', message: 'Volume is 0 to 100%.' };
    return null;
}

/** A definition with every field of the right type and nothing `timerProblem` objects to. */
export function isTimerDef(x: unknown): x is TimerDef {
    if (typeof x !== 'object' || x === null) return false;
    const { id, name, kind, durationMs, thresholdMs, volume, afk } = x as Record<string, unknown>;
    if (typeof id !== 'string' || id === '' || typeof name !== 'string') return false;
    if (kind !== 'countdown' && kind !== 'timer') return false;
    if (durationMs !== null && typeof durationMs !== 'number') return false;
    if (typeof thresholdMs !== 'number' || typeof volume !== 'number' || typeof afk !== 'boolean') return false;
    return timerProblem({ name, kind, durationMs, thresholdMs, volume, afk }) === null;
}

export function isCustomId(id: string): boolean {
    return id.startsWith(CUSTOM_ID_PREFIX) && id.length > CUSTOM_ID_PREFIX.length;
}

/**
 * The digits. A countdown rounds its seconds up and a timer rounds down, so a
 * countdown shows 0:00 only once it has actually reached zero and a timer shows
 * 0:20 only once twenty seconds have actually passed.
 */
export function formatClock(ms: number, kind: TimerKind): string {
    const safe = Number.isFinite(ms) ? Math.max(0, ms) : 0;
    const total = kind === 'countdown' ? Math.ceil(safe / 1000) : Math.floor(safe / 1000);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = String(total % 60).padStart(2, '0');
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/** Reads `90`, `1:30` or `1:00:00` as milliseconds; null for anything else. Range is `timerProblem`'s to judge. */
export function parseDuration(text: string): number | null {
    const t = text.trim();
    let m = /^(\d{1,5})$/.exec(t);
    if (m) return Number(m[1]) * 1000;
    m = /^(\d{1,4}):([0-5]\d)$/.exec(t);
    if (m) return (Number(m[1]) * 60 + Number(m[2])) * 1000;
    m = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/.exec(t);
    if (m) return (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000;
    return null;
}

/** What the banner says. Under a minute a threshold reads as seconds, the way people say it. */
export function alertTitle(def: TimerDef, at: 'threshold' | 'zero'): string {
    if (def.kind === 'timer') return `${def.name}: ${formatClock(def.thresholdMs, 'timer')} elapsed`;
    if (at === 'zero') return `${def.name}: time's up`;
    const left = def.thresholdMs < 60_000 ? `${Math.ceil(def.thresholdMs / 1000)}s` : formatClock(def.thresholdMs, 'countdown');
    return `${def.name}: ${left} left`;
}

/** What a clock reads at `now`, from a snapshot. Main's runner and the shell's digits both read clocks this way. */
export function clockValueAt(clock: Pick<ClockView, 'def' | 'phase' | 'valueMs' | 'at'>, now: number): number {
    if (clock.phase !== 'running') return clock.valueMs;
    const passed = Math.max(0, now - clock.at);
    return clock.def.kind === 'countdown' ? Math.max(0, clock.valueMs - passed) : clock.valueMs + passed;
}

/** The colour of a clock's digits: alarm once expired, or running and alerted; gold while running; dim otherwise. */
export function clockTone(clock: Pick<ClockView, 'phase' | 'alerted'>): 'alarm' | 'gold' | 'dim' {
    if (clock.phase === 'expired' || (clock.phase === 'running' && clock.alerted)) return 'alarm';
    return clock.phase === 'running' ? 'gold' : 'dim';
}

/** The edit form as typed: the two spans are text until they are read. */
export interface TimerDraft {
    id: string | null;
    name: string;
    kind: TimerKind;
    duration: string;
    threshold: string;
    volume: number;
    afk: boolean;
}

export type DraftReading = { ok: true; input: TimerSaveInput } | { ok: false; problem: TimerProblem };

/** A new clock's form: a countdown of 5:00 with a 0:30 threshold at 80%, AFK mode off. */
export function blankDraft(): TimerDraft {
    return { id: null, name: '', kind: 'countdown', duration: '5:00', threshold: '0:30', volume: 0.8, afk: false };
}

/** An existing clock's form. A timer's duration box still holds 5:00, for if the kind is switched. */
export function draftOf(def: TimerDef): TimerDraft {
    return {
        id: def.id,
        name: def.name,
        kind: def.kind,
        duration: def.durationMs === null ? '5:00' : formatClock(def.durationMs, 'timer'),
        threshold: formatClock(def.thresholdMs, 'timer'),
        volume: def.volume,
        afk: def.afk
    };
}

/** The form as something main would accept, or the first field in the form's order that stops it. */
export function readDraft(draft: TimerDraft): DraftReading {
    const named = nameProblem(draft.name);
    if (named) return { ok: false, problem: named };
    const durationMs = draft.kind === 'countdown' ? parseDuration(draft.duration) : null;
    if (draft.kind === 'countdown' && durationMs === null) return { ok: false, problem: { field: 'durationMs', message: 'Write it as 90, 1:30 or 1:00:00.' } };
    const thresholdMs = parseDuration(draft.threshold);
    if (thresholdMs === null) return { ok: false, problem: { field: 'thresholdMs', message: 'Write it as 15, 0:15 or 1:00:00.' } };
    const input: TimerSaveInput = { id: draft.id, name: draft.name, kind: draft.kind, durationMs, thresholdMs, volume: draft.volume, afk: draft.afk };
    const problem = timerProblem(input);
    return problem ? { ok: false, problem } : { ok: true, input };
}
