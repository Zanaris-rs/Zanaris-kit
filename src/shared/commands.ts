/**
 * The developer commands a single-player world takes with cheats on, as the
 * Commands section lists them. There are two kinds, and they are typed
 * differently in the game's chat box:
 *
 * - The content's debug procs, `[debugproc,name]` scripts, typed `::~name`.
 *   The engine runs one only when the cheat starts with its debugproc
 *   character, `~` by default, and has no fallback without it
 *   (ClientCheatHandler.ts). The kit ships none of the scripts that declare
 *   them, so scripts/stage-engine.mjs lists them into COMMANDS.json.
 * - The engine's own commands, typed `::name`, written out by hand below.
 *
 * Debug procs need staff level 4 and a world that is not production; the
 * engine commands below need staff level 2 or 3. The kit gives level 4 with
 * cheats on and 0 with them off, and at 0 the world ignores every one of them
 * without a word.
 */

export interface CommandParam {
    name: string;
    /** The script type of a debug proc's parameter (int, stat, obj…), or what an engine command's argument is. */
    type: string;
    optional: boolean;
}

export interface CommandRef {
    kind: 'debugproc' | 'engine';
    name: string;
    params: CommandParam[];
    /** A debug proc's comment from its script, or an engine command's description. */
    note: string | null;
    /** The content folder a debug proc was declared in: cheats, debug, engine or quests. Null for an engine command. */
    group: string | null;
}

export const DEBUGPROC_PREFIX = '::~';

/** The format of COMMANDS.json that `readCommandsFile` reads. */
export const COMMANDS_FILE_VERSION = 1;

const param = (name: string, type: string, optional = false): CommandParam => ({ name, type, optional });
const engine = (name: string, params: CommandParam[], note: string): CommandRef => ({ kind: 'engine', name, params, note, group: null });

/**
 * The engine's own commands that can do something in single player: every
 * branch of ClientCheatHandler.ts open to staff level 4, less the ones gated
 * on `node.production`, which single player never turns on, and two that can
 * never act here. `::rebuild` needs build.liveReload, which the kit turns off,
 * and `::random` sets a flag the AFK_EVENT command ignores for staff while
 * node.debug is off, which the kit never turns on.
 */
export const ENGINE_COMMANDS: readonly CommandRef[] = [
    engine('tele', [param('level,mx,mz,lx,lz', 'coord')], 'Teleports you. One argument, with commas and no spaces; ::getcoord prints where you are in this form.'),
    engine('getcoord', [], 'Prints where you stand, as level,mx,mz,lx,lz.'),
    engine('give', [param('item', 'obj'), param('count', 'int', true)], 'Puts an item in your inventory, by its debug name, such as coins.'),
    engine('givemany', [param('item', 'obj')], 'Puts 1,000 of an item in your inventory.'),
    engine('givecrap', [], 'Fills your inventory with 28 random items.'),
    engine('setstat', [param('skill', 'stat'), param('level', 'int')], "Sets a skill to a level, by the skill's name: attack, cooking, runecraft and so on."),
    engine('advancestat', [param('skill', 'stat'), param('level', 'int')], 'Resets a skill, then gives it the xp for a level, with the level-up messages.'),
    engine('minme', [], 'Sets every skill to 1, and Hitpoints to 10.'),
    engine('setvar', [param('var', 'name'), param('value', 'int')], 'Sets one of your varps or varbits, by name.'),
    engine('getvar', [param('var', 'name')], 'Prints one of your varps or varbits, by name.'),
    engine('npcadd', [param('npc', 'npc')], 'Spawns an NPC on your tile for five minutes.'),
    engine('locadd', [param('loc', 'loc')], 'Spawns a loc on your tile for five minutes.'),
    engine('openmain', [param('interface', 'interface')], 'Opens an interface as a modal on the game screen.'),
    engine('openoverlay', [param('interface', 'interface')], 'Opens an interface as an overlay on the game screen.'),
    engine('closeoverlay', [], 'Closes that overlay.'),
    engine('speed', [param('ms', 'int')], 'Sets how long a world tick lasts, 20 ms or more; the game runs at 600.'),
    engine('fly', [], 'Switches between walking through anything and walking normally.'),
    engine('naive', [], 'Switches between naive pathing, which heads straight for a target, and the normal kind.'),
    engine('reload', [], "Reloads the world's scripts and configs from its packed cache."),
    engine('serverdrop', [], 'Drops your connection, to test reconnecting.'),
    engine('snapshot', [], "Writes a heap snapshot of the world into its folder. It is large.")
];

export type CommandFilter = 'cheats' | 'engine' | 'scripts' | 'all';

export const COMMAND_FILTERS: readonly { id: CommandFilter; label: string }[] = [
    { id: 'cheats', label: 'Cheats' },
    { id: 'engine', label: 'Engine' },
    { id: 'scripts', label: 'Test scripts' },
    { id: 'all', label: 'All' }
];

/**
 * Which list a command is in. Cheats is the content's cheats folder, the
 * procs a player actually wants; Engine is the `::` commands; Test scripts is
 * every other debug proc, most there to exercise one piece of content.
 */
export function inFilter(ref: CommandRef, filter: CommandFilter): boolean {
    switch (filter) {
        case 'all':
            return true;
        case 'engine':
            return ref.kind === 'engine';
        case 'cheats':
            return ref.kind === 'debugproc' && ref.group === 'cheats';
        case 'scripts':
            return ref.kind === 'debugproc' && ref.group !== 'cheats';
    }
}

/** What goes in the chat box before any arguments. */
export function typedForm(ref: CommandRef): string {
    return `${ref.kind === 'debugproc' ? DEBUGPROC_PREFIX : '::'}${ref.name}`;
}

/** The typed form with its arguments: `<name>` for one the command needs, `[name]` for one it can go without. */
export function usage(ref: CommandRef): string {
    return [typedForm(ref), ...ref.params.map(p => (p.optional ? `[${p.name}]` : `<${p.name}>`))].join(' ');
}

/** True when the search is in the command's name or note. A leading `::` or `::~` is ignored, so a whole typed command still finds itself. */
export function matchesQuery(ref: CommandRef, query: string): boolean {
    const q = query.trim().toLowerCase().replace(/^::~?/, '');
    if (q === '') return true;
    return ref.name.includes(q) || (ref.note?.toLowerCase().includes(q) ?? false);
}

/** COMMANDS.json, as scripts/stage-engine.mjs writes it. Null for anything else; an entry it could not have written is dropped. */
export function readCommandsFile(text: string): CommandRef[] | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;
    const file = parsed as Record<string, unknown>;
    if (file.version !== COMMANDS_FILE_VERSION || !Array.isArray(file.debugprocs)) return null;
    const refs: CommandRef[] = [];
    for (const entry of file.debugprocs) {
        const ref = readProc(entry);
        if (ref) refs.push(ref);
    }
    return refs;
}

function readProc(x: unknown): CommandRef | null {
    if (typeof x !== 'object' || x === null) return null;
    const p = x as Record<string, unknown>;
    if (typeof p.name !== 'string' || !/^[a-z0-9_]+$/.test(p.name)) return null;
    if (typeof p.group !== 'string') return null;
    if (p.note !== null && typeof p.note !== 'string') return null;
    if (!Array.isArray(p.params)) return null;
    const params: CommandParam[] = [];
    for (const q of p.params) {
        if (typeof q !== 'object' || q === null) return null;
        const r = q as Record<string, unknown>;
        if (typeof r.name !== 'string' || typeof r.type !== 'string') return null;
        params.push({ name: r.name, type: r.type, optional: false });
    }
    return { kind: 'debugproc', name: p.name, params, note: p.note, group: p.group };
}
