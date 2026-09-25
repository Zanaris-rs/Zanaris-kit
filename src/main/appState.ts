import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RememberedWorld } from '../shared/worlds.ts';
import type { ChatSettings } from '../shared/chat.ts';
import { DEFAULT_CHAT } from '../shared/chat.ts';
import { AUTO_JOIN_MAX, IGNORE_MAX, channelProblem, isNick } from '../shared/chatSettings.ts';
import type { YourWorldSettings } from '../shared/yourworld.ts';
import type { TimersState } from '../shared/timers.ts';
import { emptyTimersState, readTimers } from './timers/defs.ts';
import { readYourWorldBuild, readYourWorldSettings } from './yourworld/settings.ts';
import { CUSTOM_MAX, DEFAULT_THEME, isThemeId, readCustomTheme, type Appearance, type Theme } from '../shared/themes.ts';

interface StateFile {
    version: 1;
    worlds: Record<string, RememberedWorld>;
    warnOnSwitch: boolean;
    /** `nickserv` is the NickServ password sealed by the OS store (`chat/secret.ts`), and absent when there is none. */
    chat: ChatSettings & { nickserv?: string };
    /**
     * `build` is the line the player chose, absent until they choose one.
     * The key is still `singlePlayer`: the tool was renamed, the files people
     * have were not, and nobody reads this one.
     */
    singlePlayer: YourWorldSettings & { build?: string };
    hiscores: Record<string, string>;
    alwaysOnTop: boolean;
    timers: TimersState;
    /** Which servers a launch opens, in the order they were ticked. Empty, or absent, means the first catalog entry — what a launch has always done. */
    startup: string[];
    /** The app's theme and the servers given their own, by theme id, and the player's own themes (`shared/themes.ts`). */
    appearance: Appearance;
}

// Well past base37's 12-character limit, so no real player name is ever
// affected — this only stops a hand-edited file from handing an arbitrarily
// long string down the wire when a later task builds a lookup URL from it.
const HISCORES_NAME_MAX = 30;

// A sealed password is base64 of a few hundred bytes at most; anything far past
// that is not one, and is not worth handing to the OS store to fail on.
const SEALED_MAX = 4096;

// The catalog a person curates by hand is small; this only stops a hand-edited
// file from naming thousands of windows to open at once.
const STARTUP_MAX = 16;

/**
 * DEFAULT_CHAT, cloned deep enough that autoJoin is never shared: every other
 * field is a primitive, so `{ ...DEFAULT_CHAT }` alone would leave every fresh
 * AppState, and every reset on a failed load, holding DEFAULT_CHAT's own array
 * by reference.
 */
function defaultChat(): ChatSettings {
    return { ...DEFAULT_CHAT, autoJoin: [...DEFAULT_CHAT.autoJoin], ignore: [...DEFAULT_CHAT.ignore] };
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
    // A nick that is not one is dropped rather than the list: it could never have matched anyone.
    if (Array.isArray(c.ignore)) chat.ignore = c.ignore.filter((nick): nick is string => typeof nick === 'string' && isNick(nick)).slice(0, IGNORE_MAX);
    if (typeof c.notify === 'boolean') chat.notify = c.notify;
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
 * Reads a stored startup list one entry at a time, for the same reason as
 * readChat and readHiscores: one bad entry must not cost the user their
 * remembered worlds. Ids are not checked against the catalog here — that is
 * `startupServers`' job at launch, and the catalog is not loaded yet.
 */
function readStartup(x: unknown): string[] {
    if (!Array.isArray(x)) return [];
    const startup: string[] = [];
    for (const id of x) {
        if (startup.length >= STARTUP_MAX) break;
        if (typeof id === 'string' && id !== '' && !startup.includes(id)) startup.push(id);
    }
    return startup;
}

/** Nothing chosen: the look the kit has always had. */
function defaultAppearance(): Appearance {
    return { theme: DEFAULT_THEME, servers: {}, custom: [] };
}

/** A copy deep enough that nothing a caller does to it reaches the stored one. */
function copyTheme(theme: Theme): Theme {
    return { ...theme, colors: { ...theme.colors }, background: theme.background ? { ...theme.background } : null };
}

/**
 * Reads a stored appearance block one entry at a time, for the same reason as
 * readChat and readHiscores. The custom themes come first, each read on its
 * own, so one that cannot be read costs only itself; a second with the same
 * id is dropped. Then a theme id the kit does not know — a custom theme that
 * did not read included — is dropped: the app theme falls back to stone, and
 * a server to following the app. Server ids are not checked against the
 * catalog here, for the reason readStartup gives. Built through a Map and
 * `Object.fromEntries`, which defines keys rather than assigning them, so a
 * hand-edited `__proto__` stays a plain key.
 */
function readAppearance(x: unknown): Appearance {
    if (typeof x !== 'object' || x === null) return defaultAppearance();
    const a = x as Record<string, unknown>;
    const custom: Theme[] = [];
    if (Array.isArray(a.custom)) {
        for (const stored of a.custom) {
            if (custom.length >= CUSTOM_MAX) break;
            const theme = readCustomTheme(stored);
            if (theme && !custom.some(t => t.id === theme.id)) custom.push(theme);
        }
    }
    const servers = new Map<string, string>();
    if (typeof a.servers === 'object' && a.servers !== null) {
        for (const [id, theme] of Object.entries(a.servers)) if (id !== '' && isThemeId(theme, custom)) servers.set(id, theme);
    }
    return { theme: isThemeId(a.theme, custom) ? a.theme : DEFAULT_THEME, servers: Object.fromEntries(servers), custom };
}

/**
 * Small per-user state. Mostly choices the user made in passing rather than
 * settings they configured — the last world and detail chosen per server, and
 * whether they still want warning before a switch reloads the game — and some
 * that really is configuration: the chat nick and the IRC server to reach it
 * on, which servers a launch opens, and the frame's theme, the app's and any
 * server's own, all living alongside the rest for want of a second file worth
 * keeping. It also holds the player's own countdowns and timers,
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
    // Your world's settings: cheats off, xp as the game gives it and members on, until asked otherwise.
    private yourWorld: YourWorldSettings = readYourWorldSettings(undefined);
    private yourWorldBuildId: string | null = null;
    // Last name looked up per server, so the Hiscores box reopens prefilled rather than empty.
    private hiscoresNames = new Map<string, string>();
    // Off until asked for: a window that floats over everything else is not
    // something to hand someone who never asked for it.
    private onTop = false;
    // The player's own countdowns and timers, and their changes to the kit's.
    // App-wide: the same list in every window, whatever its server.
    private timersState: TimersState = emptyTimersState();
    private startup: string[] = [];
    // The look the kit has always had, until asked otherwise.
    private appearanceState: Appearance = defaultAppearance();

    constructor(file: string) {
        this.file = file;
    }

    load(): void {
        this.worlds = new Map();
        this.warn = true;
        this.chatSettings = defaultChat();
        this.nickservSealed = null;
        this.yourWorld = readYourWorldSettings(undefined);
        this.yourWorldBuildId = null;
        this.hiscoresNames = new Map();
        this.onTop = false;
        this.timersState = emptyTimersState();
        this.startup = [];
        this.appearanceState = defaultAppearance();
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
            this.yourWorld = readYourWorldSettings(parsed?.singlePlayer);
            this.yourWorldBuildId = readYourWorldBuild((parsed?.singlePlayer as { build?: unknown } | undefined)?.build);
            this.hiscoresNames = new Map(Object.entries(readHiscores(parsed?.hiscores)));
            // Absent in files written before the preference existed, so anything that is not a boolean keeps the default.
            if (typeof parsed?.alwaysOnTop === 'boolean') this.onTop = parsed.alwaysOnTop;
            this.timersState = readTimers(parsed?.timers);
            this.startup = readStartup(parsed?.startup);
            this.appearanceState = readAppearance(parsed?.appearance);
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
        // The lists are cloned too, unlike the rest of the spread: they are the
        // arrays in an otherwise-primitive settings object, and returning one by
        // reference would let a caller mutate this instance's own list without
        // going through setChat/stageChat at all.
        return { ...this.chatSettings, autoJoin: [...this.chatSettings.autoJoin], ignore: [...this.chatSettings.ignore] };
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
        if (patch.ignore !== undefined) this.chatSettings.ignore = [...patch.ignore];
    }

    /** Your world's settings. A copy: changes go through setYourWorldSettings. */
    yourWorldSettings(): YourWorldSettings {
        return { ...this.yourWorld };
    }

    /**
     * Read back through `readYourWorldSettings` on the way in, as a file
     * would be, so nothing stored here can be something a later load would drop.
     */
    setYourWorldSettings(patch: Partial<YourWorldSettings>): void {
        this.yourWorld = readYourWorldSettings({ ...this.yourWorld, ...patch });
        this.save();
    }

    /** The build line the player last chose for your world; null before they have chosen one. */
    yourWorldBuild(): string | null {
        return this.yourWorldBuildId;
    }

    setYourWorldBuild(id: string): void {
        this.yourWorldBuildId = readYourWorldBuild(id);
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

    /** The ids a launch opens, in the order ticked. Named for ids, not servers, so it does not read as the pure `startupServers` that resolves them. A copy. */
    startupIds(): string[] {
        return [...this.startup];
    }

    setStartupServer(id: string, on: boolean): void {
        const at = this.startup.indexOf(id);
        if (on && at < 0) {
            // The same cap readStartup enforces on the way in, so a list grown
            // past it here does not silently lose its tail on the next load.
            if (this.startup.length >= STARTUP_MAX) return;
            this.startup.push(id);
        } else if (!on && at >= 0) this.startup.splice(at, 1);
        else return;
        this.save();
    }

    /** The app's theme, the servers given their own, and the player's own themes. A copy: changes go through the setters below. */
    appearance(): Appearance {
        const { theme, servers, custom } = this.appearanceState;
        return { theme, servers: { ...servers }, custom: custom.map(copyTheme) };
    }

    /** The app's theme: what Settings wears, and every server not given its own. An id the kit does not know changes nothing. */
    setTheme(id: string): void {
        if (!isThemeId(id, this.appearanceState.custom)) return;
        this.appearanceState = { ...this.appearanceState, theme: id };
        this.save();
    }

    /** A server's own theme, or null to follow the app again. An id the kit does not know changes nothing. */
    setServerTheme(serverId: string, id: string | null): void {
        if (serverId === '' || (id !== null && !isThemeId(id, this.appearanceState.custom))) return;
        const servers = new Map(Object.entries(this.appearanceState.servers));
        if (id === null) servers.delete(serverId);
        else servers.set(serverId, id);
        this.appearanceState = { ...this.appearanceState, servers: Object.fromEntries(servers) };
        this.save();
    }

    /**
     * Stores one of the player's own themes: in place of the one with its id,
     * or after the rest while there are fewer than `CUSTOM_MAX`. Read back
     * through `readCustomTheme` on the way in, as a file would be, so nothing
     * stored here can be something a later load would drop. False when it
     * would not read back, or when there is no room.
     */
    saveCustomTheme(theme: Theme): boolean {
        const read = readCustomTheme(copyTheme(theme));
        if (read === null) return false;
        const custom = [...this.appearanceState.custom];
        const at = custom.findIndex(t => t.id === read.id);
        if (at >= 0) custom[at] = read;
        else if (custom.length < CUSTOM_MAX) custom.push(read);
        else return false;
        this.appearanceState = { ...this.appearanceState, custom };
        this.save();
        return true;
    }

    /** Removes one of the player's own themes. The app goes back to stone if it wore it, and each server that wore it follows the app again. False when there was no such theme. */
    deleteCustomTheme(id: string): boolean {
        const { theme, servers, custom } = this.appearanceState;
        if (!custom.some(t => t.id === id)) return false;
        this.appearanceState = {
            theme: theme === id ? DEFAULT_THEME : theme,
            servers: Object.fromEntries(Object.entries(servers).filter(([, worn]) => worn !== id)),
            custom: custom.filter(t => t.id !== id)
        };
        this.save();
        return true;
    }

    save(): void {
        mkdirSync(dirname(this.file), { recursive: true });
        const data: StateFile = {
            version: 1,
            worlds: Object.fromEntries(this.worlds),
            warnOnSwitch: this.warn,
            chat: this.nickservSealed === null ? this.chatSettings : { ...this.chatSettings, nickserv: this.nickservSealed },
            singlePlayer: this.yourWorldBuildId === null ? this.yourWorld : { ...this.yourWorld, build: this.yourWorldBuildId },
            hiscores: Object.fromEntries(this.hiscoresNames),
            alwaysOnTop: this.onTop,
            timers: this.timersState,
            startup: [...this.startup],
            appearance: this.appearance()
        };
        writeFileSync(this.file, `${JSON.stringify(data, null, 2)}\n`);
    }
}
