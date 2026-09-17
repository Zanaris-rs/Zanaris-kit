import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RememberedWorld } from '../shared/worlds.ts';
import type { ChatSettings } from '../shared/chat.ts';
import { DEFAULT_CHAT } from '../shared/chat.ts';
import { AUTO_JOIN_MAX, channelProblem, isNick } from '../shared/chatSettings.ts';
import type { SinglePlayerSettings } from '../shared/singleplayer.ts';
import type { TimersState } from '../shared/timers.ts';
import { emptyTimersState, readTimers } from './timers/defs.ts';
import { readSinglePlayerSettings } from './singleplayer/settings.ts';

interface StateFile {
    version: 1;
    worlds: Record<string, RememberedWorld>;
    warnOnSwitch: boolean;
    /** `nickserv` is the NickServ password sealed by the OS store (`chat/secret.ts`), and absent when there is none. */
    chat: ChatSettings & { nickserv?: string };
    singlePlayer: SinglePlayerSettings;
    hiscores: Record<string, string>;
    alwaysOnTop: boolean;
    timers: TimersState;
}

// Well past base37's 12-character limit, so no real player name is ever
// affected — this only stops a hand-edited file from handing an arbitrarily
// long string down the wire when a later task builds a lookup URL from it.
const HISCORES_NAME_MAX = 30;

// A sealed password is base64 of a few hundred bytes at most; anything far past
// that is not one, and is not worth handing to the OS store to fail on.
const SEALED_MAX = 4096;

/**
 * DEFAULT_CHAT, cloned deep enough that autoJoin is never shared: every other
 * field is a primitive, so `{ ...DEFAULT_CHAT }` alone would leave every fresh
 * AppState, and every reset on a failed load, holding DEFAULT_CHAT's own array
 * by reference.
 */
function defaultChat(): ChatSettings {
    return { ...DEFAULT_CHAT, autoJoin: [...DEFAULT_CHAT.autoJoin] };
}

function isRemembered(x: unknown): x is RememberedWorld {
    if (typeof x !== 'object' || x === null) return false;
    const r = x as Record<string, unknown>;
    if (typeof r.world !== 'number' || !Number.isInteger(r.world) || r.world <= 0) return false;
    if (r.detail !== 'low' && r.detail !== 'high') return false;
    if (typeof r.url !== 'string') return false;
    try {
        const u = new URL(r.url);
        return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
        return false;
    }
}

/**
 * Reads a stored chat block one field at a time, so a single bad value costs
 * only its own field. Nothing in here is worth rejecting the whole file for:
 * a nick that came back as a number leaves the user unnamed, not logged out of
 * their remembered worlds.
 */
function readChat(x: unknown): ChatSettings {
    const chat = defaultChat();
    if (typeof x !== 'object' || x === null) return chat;
    const c = x as Record<string, unknown>;
    // Judged as the Settings form judges it: this nick goes out as NICK, and a
    // hand-edited one holding a line break would be a second command.
    if (c.nick === null || (typeof c.nick === 'string' && isNick(c.nick))) chat.nick = c.nick;
    if (typeof c.server === 'string' && c.server !== '') chat.server = c.server;
    if (typeof c.port === 'number' && Number.isInteger(c.port) && c.port >= 1 && c.port <= 65535) chat.port = c.port;
    // An array, even an empty one, is the user's list: they may have cleared it on purpose.
    // Only a missing or non-array value falls back to the defaults.
    if (Array.isArray(c.autoJoin)) {
        const autoJoin: string[] = [];
        for (const channel of c.autoJoin) {
            if (autoJoin.length >= AUTO_JOIN_MAX) break;
            if (typeof channel === 'string' && channelProblem(channel) === null) autoJoin.push(channel);
        }
        chat.autoJoin = autoJoin;
    }
    if (typeof c.autoConnect === 'boolean') chat.autoConnect = c.autoConnect;
    return chat;
}

/** The sealed NickServ password out of a stored chat block, or null. Opening it is `chat/secret.ts`'s, at launch. */
function readSealed(x: unknown): string | null {
    if (typeof x !== 'object' || x === null) return null;
    const sealed = (x as Record<string, unknown>).nickserv;
    return typeof sealed === 'string' && sealed !== '' && sealed.length <= SEALED_MAX ? sealed : null;
}

/**
 * Reads a stored hiscores block one entry at a time, for the same reason as
 * readChat above: a hand-edited file with one bad name must not cost the
 * user every other remembered name, let alone their worlds or chat settings.
 * An entry whose key or value is not a non-empty string, or whose value is
 * longer than a real name could ever be, is dropped rather than repaired —
 * there is no sane way to truncate a name into a different, still-plausible
 * one, so the prefill is simply lost for that one server.
 */
function readHiscores(x: unknown): Record<string, string> {
    const hiscores: Record<string, string> = {};
    if (typeof x !== 'object' || x === null) return hiscores;
    for (const [id, value] of Object.entries(x as Record<string, unknown>)) {
        if (id === '') continue;
        if (typeof value !== 'string' || value === '' || value.length > HISCORES_NAME_MAX) continue;
        hiscores[id] = value;
    }
    return hiscores;
}

/**
 * Small per-user state. Mostly choices the user made in passing rather than
 * settings they configured — the last world and detail chosen per server, and
 * whether they still want warning before a switch reloads the game — and, now,
 * the one thing here that really is configuration: the chat nick and the IRC
 * server to reach it on, which live alongside the rest for want of a second
 * file worth keeping. It also holds the player's own countdowns and timers,
 * and their changes to a server's built-in ones, since both are app-wide
 * rather than a single server's. Loading never fails and never complains; a
 * file that cannot be read is kept aside and the state starts empty, since
 * nothing here is worth interrupting a launch for.
 */
export class AppState {
    readonly file: string;
    private worlds = new Map<string, RememberedWorld>();
    // An opt-out: the warning shows until the user has ticked "don't ask again".
    private warn = true;
    private chatSettings: ChatSettings = defaultChat();
    // Sealed, never the password itself: see `chat/secret.ts`.
    private nickservSealed: string | null = null;
    // The single-player world's settings: cheats off, xp as the game gives it and members on, until asked otherwise.
    private singlePlayer: SinglePlayerSettings = readSinglePlayerSettings(undefined);
    // Last name looked up per server, so the Hiscores box reopens prefilled rather than empty.
    private hiscoresNames = new Map<string, string>();
    // Off until asked for: a window that floats over everything else is not
    // something to hand someone who never asked for it.
    private onTop = false;
    // The player's own countdowns and timers, and their changes to the kit's.
    // App-wide: the same list in every window, whatever its server.
    private timersState: TimersState = emptyTimersState();

    constructor(file: string) {
        this.file = file;
    }

    load(): void {
        this.worlds = new Map();
        this.warn = true;
        this.chatSettings = defaultChat();
        this.nickservSealed = null;
        this.singlePlayer = readSinglePlayerSettings(undefined);
        this.hiscoresNames = new Map();
        this.onTop = false;
        this.timersState = emptyTimersState();
        if (!existsSync(this.file)) return;
        try {
            const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<StateFile> | null;
            const worlds = parsed?.worlds;
            if (typeof worlds !== 'object' || worlds === null) throw new Error('not a state file');
            for (const [id, value] of Object.entries(worlds)) {
                if (isRemembered(value)) this.worlds.set(id, { ...value });
            }
            // Absent in files written before the preference existed, so anything that is not a boolean keeps the default.
            if (typeof parsed?.warnOnSwitch === 'boolean') this.warn = parsed.warnOnSwitch;
            this.chatSettings = readChat(parsed?.chat);
            this.nickservSealed = readSealed(parsed?.chat);
            this.singlePlayer = readSinglePlayerSettings(parsed?.singlePlayer);
            this.hiscoresNames = new Map(Object.entries(readHiscores(parsed?.hiscores)));
            // Absent in files written before the preference existed, so anything that is not a boolean keeps the default.
            if (typeof parsed?.alwaysOnTop === 'boolean') this.onTop = parsed.alwaysOnTop;
            this.timersState = readTimers(parsed?.timers);
        } catch {
            renameSync(this.file, `${this.file}.broken-${Date.now()}`);
        }
    }

    world(serverId: string): RememberedWorld | null {
        const found = this.worlds.get(serverId);
        return found ? { ...found } : null;
    }

    setWorld(serverId: string, remembered: RememberedWorld): void {
        this.worlds.set(serverId, { ...remembered });
        this.save();
    }

    /** Whether to confirm before a world or detail switch reloads the game. */
    warnOnSwitch(): boolean {
        return this.warn;
    }

    setWarnOnSwitch(value: boolean): void {
        this.warn = value;
        this.save();
    }

    /** Where chat connects, as whom, and what it joins. Falls back to the SwiftIRC defaults field by field. */
    chat(): ChatSettings {
        // autoJoin is cloned too, unlike the rest of the spread: it is the one
        // array in an otherwise-primitive settings object, and returning it by
        // reference would let a caller mutate this instance's own list without
        // going through setChat/stageChat at all.
        return { ...this.chatSettings, autoJoin: [...this.chatSettings.autoJoin] };
    }

    /** The NickServ password as sealed by the OS store, or null when none is kept. */
    sealedNickserv(): string | null {
        return this.nickservSealed;
    }

    /** Keeps a sealed password, or forgets it with null. Only ever a sealed one: `chat/secret.ts` decides whether sealing is safe. */
    setNickservSealed(sealed: string | null): void {
        this.nickservSealed = sealed === '' ? null : sealed;
        this.save();
    }

    setChat(patch: Partial<ChatSettings>): void {
        this.stageChat(patch);
        this.save();
    }

    /**
     * The in-memory half of setChat. It was split out for the chat dock's
     * height, which arrived once an animation frame during a drag and had its
     * save() debounced in index.ts; the dock and that debounce are both gone,
     * so setChat is the only caller left and every staged value is written at
     * once.
     */
    stageChat(patch: Partial<ChatSettings>): void {
        this.chatSettings = { ...this.chatSettings, ...patch };
        // Cloned for the same reason chat() clones on the way out: autoJoin is an
        // array, and holding the caller's own array by reference would let it
        // mutate this instance's settings from outside setChat/stageChat entirely.
        if (patch.autoJoin !== undefined) this.chatSettings.autoJoin = [...patch.autoJoin];
    }

    /** The single-player world's settings. A copy: changes go through setSinglePlayerSettings. */
    singlePlayerSettings(): SinglePlayerSettings {
        return { ...this.singlePlayer };
    }

    /**
     * Read back through `readSinglePlayerSettings` on the way in, as a file
     * would be, so nothing stored here can be something a later load would drop.
     */
    setSinglePlayerSettings(patch: Partial<SinglePlayerSettings>): void {
        this.singlePlayer = readSinglePlayerSettings({ ...this.singlePlayer, ...patch });
        this.save();
    }

    /** The name last looked up on this server, to prefill the box. Null when nothing has been. */
    hiscoresName(serverId: string): string | null {
        return this.hiscoresNames.get(serverId) ?? null;
    }

    /**
     * Written once per lookup, unlike the chat dock height that stageChat
     * exists for — there is no per-frame volume here to spare a rewrite
     * for, so this saves immediately like setWorld does.
     */
    setHiscoresName(serverId: string, name: string): void {
        this.hiscoresNames.set(serverId, name);
        this.save();
    }

    /**
     * Whether a window should float above other apps.
     *
     * Per window in the doing — the menu item pins whichever window has focus,
     * because four windows all claiming the top is four windows covering the
     * thing each was pinned above — but one number here, which is the last
     * choice made anywhere. That is what a window opened afterwards starts
     * with, and what the next launch starts with, so it is set once rather than
     * per window per session.
     */
    alwaysOnTop(): boolean {
        return this.onTop;
    }

    setAlwaysOnTop(on: boolean): void {
        this.onTop = on;
        this.save();
    }

    /** The player's clocks and edits. A copy: changes go through setTimers. */
    timers(): TimersState {
        return structuredClone(this.timersState);
    }

    /**
     * Read back through `readTimers` on the way in, as a file would be, so
     * nothing stored here can be something a later load would drop.
     */
    setTimers(state: TimersState): void {
        this.timersState = readTimers(structuredClone(state));
        this.save();
    }

    save(): void {
        mkdirSync(dirname(this.file), { recursive: true });
        const data: StateFile = {
            version: 1,
            worlds: Object.fromEntries(this.worlds),
            warnOnSwitch: this.warn,
            chat: this.nickservSealed === null ? this.chatSettings : { ...this.chatSettings, nickserv: this.nickservSealed },
            singlePlayer: this.singlePlayer,
            hiscores: Object.fromEntries(this.hiscoresNames),
            alwaysOnTop: this.onTop,
            timers: this.timersState
        };
        writeFileSync(this.file, `${JSON.stringify(data, null, 2)}\n`);
    }
}
