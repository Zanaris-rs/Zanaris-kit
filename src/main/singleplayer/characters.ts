import { NAME_INPUT_MAX, nameProblem, toDisplayName, toSafeName } from '../../shared/names.ts';
import { PROBLEM_TEXT, type CharacterInfo, type CharacterOutcome, type FileProblem, type ImportPick, type SaveSummary } from '../../shared/singleplayer.ts';
import type { Confirm, Confirmation } from './confirm.ts';
import { readSave, SaveError } from './save.ts';

/** What the character store needs of the file system. */
export interface CharacterFs {
    exists(path: string): boolean;
    readBytes(path: string): Uint8Array;
    writeBytes(path: string, bytes: Uint8Array): void;
    rename(from: string, to: string): void;
    copyFile(from: string, to: string): void;
    mkdir(path: string): void;
    /** Recursive, and quiet when the path is absent. */
    rm(path: string): void;
    /** The names in a directory; empty when it is absent. */
    list(path: string): string[];
    /** Null when the path is absent. */
    stat(path: string): { size: number; modified: number; isFile: boolean } | null;
    /** Moves a file to the system trash. Rejects where there is none. */
    trash(path: string): Promise<void>;
}

export interface CharactersDeps {
    fs: CharacterFs;
    join(...parts: string[]): string;
    /** <home>/data/players/main */
    dir: string;
    /** A new unguessable token, for a picked file waiting on its name. */
    token(): string;
}

/** What a change needs from whoever asked for it: whether the world is up, and how to ask the player. */
export interface ChangeContext {
    running: boolean;
    confirm: Confirm;
}

export const SAVE_EXTENSION = '.sav';
/** A real save is a few kilobytes. A picked file past this is not one, and is not worth reading. */
export const SAVE_BYTES_MAX = 1024 * 1024;
/** Picks kept waiting for a name; the oldest goes first. */
const PENDING_MAX = 8;
/** A new save is written here first, then renamed over. Not `.sav`, so the list never shows one. */
const PART_EXTENSION = '.part';

type Read = { ok: true; bytes: Uint8Array; summary: SaveSummary } | { ok: false; problem: FileProblem };
type Named = { ok: true; name: string } | { ok: false; message: string };

const CANCELLED: CharacterOutcome = { kind: 'cancelled' };
const done = (name: string): CharacterOutcome => ({ kind: 'done', name });
const refused = (message: string): CharacterOutcome => ({ kind: 'refused', message });
const GONE = 'That character is not in the saves folder any more.';
const PLAYING = "You're playing right now.";
const replaced = (who: string): string => `The ${who} you have now goes to the trash.`;

/** A typed name as a character's name, or why it cannot be one. */
function named(typed: string): Named {
    const problem = nameProblem(typed);
    return problem === null ? { ok: true, name: toSafeName(typed) } : { ok: false, message: problem };
}

function sentences(...parts: (string | null)[]): string {
    return parts.filter((part): part is string => part !== null).join(' ');
}

/** The name an imported file suggests: its own, less `.sav`, as the engine would file it. Empty when that is no name. */
export function suggestName(path: string): string {
    const file = path.split(/[\\/]/).pop() ?? '';
    const stem = (file.toLowerCase().endsWith(SAVE_EXTENSION) ? file.slice(0, -SAVE_EXTENSION.length) : file).slice(0, NAME_INPUT_MAX);
    return nameProblem(stem) === null ? toSafeName(stem) : '';
}

export function importQuestion(name: string, replacing: boolean, running: boolean): Confirmation {
    const who = toDisplayName(name);
    return {
        message: replacing ? `Replace ${who} with the imported save?` : `Import this save as ${who}?`,
        detail: sentences(replacing ? replaced(who) : null, running ? `${PLAYING} If you are logged in as ${who}, logging out will write over the import.` : null),
        button: replacing ? 'Replace' : 'Import',
        destructive: replacing
    };
}

export function renameQuestion(from: string, to: string, replacing: boolean, running: boolean): Confirmation {
    const was = toDisplayName(from);
    const becomes = toDisplayName(to);
    return {
        message: replacing ? `Rename ${was} to ${becomes}, replacing the ${becomes} you have?` : `Rename ${was} to ${becomes}?`,
        detail: sentences(replacing ? replaced(becomes) : null, running ? `${PLAYING} If you are logged in as ${was}, logging out will save ${was} again under the old name.` : null),
        button: 'Rename',
        destructive: replacing
    };
}

export function duplicateQuestion(from: string, to: string, replacing: boolean, running: boolean): Confirmation {
    const source = toDisplayName(from);
    const copy = toDisplayName(to);
    return {
        message: replacing ? `Copy ${source} over ${copy}?` : `Copy ${source} as ${copy}?`,
        detail: sentences(replacing ? replaced(copy) : null, running ? `${PLAYING} The copy is ${source} as last saved, and if you are logged in as ${copy}, logging out will write over it.` : null),
        button: 'Copy',
        destructive: replacing
    };
}

export function deleteQuestion(name: string, running: boolean): Confirmation {
    const who = toDisplayName(name);
    return {
        message: `Move ${who} to the trash?`,
        detail: sentences('You can put the save back from there.', running ? `${PLAYING} If you are logged in as ${who}, logging out will save ${who} again.` : null),
        button: 'Move to Trash',
        destructive: true
    };
}

/**
 * The single-player characters: one file each in the saves folder, named for
 * the character. Every path built here goes through `path`, which takes only a
 * name `toSafeName` leaves as it is, so nothing typed or picked can reach a
 * file outside the folder, or one the engine would never look for.
 *
 * Nothing here is destroyed. A character that another is about to replace, or
 * that is deleted, goes to the system trash, and a change that cannot move it
 * there changes nothing.
 *
 * Changes are allowed while the world runs, and ask first: a player logged in
 * as one of these writes it again on logout, and the kit cannot tell who is
 * logged in.
 */
export class Characters {
    private readonly deps: CharactersDeps;
    /** Picked files waiting for a name, by token, oldest first. */
    private readonly pending = new Map<string, string>();

    constructor(deps: CharactersDeps) {
        this.deps = deps;
    }

    /** The only way a path is built here. Throws for anything `toSafeName` would change. */
    path(name: string): string {
        if (toSafeName(name) !== name) throw new Error(`not a safe character name: ${JSON.stringify(name)}`);
        return this.deps.join(this.deps.dir, `${name}${SAVE_EXTENSION}`);
    }

    /**
     * Every character in the folder, newest first. A `.sav` the engine would
     * refuse is listed with its problem. A file whose name the engine could
     * never log in as is left out, since nothing here may touch it.
     */
    list(): CharacterInfo[] {
        const found: CharacterInfo[] = [];
        for (const entry of this.deps.fs.list(this.deps.dir)) {
            if (!entry.endsWith(SAVE_EXTENSION)) continue;
            const name = entry.slice(0, -SAVE_EXTENSION.length);
            if (toSafeName(name) !== name) continue;
            const stat = this.deps.fs.stat(this.path(name));
            if (!stat?.isFile) continue;
            const read = this.read(this.path(name));
            found.push({
                name,
                displayName: toDisplayName(name),
                modified: stat.modified,
                summary: read.ok ? read.summary : null,
                problem: read.ok ? null : read.problem
            });
        }
        return found.sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name));
    }

    /** True when `name` is a character in the folder. */
    has(name: string): boolean {
        return this.existing(name).ok;
    }

    /**
     * The first half of an import: reads what the open dialog picked and, when
     * it is a save, keeps its path under a token. The second half names the
     * token and never a path, so it can only import what the player picked.
     */
    pick(path: string): ImportPick {
        const read = this.read(path);
        if (!read.ok) return read;
        const token = this.deps.token();
        this.pending.set(token, path);
        for (const old of this.pending.keys()) {
            if (this.pending.size <= PENDING_MAX) break;
            this.pending.delete(old);
        }
        return { ok: true, token, suggestedName: suggestName(path), summary: read.summary };
    }

    /** The second half: files the picked save under a typed name. The file is read again, since it is the player's and may have changed. */
    async importAs(token: string, typed: string, ctx: ChangeContext): Promise<CharacterOutcome> {
        const source = this.pending.get(token);
        if (source === undefined) return refused('That file is no longer waiting to be imported. Choose it again.');
        const target = named(typed);
        if (!target.ok) return refused(target.message);
        const read = this.read(source);
        if (!read.ok) {
            this.pending.delete(token);
            return refused(PROBLEM_TEXT[read.problem]);
        }
        const replacing = this.deps.fs.exists(this.path(target.name));
        if ((replacing || ctx.running) && !(await ctx.confirm(importQuestion(target.name, replacing, ctx.running)))) return CANCELLED;
        const outcome = await this.write(target.name, read.bytes);
        if (outcome.kind === 'done') this.pending.delete(token);
        return outcome;
    }

    async rename(from: string, typed: string, ctx: ChangeContext): Promise<CharacterOutcome> {
        const source = this.existing(from);
        if (!source.ok) return refused(source.message);
        const target = named(typed);
        if (!target.ok) return refused(target.message);
        if (target.name === source.name) return refused(`${toDisplayName(source.name)} already has that name.`);
        const replacing = this.deps.fs.exists(this.path(target.name));
        if ((replacing || ctx.running) && !(await ctx.confirm(renameQuestion(source.name, target.name, replacing, ctx.running)))) return CANCELLED;
        if (!(await this.trash(target.name))) return refused(`Couldn't move the old ${toDisplayName(target.name)} to the trash, so nothing was renamed.`);
        try {
            this.deps.fs.rename(this.path(source.name), this.path(target.name));
        } catch {
            return refused("The save couldn't be renamed.");
        }
        return done(target.name);
    }

    async duplicate(from: string, typed: string, ctx: ChangeContext): Promise<CharacterOutcome> {
        const source = this.existing(from);
        if (!source.ok) return refused(source.message);
        const target = named(typed);
        if (!target.ok) return refused(target.message);
        if (target.name === source.name) return refused('A copy needs a name of its own.');
        const replacing = this.deps.fs.exists(this.path(target.name));
        if ((replacing || ctx.running) && !(await ctx.confirm(duplicateQuestion(source.name, target.name, replacing, ctx.running)))) return CANCELLED;
        let bytes: Uint8Array;
        try {
            bytes = this.deps.fs.readBytes(this.path(source.name));
        } catch {
            return refused("The save couldn't be read.");
        }
        return this.write(target.name, bytes);
    }

    /** Moves a character to the system trash, always asking first. */
    async remove(name: string, ctx: ChangeContext): Promise<CharacterOutcome> {
        const source = this.existing(name);
        if (!source.ok) return refused(source.message);
        if (!(await ctx.confirm(deleteQuestion(source.name, ctx.running)))) return CANCELLED;
        if (!(await this.trash(source.name))) return refused(`Couldn't move ${toDisplayName(source.name)} to the trash, so it was not deleted.`);
        return done(source.name);
    }

    /** Copies a character's save to where the player chose. It only reads the folder, so it never asks. */
    exportTo(name: string, destination: string): CharacterOutcome {
        const source = this.existing(name);
        if (!source.ok) return refused(source.message);
        try {
            this.deps.fs.copyFile(this.path(source.name), destination);
        } catch {
            return refused("The save couldn't be copied there.");
        }
        return done(source.name);
    }

    // ── internals ────────────────────────────────────────────────────────

    private existing(name: string): Named {
        if (toSafeName(name) !== name || !this.deps.fs.exists(this.path(name))) return { ok: false, message: GONE };
        return { ok: true, name };
    }

    private read(path: string): Read {
        const stat = this.deps.fs.stat(path);
        if (!stat?.isFile) return { ok: false, problem: 'unreadable' };
        if (stat.size > SAVE_BYTES_MAX) return { ok: false, problem: 'not-a-save' };
        let bytes: Uint8Array;
        try {
            bytes = this.deps.fs.readBytes(path);
        } catch {
            return { ok: false, problem: 'unreadable' };
        }
        try {
            return { ok: true, bytes, summary: readSave(bytes) };
        } catch (err) {
            return { ok: false, problem: err instanceof SaveError ? err.kind : 'corrupt' };
        }
    }

    /** True once nothing is filed under `name`: it never was, or it is in the trash now. */
    private async trash(name: string): Promise<boolean> {
        const path = this.path(name);
        if (!this.deps.fs.exists(path)) return true;
        try {
            await this.deps.fs.trash(path);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Files `bytes` under `name` through a `.part` file and a rename, so a
     * crash leaves the old save or the new one and never half of one.
     * Anything already under the name goes to the trash first.
     */
    private async write(name: string, bytes: Uint8Array): Promise<CharacterOutcome> {
        const { fs, dir } = this.deps;
        const path = this.path(name);
        const part = `${path}${PART_EXTENSION}`;
        try {
            fs.mkdir(dir);
            fs.writeBytes(part, bytes);
        } catch {
            fs.rm(part);
            return refused("The save couldn't be written.");
        }
        if (!(await this.trash(name))) {
            fs.rm(part);
            return refused(`Couldn't move the old ${toDisplayName(name)} to the trash, so nothing was replaced.`);
        }
        try {
            fs.rename(part, path);
        } catch {
            fs.rm(part);
            return refused("The save couldn't be written.");
        }
        return done(name);
    }
}
