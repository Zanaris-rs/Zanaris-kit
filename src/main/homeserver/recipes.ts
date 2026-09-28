import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_BUILD, readRecipe, type Recipe } from '../../shared/engines.ts';

/** What the default line was when this was written; used only when no recipe can be read at all. */
const LAST_KNOWN_REVISION = 274;

/**
 * The build lines this kit knows: every engines/*.json, stamped into the main
 * bundle by electron-vite's `define`, or read from the repository under
 * node --test. A recipe the reader refuses is left out rather than guessed at.
 */
export function bundledRecipes(): Recipe[] {
    const raw = typeof __ENGINE_RECIPES__ !== 'undefined' ? __ENGINE_RECIPES__ : fromDisk();
    return raw.map(readRecipe).filter((recipe): recipe is Recipe => recipe !== null);
}

/**
 * The catalog's built-in entry calls this at module scope, so a throw here
 * would take the main process down before there is a window to say so in —
 * and the path is relative, so any cwd but the repository root misses it.
 */
function fromDisk(): unknown[] {
    try {
        return readdirSync('engines')
            .filter(file => file.endsWith('.json'))
            .sort()
            .map(file => JSON.parse(readFileSync(join('engines', file), 'utf8')) as unknown);
    } catch {
        return [];
    }
}

/** A line's revision; the default line's for one the kit does not know. The number is a label here, so a guess beats a throw. */
export function recipeRevision(id: string | null, recipes: readonly Recipe[] = bundledRecipes()): number {
    return recipes.find(recipe => recipe.id === id)?.revision ?? recipes.find(recipe => recipe.id === DEFAULT_BUILD)?.revision ?? LAST_KNOWN_REVISION;
}
