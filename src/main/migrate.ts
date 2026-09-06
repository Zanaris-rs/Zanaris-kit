import { join } from 'node:path';

/**
 * What the app carries across when its userData directory changes name:
 * the server list, the remembered worlds and warning preference, and the
 * Chromium partitions holding every game login and asset cache. Ordered
 * cheapest first, so a log line reads small to large.
 */
const ENTRIES = ['servers.json', 'state.json', 'Partitions'];

/**
 * Which entries of an old profile belong in the new one: those the old
 * profile has and the new one does not. Pure, and takes its own `exists`, so
 * the decision can be tested without Electron and without touching a disk.
 *
 * Per entry rather than per directory because the new directory cannot be
 * assumed absent — see the note in index.ts. Deciding one entry at a time
 * holds whatever Chromium has already scaffolded there: a user who has built
 * up a new profile keeps it, and anything they have not got yet comes across.
 */
export function migrationPlan(oldDir: string, newDir: string, exists: (path: string) => boolean): string[] {
    return ENTRIES.filter(name => exists(join(oldDir, name)) && !exists(join(newDir, name)));
}
