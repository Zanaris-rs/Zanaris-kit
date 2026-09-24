/**
 * The builds your world can run. Each line is a recipe, `engines/<id>.json`:
 * the upstream engine and content commits the stage script builds from, the
 * patches it lays over the engine, and — once CI has built and published it —
 * the archive the kit downloads, pinned by size and sha-256. The kit runs no
 * build whose digest it did not ship with.
 *
 * Pure, with no Node imports: the scripts read recipes through it, main does,
 * and the renderer uses its types.
 */

/** Where every build is published, as a prerelease of the kit's own repository. */
export const BUILDS_REPO = 'Zanaris-rs/Zanaris-kit';

/** The line your world runs until the player picks another. */
export const DEFAULT_BUILD = 'lostcity-274';

export interface EngineSource {
    repo: string;
    commit: string;
}

/** The published archive, as the kit pins it. */
export interface Artifact {
    /** The release tag: `recipeTag` of the recipe it was built from. */
    tag: string;
    /** The asset's file name: `artifactFile` of the recipe's id. */
    file: string;
    /** Its size in bytes, as GitHub reports it. */
    size: number;
    /** GitHub's sha-256 of the asset. */
    sha256: string;
}

export interface Recipe {
    /** The line's name on disk and in tags: lower case, digits and dashes. */
    id: string;
    name: string;
    /** The game revision: world.json's engine.revision, and the world folder the line's characters live in. */
    revision: number;
    /** A line the player should read before choosing it, shown under the name. */
    note: string | null;
    engine: EngineSource;
    content: EngineSource;
    /** The directory of patches the stage script applies to the engine, relative to the repository. */
    patches: string;
    /** Null while a pin is moving: the line is listed and cannot be downloaded. */
    artifact: Artifact | null;
}

const ID = /^[a-z0-9][a-z0-9-]*$/;
const COMMIT = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

function isRecord(x: unknown): x is Record<string, unknown> {
    return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function readSource(x: unknown): EngineSource | null {
    if (!isRecord(x)) return null;
    if (typeof x.repo !== 'string' || x.repo === '' || typeof x.commit !== 'string' || !COMMIT.test(x.commit)) return null;
    return { repo: x.repo, commit: x.commit };
}

function readArtifact(x: unknown, id: string): Artifact | null | undefined {
    if (x === null) return null;
    if (!isRecord(x)) return undefined;
    if (typeof x.tag !== 'string' || !x.tag.startsWith(`engine-${id}-`)) return undefined;
    if (x.file !== artifactFile(id)) return undefined;
    if (typeof x.size !== 'number' || !Number.isSafeInteger(x.size) || x.size <= 0) return undefined;
    if (typeof x.sha256 !== 'string' || !SHA256.test(x.sha256)) return undefined;
    return { tag: x.tag, file: x.file, size: x.size, sha256: x.sha256 };
}

/**
 * A recipe as a file holds it, checked field by field. Any field that is not
 * what the kit expects refuses the whole recipe: a line the kit half
 * understands is one it cannot safely download or run.
 */
export function readRecipe(x: unknown): Recipe | null {
    if (!isRecord(x)) return null;
    if (typeof x.id !== 'string' || !ID.test(x.id)) return null;
    if (typeof x.name !== 'string' || x.name.trim() === '') return null;
    if (typeof x.revision !== 'number' || !Number.isSafeInteger(x.revision) || x.revision <= 0) return null;
    if (x.note !== null && typeof x.note !== 'string') return null;
    const engine = readSource(x.engine);
    const content = readSource(x.content);
    if (!engine || !content) return null;
    if (typeof x.patches !== 'string' || x.patches === '') return null;
    const artifact = readArtifact(x.artifact, x.id);
    if (artifact === undefined) return null;
    return { id: x.id, name: x.name, revision: x.revision, note: x.note, engine, content, patches: x.patches, artifact };
}

/**
 * The tag a recipe's build is published under. It names exactly what was
 * built: the line, the first eight characters of each commit, and the patch
 * set's hash, since the same commits with a different patch are a different
 * engine.
 */
export function recipeTag(recipe: Pick<Recipe, 'id' | 'engine' | 'content'>, patchHash: string): string {
    return `engine-${recipe.id}-${recipe.engine.commit.slice(0, 8)}-${recipe.content.commit.slice(0, 8)}-${patchHash}`;
}

/** The archive's file name, the same for every build of a line. */
export function artifactFile(id: string): string {
    return `engine-${id}.tar.gz`;
}

/** Where the kit downloads an artifact from. */
export function artifactUrl(artifact: Artifact): string {
    return `https://github.com/${BUILDS_REPO}/releases/download/${artifact.tag}/${artifact.file}`;
}
