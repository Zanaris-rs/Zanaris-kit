import type { Artifact, Recipe } from '../../shared/engines.ts';
import type { BuildLine, BuildState, SinglePlayerVersion } from '../../shared/singleplayer.ts';
import { parseVersion } from './config.ts';

/** The id the developer's own stage is listed under. No recipe can take it: recipe ids are the kit's. */
export const LOCAL_BUILD = 'local';

/** Where downloads land and unpack, beside the builds; cleared at start and after every attempt. */
const INCOMING = '.incoming';

/** A build the world can run: current, checked, on disk. */
export interface InstalledBuild {
    id: string;
    /** Its folder: VERSION.json, src/app.js and the asset trees the world copies. */
    resources: string;
    revision: number;
    /** Null for the local build, which no release names. */
    tag: string | null;
}

export interface BuildStoreDeps {
    /** <userData>/singleplayer/builds: one folder per line. */
    dir: string;
    /** The lines this kit knows, in the order they are listed. */
    recipes: readonly Recipe[];
    /** engine-dist/ in an unpackaged run, listed when it holds a stage; null when packaged. */
    local: string | null;
    join(...parts: string[]): string;
    fs: {
        exists(path: string): boolean;
        readText(path: string): string;
        mkdir(path: string): void;
        /** Recursive, and quiet when the path is absent. */
        rm(path: string): void;
        rename(from: string, to: string): void;
    };
    /** Downloads an artifact to `to`, refusing it unless its size and sha-256 are the pinned ones. */
    download(artifact: Artifact, to: string, onProgress: (fraction: number) => void): Promise<void>;
    extract(archive: string, into: string): Promise<void>;
    log(msg: string): void;
}

interface Flight {
    promise: Promise<void>;
    /** Whole percents, as a fraction: the last step the listeners heard. */
    progress: number;
}

/**
 * Single player's builds on this computer: one folder per line, each holding
 * the build the kit pins for it or nothing. A build gets there only by being
 * downloaded, checked against its pinned size and digest, unpacked beside the
 * others, checked again by the VERSION.json it unpacked to, and renamed into
 * place, so a half-downloaded or unexpected build never sits where the world
 * could run it.
 *
 * The developer's own stage, engine-dist/, is listed too in an unpackaged run.
 * It is the one build the kit runs without a pin.
 */
export class BuildStore {
    private readonly deps: BuildStoreDeps;
    private readonly listeners = new Set<() => void>();
    /** What each line's folder holds now, as last read. */
    private readonly onDisk = new Map<string, SinglePlayerVersion | null>();
    private readonly flights = new Map<string, Flight>();
    private readonly errors = new Map<string, string>();
    private readonly local: SinglePlayerVersion | null;

    constructor(deps: BuildStoreDeps) {
        this.deps = deps;
        // A quit during a download leaves this behind; nothing in it was ever trusted.
        this.clear(deps.join(deps.dir, INCOMING));
        for (const recipe of deps.recipes) this.read(recipe.id);
        this.local = deps.local === null ? null : this.version(deps.join(deps.local, 'VERSION.json'));
    }

    subscribe(fn: () => void): () => void {
        this.listeners.add(fn);
        return () => void this.listeners.delete(fn);
    }

    lines(): BuildLine[] {
        const lines = this.deps.recipes.map(recipe => this.line(recipe));
        if (this.local) {
            lines.push({
                id: LOCAL_BUILD,
                name: 'Local build (engine-dist)',
                revision: this.local.revision,
                note: 'Your own npm run stage:engine. Offered only while the kit runs from source.',
                engine: this.local.engine,
                content: this.local.content,
                size: null,
                state: 'installed',
                progress: null,
                error: null,
                local: true
            });
        }
        return lines;
    }

    /** The build a line runs, when it is on disk and current; null for anything else. */
    installed(id: string): InstalledBuild | null {
        if (id === LOCAL_BUILD) {
            return this.local && this.deps.local !== null ? { id, resources: this.deps.local, revision: this.local.revision, tag: null } : null;
        }
        const recipe = this.recipe(id);
        if (!recipe || this.state(recipe) !== 'installed') return null;
        return { id, resources: this.folder(id), revision: recipe.revision, tag: recipe.artifact?.tag ?? null };
    }

    /**
     * Downloads, checks and installs a line's pinned build. A second call for a
     * line on its way down joins the first. Rejects with a sentence for the
     * player, which the line also keeps as its `error` until the next attempt.
     */
    install(id: string): Promise<void> {
        const recipe = this.recipe(id);
        if (!recipe) return Promise.reject(new Error(`${id} is not a build this kit knows`));
        const artifact = recipe.artifact;
        if (!artifact) return Promise.reject(new Error(`${recipe.name} has no build to download in this version of the kit`));
        const flying = this.flights.get(id);
        if (flying) return flying.promise;
        this.errors.delete(id);
        const flight: Flight = { promise: Promise.resolve(), progress: 0 };
        flight.promise = this.fly(recipe, artifact, flight).finally(() => {
            this.flights.delete(id);
            this.notify();
        });
        this.flights.set(id, flight);
        this.notify();
        return flight.promise;
    }

    /** Deletes a line's build. It can be downloaded again; the characters are elsewhere and untouched. */
    remove(id: string): void {
        if (id === LOCAL_BUILD) throw new Error('The local build is your own stage, so the kit leaves it alone.');
        if (this.flights.has(id)) throw new Error('That build is downloading.');
        if (!this.recipe(id)) throw new Error(`${id} is not a build this kit knows`);
        this.deps.fs.rm(this.folder(id));
        this.read(id);
        this.notify();
    }

    // ── internals ────────────────────────────────────────────────────────

    private async fly(recipe: Recipe, artifact: Artifact, flight: Flight): Promise<void> {
        const { fs, join } = this.deps;
        const incoming = join(this.deps.dir, INCOMING, recipe.id);
        const archive = join(incoming, artifact.file);
        const unpacked = join(incoming, 'build');
        try {
            this.clear(incoming);
            fs.mkdir(incoming);
            try {
                await this.deps.download(artifact, archive, fraction => this.progress(flight, fraction));
            } catch (err) {
                throw new Error(`The download didn't finish: ${message(err)}`);
            }
            try {
                await this.deps.extract(archive, unpacked);
            } catch (err) {
                throw new Error(`The download couldn't be unpacked: ${message(err)}`);
            }
            // The digest already vouches for the archive; this catches a pin that
            // names one build's archive under another's tag.
            const version = this.version(join(unpacked, 'VERSION.json'));
            if (!version || version.id !== recipe.id || version.tag !== artifact.tag || version.engine !== recipe.engine.commit || version.content !== recipe.content.commit || version.revision !== recipe.revision) {
                throw new Error(`What downloaded is not the build this kit pins for ${recipe.name}.`);
            }
            const target = this.folder(recipe.id);
            fs.rm(target);
            fs.rename(unpacked, target);
            this.deps.log(`[builds] installed ${artifact.tag}`);
        } catch (err) {
            const reason = message(err);
            this.errors.set(recipe.id, reason);
            this.deps.log(`[builds] ${recipe.id}: ${reason}`);
            throw new Error(reason);
        } finally {
            this.clear(incoming);
            this.read(recipe.id);
        }
    }

    /** Whole percents only: a 50 MB download would otherwise push the view thousands of times. */
    private progress(flight: Flight, fraction: number): void {
        const step = Math.floor(Math.min(1, Math.max(0, fraction)) * 100) / 100;
        if (step <= flight.progress) return;
        flight.progress = step;
        this.notify();
    }

    private line(recipe: Recipe): BuildLine {
        const flight = this.flights.get(recipe.id);
        return {
            id: recipe.id,
            name: recipe.name,
            revision: recipe.revision,
            note: recipe.note,
            engine: recipe.engine.commit,
            content: recipe.content.commit,
            size: recipe.artifact?.size ?? null,
            state: this.state(recipe),
            progress: flight ? flight.progress : null,
            error: this.errors.get(recipe.id) ?? null,
            local: false
        };
    }

    private state(recipe: Recipe): BuildState {
        if (this.flights.has(recipe.id)) return 'downloading';
        if (!recipe.artifact) return 'unavailable';
        const version = this.onDisk.get(recipe.id) ?? null;
        if (version === null) return this.deps.fs.exists(this.folder(recipe.id)) ? 'outdated' : 'absent';
        return version.tag === recipe.artifact.tag ? 'installed' : 'outdated';
    }

    private recipe(id: string): Recipe | undefined {
        return this.deps.recipes.find(recipe => recipe.id === id);
    }

    private folder(id: string): string {
        return this.deps.join(this.deps.dir, id);
    }

    private read(id: string): void {
        this.onDisk.set(id, this.version(this.deps.join(this.folder(id), 'VERSION.json')));
    }

    private version(path: string): SinglePlayerVersion | null {
        try {
            return this.deps.fs.exists(path) ? parseVersion(this.deps.fs.readText(path)) : null;
        } catch {
            return null;
        }
    }

    private clear(path: string): void {
        try {
            this.deps.fs.rm(path);
        } catch (err) {
            this.deps.log(`[builds] could not clear ${path}: ${message(err)}`);
        }
    }

    private notify(): void {
        for (const fn of this.listeners) {
            try {
                fn();
            } catch (err) {
                this.deps.log(`[builds] a listener threw: ${message(err)}`);
            }
        }
    }
}

function message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
