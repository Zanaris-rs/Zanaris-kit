import { CUSTOM_ID_PREFIX, CUSTOM_TIMERS_MAX, isCustomId, isTimerDef, timerProblem, type TimerDef, type TimerEdit, type TimerSaveInput, type TimersState } from '../../shared/timers.ts';

/**
 * Which clocks a window has, and the rules for changing them.
 *
 * Two halves meet here. A server's built-ins are the kit's, carried in its
 * catalog entry; the player's own clocks and their changes to the built-ins
 * are app-wide, in `state.json`. Nothing in this file touches either store:
 * it takes a state and hands back a new one, so every rule is tested without
 * a file or a window.
 */

/**
 * The pair a server added through the launcher starts with. The built-in
 * entries in `catalog.ts` write theirs out separately, so that one server's
 * can change without the others'; this is only for servers the kit does not
 * know.
 */
export function newServerTimers(): TimerDef[] {
    return [
        { id: 'afk', name: 'AFK', kind: 'countdown', durationMs: 90_000, thresholdMs: 15_000, volume: 0.8, afk: true },
        { id: 'thieving', name: 'Thieving', kind: 'countdown', durationMs: 300_000, thresholdMs: 30_000, volume: 0.8, afk: false }
    ];
}

export function emptyTimersState(): TimersState {
    return { custom: [], edits: {} };
}

/** Field by field, so a stored definition never shares an object with the state it came from. */
function copyDef(def: TimerDef): TimerDef {
    return { id: def.id, name: def.name, kind: def.kind, durationMs: def.durationMs, thresholdMs: def.thresholdMs, volume: def.volume, afk: def.afk };
}

function copyEdits(edits: Readonly<Record<string, TimerEdit>>): Record<string, TimerEdit> {
    return Object.fromEntries(Object.entries(edits).map(([id, edit]) => [id, { ...edit }]));
}

/** An edit's fields of the right type. A `kind` is never read: a built-in's kind is not the player's to change. */
function readEdit(x: unknown): TimerEdit | null {
    if (typeof x !== 'object' || x === null) return null;
    const e = x as Record<string, unknown>;
    const edit: TimerEdit = {};
    if (typeof e.name === 'string') edit.name = e.name;
    if (typeof e.volume === 'number' && Number.isFinite(e.volume)) edit.volume = e.volume;
    if (typeof e.afk === 'boolean') edit.afk = e.afk;
    if (typeof e.durationMs === 'number' && Number.isFinite(e.durationMs)) edit.durationMs = e.durationMs;
    if (typeof e.thresholdMs === 'number' && Number.isFinite(e.thresholdMs)) edit.thresholdMs = e.thresholdMs;
    return Object.keys(edit).length > 0 ? edit : null;
}

/**
 * `state.json`'s timers block, read one entry at a time like `readChat`: a bad
 * entry costs only itself. A custom clock must be a valid definition under a
 * custom id not already taken; past 20, the rest are dropped. An edit keeps
 * only its well-typed fields, and is dropped when none are left.
 */
export function readTimers(x: unknown): TimersState {
    const state = emptyTimersState();
    if (typeof x !== 'object' || x === null) return state;
    const block = x as Record<string, unknown>;
    if (Array.isArray(block.custom)) {
        const taken = new Set<string>();
        for (const entry of block.custom) {
            if (state.custom.length >= CUSTOM_TIMERS_MAX) break;
            if (!isTimerDef(entry) || !isCustomId(entry.id) || taken.has(entry.id)) continue;
            taken.add(entry.id);
            state.custom.push(copyDef(entry));
        }
    }
    if (typeof block.edits === 'object' && block.edits !== null && !Array.isArray(block.edits)) {
        for (const [id, value] of Object.entries(block.edits)) {
            if (id === '' || id.startsWith(CUSTOM_ID_PREFIX)) continue;
            const edit = readEdit(value);
            if (edit) state.edits[id] = edit;
        }
    }
    return state;
}

/**
 * The fields an edit carries, in the order a field-by-field apply takes them.
 * Duration before threshold, so raising both together still works when some
 * other field of the edit is refused.
 */
const EDIT_ORDER = ['name', 'volume', 'afk', 'durationMs', 'thresholdMs'] as const;

/**
 * A built-in with the player's changes on top, in two steps. First the whole
 * edit at once: when that is a valid definition, it is the answer, which is
 * how a duration and a threshold lowered together both apply. Only when it is
 * not is the edit applied field by field, in `EDIT_ORDER`, skipping any field
 * that would leave the definition invalid rather than breaking the clock: that
 * is what happens when the kit shortens a built-in under a threshold the
 * player had raised, and the player keeps a working clock and every other
 * change.
 */
export function applyEdit(builtIn: TimerDef, edit: TimerEdit | undefined): TimerDef {
    let def = copyDef(builtIn);
    if (!edit) return def;
    let whole = copyDef(builtIn);
    for (const field of EDIT_ORDER) {
        const value = edit[field];
        if (value !== undefined) whole = { ...whole, [field]: value } as TimerDef;
    }
    if (timerProblem(whole) === null) return whole;
    for (const field of EDIT_ORDER) {
        const value = edit[field];
        if (value === undefined) continue;
        const candidate = { ...def, [field]: value } as TimerDef;
        if (timerProblem(candidate) === null) def = candidate;
    }
    return def;
}

export interface ListedTimer {
    def: TimerDef;
    builtIn: boolean;
    /** A built-in the player has changed, which the form can restore. */
    edited: boolean;
}

/** One window's clocks: its server's built-ins in catalog order with the edits applied, then the player's own. */
export function timersFor(serverTimers: readonly TimerDef[], state: TimersState): ListedTimer[] {
    return [
        ...serverTimers.map(builtIn => ({ def: applyEdit(builtIn, state.edits[builtIn.id]), builtIn: true, edited: state.edits[builtIn.id] !== undefined })),
        ...state.custom.map(def => ({ def: copyDef(def), builtIn: false, edited: false }))
    ];
}

export type TimersChange = { ok: true; state: TimersState } | { ok: false; error: string };

/**
 * Saves what the form sent. A null id adds a clock; a custom id replaces that
 * clock in place; a built-in id stores, as its edit, only the fields that
 * differ from **this window's server's** definition of it — so saving a
 * built-in unchanged is the same as restoring it, and an edit never freezes a
 * value the kit might later change.
 */
export function saveTimer(state: TimersState, serverTimers: readonly TimerDef[], input: TimerSaveInput, newId: () => string): TimersChange {
    const problem = timerProblem(input);
    if (problem) return { ok: false, error: problem.message };
    const fields = { name: input.name.trim(), kind: input.kind, durationMs: input.durationMs, thresholdMs: input.thresholdMs, volume: input.volume, afk: input.afk };

    if (input.id === null) {
        if (state.custom.length >= CUSTOM_TIMERS_MAX) return { ok: false, error: `You already have ${CUSTOM_TIMERS_MAX} of your own.` };
        return { ok: true, state: { custom: [...state.custom.map(copyDef), { id: newId(), ...fields }], edits: copyEdits(state.edits) } };
    }

    if (input.id.startsWith(CUSTOM_ID_PREFIX)) {
        const index = state.custom.findIndex(def => def.id === input.id);
        if (index < 0) return { ok: false, error: 'That clock no longer exists.' };
        const custom = state.custom.map(copyDef);
        custom[index] = { id: input.id, ...fields };
        return { ok: true, state: { custom, edits: copyEdits(state.edits) } };
    }

    const builtIn = serverTimers.find(def => def.id === input.id);
    if (!builtIn) return { ok: false, error: 'This server has no built-in clock by that name.' };
    if (fields.kind !== builtIn.kind) return { ok: false, error: "A built-in clock's kind can't be changed." };
    const edit: TimerEdit = {};
    if (fields.name !== builtIn.name) edit.name = fields.name;
    if (fields.volume !== builtIn.volume) edit.volume = fields.volume;
    if (fields.afk !== builtIn.afk) edit.afk = fields.afk;
    if (fields.durationMs !== null && fields.durationMs !== builtIn.durationMs) edit.durationMs = fields.durationMs;
    if (fields.thresholdMs !== builtIn.thresholdMs) edit.thresholdMs = fields.thresholdMs;
    const edits = copyEdits(state.edits);
    if (Object.keys(edit).length > 0) edits[input.id] = edit;
    else delete edits[input.id];
    return { ok: true, state: { custom: state.custom.map(copyDef), edits } };
}

export function deleteTimer(state: TimersState, id: string): TimersChange {
    if (!id.startsWith(CUSTOM_ID_PREFIX)) return { ok: false, error: "Built-in clocks can't be deleted." };
    if (!state.custom.some(def => def.id === id)) return { ok: false, error: 'That clock no longer exists.' };
    return { ok: true, state: { custom: state.custom.filter(def => def.id !== id).map(copyDef), edits: copyEdits(state.edits) } };
}

/** Clears a built-in's edit. Clearing one that has none is not an error: the clock is already at its default. */
export function restoreTimer(state: TimersState, id: string): TimersChange {
    if (id === '' || id.startsWith(CUSTOM_ID_PREFIX)) return { ok: false, error: 'Only a built-in clock has a default to restore.' };
    const edits = copyEdits(state.edits);
    delete edits[id];
    return { ok: true, state: { custom: state.custom.map(copyDef), edits } };
}

/** What arrived over IPC, if it has every field of the right type. Whether the values are sensible is `saveTimer`'s to say. */
export function readSaveInput(x: unknown): TimerSaveInput | null {
    if (typeof x !== 'object' || x === null) return null;
    const { id, name, kind, durationMs, thresholdMs, volume, afk } = x as Record<string, unknown>;
    if (id !== null && (typeof id !== 'string' || id === '')) return null;
    if (typeof name !== 'string' || (kind !== 'countdown' && kind !== 'timer')) return null;
    if (durationMs !== null && typeof durationMs !== 'number') return null;
    if (typeof thresholdMs !== 'number' || typeof volume !== 'number' || typeof afk !== 'boolean') return null;
    return { id, name, kind, durationMs, thresholdMs, volume, afk };
}

/** A custom id not already taken. `randomHex` is injected so a test can say what it draws. */
export function newCustomId(randomHex: () => string, taken: ReadonlySet<string>): string {
    let id: string;
    do {
        id = `${CUSTOM_ID_PREFIX}${randomHex()}`;
    } while (taken.has(id));
    return id;
}
