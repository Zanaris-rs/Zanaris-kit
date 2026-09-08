import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RememberedWorld } from '../shared/worlds.ts';
import type { ChatSettings } from '../shared/chat.ts';
import { DEFAULT_CHAT } from '../shared/chat.ts';
import { DOCK_HEIGHT_MIN } from '../shared/layout.ts';
import { isChannel } from './chat/protocol.ts';

interface StateFile {
    version: 1;
    worlds: Record<string, RememberedWorld>;
    warnOnSwitch: boolean;
    chat: ChatSettings;
    singlePlayer: { cheats: boolean };
    hiscores: Record<string, string>;
}

// Well past base37's 12-character limit, so no real player name is ever
// affected — this only stops a hand-edited file from handing an arbitrarily
// long string down the wire when a later task builds a lookup URL from it.
const HISCORES_NAME_MAX = 30;

// RFC 2812 caps a channel name at 50 characters, so nothing a real IRC server
// would accept is ever rejected here. ROOMS_MAX is a sanity rail against a
// hand-edited file, not a real ceiling on how many rooms someone could join.
const ROOM_NAME_MAX = 50;
const ROOMS_MAX = 20;

/**
 * DEFAULT_CHAT, cloned deep enough that rooms is never shared: every other
 * field is a primitive, so `{ ...DEFAULT_CHAT }` was a safe copy until rooms
 * arrived. Without this, every fresh AppState and every reset on a failed
 * load would start out holding DEFAULT_CHAT's own array by reference.
 */
function defaultChat(): ChatSettings {
    return { ...DEFAULT_CHAT, rooms: [...DEFAULT_CHAT.rooms] };
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
    if (c.nick === null || (typeof c.nick === 'string' && c.nick !== '')) chat.nick = c.nick;
    if (typeof c.server === 'string' && c.server !== '') chat.server = c.server;
    if (typeof c.port === 'number' && Number.isInteger(c.port) && c.port >= 1 && c.port <= 65535) chat.port = c.port;
    if (c.dock === 'bottom' || c.dock === 'side') chat.dock = c.dock;
    // 2000 is a sanity rail against a hand-edited file, not the real ceiling: the
    // true maximum depends on the display's work area and is enforced at drag
    // time, where a screen is actually known. Nothing here has one to consult.
    if (typeof c.dockHeight === 'number' && Number.isInteger(c.dockHeight)) chat.dockHeight = Math.min(Math.max(c.dockHeight, DOCK_HEIGHT_MIN), 2000);
    if (Array.isArray(c.rooms)) {
        const rooms: string[] = [];
        for (const room of c.rooms) {
            if (rooms.length >= ROOMS_MAX) break;
            if (typeof room === 'string' && room !== '' && room.length <= ROOM_NAME_MAX && isChannel(room)) rooms.push(room);
        }
        chat.rooms = rooms;
    }
    return chat;
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
 * file worth keeping. Loading never fails and never complains; a file that
 * cannot be read is kept aside and the state starts empty, since nothing here
 * is worth interrupting a launch for.
 */
export class AppState {
    readonly file: string;
    private worlds = new Map<string, RememberedWorld>();
    // An opt-out: the warning shows until the user has ticked "don't ask again".
    private warn = true;
    private chatSettings: ChatSettings = defaultChat();
    // Developer commands in the single-player world: off until asked for.
    private cheats = false;
    // Last name looked up per server, so the Hiscores box reopens prefilled rather than empty.
    private hiscoresNames = new Map<string, string>();

    constructor(file: string) {
        this.file = file;
    }

    load(): void {
        this.worlds = new Map();
        this.warn = true;
        this.chatSettings = defaultChat();
        this.cheats = false;
        this.hiscoresNames = new Map();
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
            const sp = parsed?.singlePlayer;
            if (typeof sp === 'object' && sp !== null && typeof (sp as { cheats?: unknown }).cheats === 'boolean') this.cheats = (sp as { cheats: boolean }).cheats;
            this.hiscoresNames = new Map(Object.entries(readHiscores(parsed?.hiscores)));
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

    /** Where chat connects, and as whom. Falls back to the SwiftIRC defaults field by field. */
    chat(): ChatSettings {
        // rooms is cloned too, unlike the rest of the spread: it is the one array
        // in an otherwise-primitive settings object, and returning it by reference
        // would let a caller mutate this instance's own list without going
        // through setChat/stageChat at all.
        return { ...this.chatSettings, rooms: [...this.chatSettings.rooms] };
    }

    setChat(patch: Partial<ChatSettings>): void {
        this.stageChat(patch);
        this.save();
    }

    /**
     * The in-memory half of setChat, for a field that moves far faster than a
     * file should be rewritten: the dock's height arrives once an animation
     * frame for as long as a drag lasts, and save() below rewrites the whole
     * profile synchronously. Whoever stages a value owns writing it — index.ts
     * debounces one save() per drag rather than sixty a second.
     */
    stageChat(patch: Partial<ChatSettings>): void {
        this.chatSettings = { ...this.chatSettings, ...patch };
        // Cloned for the same reason chat() clones on the way out: rooms is an
        // array, and holding the caller's own array by reference would let it
        // mutate this instance's settings from outside setChat/stageChat entirely.
        if (patch.rooms !== undefined) this.chatSettings.rooms = [...patch.rooms];
    }

    /** Whether the single-player world grants developer commands. Off until asked for. */
    singlePlayerCheats(): boolean {
        return this.cheats;
    }

    setSinglePlayerCheats(on: boolean): void {
        this.cheats = on;
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

    save(): void {
        mkdirSync(dirname(this.file), { recursive: true });
        const data: StateFile = {
            version: 1,
            worlds: Object.fromEntries(this.worlds),
            warnOnSwitch: this.warn,
            chat: this.chatSettings,
            singlePlayer: { cheats: this.cheats },
            hiscores: Object.fromEntries(this.hiscoresNames)
        };
        writeFileSync(this.file, `${JSON.stringify(data, null, 2)}\n`);
    }
}
