import type { Detail, RememberedWorld, WorldsDef } from '../../shared/worlds.ts';
import { expandTemplate } from './sources.ts';

/**
 * Which world and detail one window is on, and the URL that means. Pure:
 * main calls loadURL with what this returns. A template that needs a world
 * origin (Zanaris) starts on the server's own page until a listed world is
 * chosen, since the list is not fetched before a window opens.
 */
export class WorldSwitch {
    private readonly def: WorldsDef;
    private current: RememberedWorld;

    constructor(def: WorldsDef, serverUrl: string, remembered: RememberedWorld | null) {
        this.def = def;
        if (remembered) {
            this.current = { ...remembered };
        } else {
            let url: string;
            try {
                url = expandTemplate(def.template, { world: def.defaultWorld, origin: null, detail: 'low' });
            } catch {
                url = serverUrl;
            }
            this.current = { world: def.defaultWorld, detail: 'low', url };
        }
    }

    get world(): number {
        return this.current.world;
    }

    get detail(): Detail {
        return this.current.detail;
    }

    get url(): string {
        return this.current.url;
    }

    /** Moves to a listed world at the current detail and returns the URL to load. */
    select(world: { id: number; origin: string | null }): string {
        const url = expandTemplate(this.def.template, { world: world.id, origin: world.origin, detail: this.current.detail });
        this.current = { world: world.id, detail: this.current.detail, url };
        return url;
    }

    /** Returns the URL that reloads the current world at the new detail, or null when nothing changes. */
    setDetail(detail: Detail): string | null {
        if (!this.def.detail || detail === this.current.detail) return null;
        const origin = new URL(this.current.url).origin;
        const url = expandTemplate(this.def.template, { world: this.current.world, origin, detail });
        this.current = { ...this.current, detail, url };
        return url;
    }

    remembered(): RememberedWorld {
        return { ...this.current };
    }

    /** "Lost City · W5 · low · 43 ms", dropping the pieces that do not apply. */
    label(serverName: string, latencyMs: number | null): string {
        const parts = [serverName, `W${this.current.world}`];
        if (this.def.detail) parts.push(this.current.detail);
        if (latencyMs !== null) parts.push(`${latencyMs} ms`);
        return parts.join(' · ');
    }

    title(serverName: string): string {
        return `${serverName} — World ${this.current.world}`;
    }
}
