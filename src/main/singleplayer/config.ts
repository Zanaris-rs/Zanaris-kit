import type { SinglePlayerVersion } from '../../shared/singleplayer.ts';

export interface WorldPorts {
    web: number;
    management: number;
    tcp: number;
}

export const LOG_TAIL_LINES = 200;

/** The engine's content directory, relative to the world's working directory. */
export const CONTENT_DIR = 'content';

/**
 * The world.json the kit writes before every start. Everything the engine
 * needs to be a private world: loopback binds, no login, friend or logger
 * server, live reload off. Production stays off; cheats is the staff level and
 * nothing else. The engine fills any key omitted here.
 *
 * srcDir names the trimmed content directory the kit ships and copies into the
 * working directory - the maps CSVs and nothing else. It cannot be a path that
 * does not exist: the engine's GameMap.init() returns at its first line when
 * <srcDir>/maps is absent, and a world with no npcs, objs, locs or collision
 * still boots and reports itself ready. Live reload is off, so nothing watches
 * it; the /content route serves those two files on loopback.
 */
export function worldJson(opts: { ports: WorldPorts; cheats: boolean; revision: number }): string {
    const config = {
        easyStartup: false,
        account: { autoCreate: false },
        web: { port: opts.ports.web, host: '127.0.0.1', allowedOrigin: '', managementPort: opts.ports.management },
        engine: { revision: opts.revision },
        node: {
            id: 1,
            port: opts.ports.tcp,
            host: '127.0.0.1',
            members: true,
            autoSubscribeMembers: true,
            xpRate: 1,
            production: false,
            localStaffLevel: opts.cheats ? 4 : 0,
            debug: false,
            profile: 'main',
            maxConnected: 10
        },
        login: { enabled: false },
        friend: { enabled: false },
        logger: { enabled: false },
        db: { backend: 'sqlite' },
        build: { startup: false, verify: false, liveReload: false, srcDir: CONTENT_DIR }
    };
    return `${JSON.stringify(config, null, 4)}\n`;
}

/** The catalog's placeholder url with the port the world was actually started on. */
export function gameUrl(base: string, port: number): string {
    const url = new URL(base);
    url.port = String(port);
    return url.href;
}

/** resources/engine/VERSION.json, as the stage script writes it. */
export function parseVersion(text: string): SinglePlayerVersion | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;
    const v = parsed as Record<string, unknown>;
    const engine = (v.engine as Record<string, unknown> | undefined)?.commit;
    const content = (v.content as Record<string, unknown> | undefined)?.commit;
    if (typeof engine !== 'string' || typeof content !== 'string') return null;
    if (typeof v.revision !== 'number' || !Number.isInteger(v.revision) || typeof v.built !== 'string') return null;
    return { engine, content, revision: v.revision, built: v.built };
}

/** True when the assets in the working directory came from this VERSION.json. */
export function stampMatches(stamp: string | null, versionText: string): boolean {
    return stamp !== null && stamp.trim() === versionText.trim();
}
