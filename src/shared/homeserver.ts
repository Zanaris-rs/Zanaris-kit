/** Home server, as the shell draws it. */

/**
 * - missing: a window wants the world, and the selected build is not downloaded.
 * - downloading: the same, while that build is on its way down.
 */
export type HomeServerStatus = 'stopped' | 'missing' | 'downloading' | 'preparing' | 'starting' | 'ready' | 'stopping' | 'failed';

/**
 * True while a world may be running or on its way up or down: every status
 * but stopped, failed, and the two that wait for a build. A change that costs
 * a restart, or that a logout could write over, asks first while this holds.
 */
export function worldRunning(status: HomeServerStatus): boolean {
    return status !== 'stopped' && status !== 'failed' && status !== 'missing' && status !== 'downloading';
}

/** The XP multipliers the World section offers. The engine multiplies the xp content gives by `node.xpRate` (Player.addXp). */
export const XP_RATES = [1, 2, 5, 10] as const;
export type XpRate = (typeof XP_RATES)[number];

export function isXpRate(value: unknown): value is XpRate {
    return XP_RATES.some(rate => rate === value);
}

/** What the player chooses about their world. Each one is written into world.json, so a change takes a restart. */
export interface HomeServerSettings {
    /** node.localStaffLevel: 4 on, 0 off. */
    cheats: boolean;
    /** node.xpRate. */
    xpRate: XpRate;
    /** node.members. Off makes the world a free one. */
    members: boolean;
}

export const DEFAULT_HOME_SERVER_SETTINGS: Readonly<HomeServerSettings> = Object.freeze({ cheats: false, xpRate: 1, members: true });

/**
 * Where a line's build stands on this computer.
 * - absent: not downloaded.
 * - downloading: being downloaded and checked now.
 * - installed: on disk, and the build this kit pins.
 * - outdated: on disk, but not the build this kit pins; it does not run until updated.
 * - unavailable: this kit pins no build for the line, so there is nothing to download.
 */
export type BuildState = 'absent' | 'downloading' | 'installed' | 'outdated' | 'unavailable';

/** One build line, as the Builds section and the starting page show it. */
export interface BuildLine {
    id: string;
    name: string;
    revision: number;
    /** Something to read before choosing the line. */
    note: string | null;
    /** The engine and content commits the line pins. */
    engine: string;
    content: string;
    /** The download's size in bytes; null when there is nothing to download. */
    size: number | null;
    state: BuildState;
    /** 0 to 1 while downloading. */
    progress: number | null;
    /** Why the last download failed, until the next one starts. */
    error: string | null;
}

/** What the build the world runs is, from its VERSION.json. */
export interface HomeServerVersion {
    /** The line it was staged from; null in a stage from before builds had recipes. */
    id: string | null;
    name: string | null;
    /** The release tag naming both commits and the patch set; null likewise. */
    tag: string | null;
    engine: string;
    content: string;
    revision: number;
    built: string;
}

export interface HomeServerView {
    status: HomeServerStatus;
    /** The web port while starting or ready. */
    port: number | null;
    /** The game URL while ready. */
    url: string | null;
    /** Why it failed, while failed; why the last download failed, while missing. */
    reason: string | null;
    /** The last lines the world printed. */
    logTail: string[];
    version: HomeServerVersion | null;
    /** What the player chose for the world; see HomeServerSettings. */
    settings: HomeServerSettings;
    /** The saves folder, newest first, as last read. A character being played shows its last save. */
    characters: CharacterInfo[];
    /** The id of the line the world runs. */
    selected: string;
    /** That line's revision: world.json's, and the world folder the characters above live in. */
    revision: number;
    /** Every line, and where its build stands on this computer. */
    builds: BuildLine[];
}

/** What the kit reads from the head of a save. */
export interface SaveSummary {
    /** The save format, 0 for a new character's empty file. */
    version: number;
    combatLevel: number;
    /** The skills tab's Total Lvl. */
    totalLevel: number;
    /** Game ticks logged in, 600 ms each. */
    playtimeTicks: number;
}

/** Which of the engine's checks a file fails: not a save at all, a newer format, or a checksum that does not match. */
export type SaveProblem = 'not-a-save' | 'too-new' | 'corrupt';

/** A save problem, or a file the kit could not read at all. */
export type FileProblem = SaveProblem | 'unreadable';

/** What the Characters section says about a file it cannot use, as a sentence. */
export const PROBLEM_TEXT: Readonly<Record<FileProblem, string>> = {
    'not-a-save': "That file isn't a character save.",
    'too-new': 'That save comes from a newer game than this kit runs.',
    corrupt: 'That save is damaged or cut short.',
    unreadable: "That file couldn't be read."
};

/** The same, short enough for a row of the list. */
export const PROBLEM_LABEL: Readonly<Record<FileProblem, string>> = {
    'not-a-save': 'Not a save',
    'too-new': 'From a newer game',
    corrupt: 'Damaged',
    unreadable: "Can't be read"
};

/** One file in the saves folder. */
export interface CharacterInfo {
    /** The file's name less `.sav`, which is the name to log in with. Always a safe name. */
    name: string;
    /** The name as the game writes it. */
    displayName: string;
    /** When the file was last written, in ms since the epoch. */
    modified: number;
    /** Null when `problem` says why the file cannot be read as a save. */
    summary: SaveSummary | null;
    problem: FileProblem | null;
}

/** The first half of an import: the picked file, read, and a token to name it by. */
export type ImportPick = { ok: true; token: string; suggestedName: string; summary: SaveSummary } | { ok: false; problem: FileProblem };

/** How a change to a character ended. */
export type CharacterOutcome = { kind: 'done'; name: string } | { kind: 'cancelled' } | { kind: 'refused'; message: string };

/** What a character's menu can ask for. Renaming and copying as want a name, which the shell asks for; the rest go to main as they are. */
export type CharacterAction = { kind: 'rename' } | { kind: 'duplicate' } | { kind: 'copy-to'; revision: number } | { kind: 'export' } | { kind: 'delete' };

export type CharacterMenuItem = { kind: 'item'; label: string; action: CharacterAction; enabled: boolean } | { kind: 'separator' };

/**
 * A character's menu, in order. A damaged save can still be exported or
 * deleted; main refuses to rename or copy one, which would only spread it, so
 * those are greyed rather than left out, which says the save is the reason.
 * Copying to another revision is one item for each other revision a listed
 * line runs, and none where there is no other.
 */
export function characterMenu(character: Pick<CharacterInfo, 'summary'>, otherRevisions: readonly number[]): CharacterMenuItem[] {
    const usable = character.summary !== null;
    const item = (label: string, action: CharacterAction, enabled = true): CharacterMenuItem => ({ kind: 'item', label, action, enabled });
    return [
        item('Rename…', { kind: 'rename' }, usable),
        item('Copy as…', { kind: 'duplicate' }, usable),
        ...otherRevisions.map(revision => item(`Copy to rev ${revision}`, { kind: 'copy-to', revision }, usable)),
        item('Export…', { kind: 'export' }),
        { kind: 'separator' },
        item('Delete', { kind: 'delete' })
    ];
}

export type HomeServerSection = 'world' | 'characters' | 'commands' | 'builds' | 'friends';

/** The Home server tool's sections, in the order its tabs and its narrow menu list them. */
export const HOME_SERVER_SECTIONS: readonly { id: HomeServerSection; label: string }[] = [
    { id: 'world', label: 'World' },
    { id: 'characters', label: 'Characters' },
    { id: 'commands', label: 'Commands' },
    { id: 'builds', label: 'Builds' },
    { id: 'friends', label: 'Friends' }
];

/** The sections a window's tool offers: Friends only where main sends a share. */
export function sectionsOffered(shared: boolean): { id: HomeServerSection; label: string }[] {
    return HOME_SERVER_SECTIONS.filter(section => section.id !== 'friends' || shared);
}

export function isSection(value: unknown): value is HomeServerSection {
    return HOME_SERVER_SECTIONS.some(section => section.id === value);
}

/**
 * A build line as the tool's header names it: its name, with its revision
 * after it where the name does not already say it — "Lost City 274" rather
 * than "Lost City 274 · rev 274".
 */
export function lineTitle(line: Pick<BuildLine, 'name' | 'revision'>): string {
    return new RegExp(`(^|\\D)${line.revision}(\\D|$)`).test(line.name) ? line.name : `${line.name} · rev ${line.revision}`;
}

/** Play time as the list shows it. The engine counts it in ticks of 600 ms. */
export function formatPlaytime(ticks: number): string {
    const minutes = Math.floor((ticks * 600) / 60_000);
    if (minutes < 1) return 'under a minute';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
    return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
