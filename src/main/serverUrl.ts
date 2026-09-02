import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_PORT = 8888;

export interface ServerTarget {
    url: string;
    port: number;
    /** Where the port came from — surfaced in logs so a wrong port is obvious. */
    source: string;
    serverRoot: string;
}

/**
 * SwiftKit lives at <serverRoot>/swiftkit, and compiles to <serverRoot>/swiftkit/dist/main.
 * SWIFTKIT_SERVER_ROOT overrides for the case where it doesn't.
 */
export function resolveServerRoot(): string {
    const override = process.env.SWIFTKIT_SERVER_ROOT;
    if (override) {
        return resolve(override);
    }
    return resolve(__dirname, '../../..');
}

/**
 * Read web.port from the engine's live config rather than assuming a default.
 * WorldConfig.ts:86 defaults to 80 on darwin/win32 and 8888 elsewhere, which is
 * why start.js:161-165 opens the wrong URL on macOS. Reading the config avoids
 * repeating that bug.
 *
 * Uses 127.0.0.1 rather than "localhost" so the target can't be redirected by
 * name resolution.
 */
export function resolveServerTarget(): ServerTarget {
    const serverRoot = resolveServerRoot();
    const configPath = resolve(serverRoot, 'engine/data/config/world.json');

    let port = DEFAULT_PORT;
    let source: string;

    try {
        const raw = readFileSync(configPath, 'utf8');
        const parsed = JSON.parse(raw) as { web?: { port?: unknown } };
        const configured = parsed.web?.port;

        if (typeof configured === 'number' && Number.isInteger(configured) && configured > 0 && configured < 65536) {
            port = configured;
            source = configPath;
        } else {
            source = `${configPath} (no usable web.port — fell back to ${DEFAULT_PORT})`;
        }
    } catch (err) {
        source = `${configPath} unreadable (${(err as Error).message}) — fell back to ${DEFAULT_PORT}`;
    }

    return { url: `http://127.0.0.1:${port}/rs2.cgi`, port, source, serverRoot };
}

/** Cheap reachability probe so a stopped server shows a real message, not a blank window. */
export async function isReachable(url: string, timeoutMs = 2000): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: controller.signal });
        return res.ok;
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
}
