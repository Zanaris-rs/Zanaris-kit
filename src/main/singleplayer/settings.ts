import { DEFAULT_SINGLE_PLAYER_SETTINGS, isXpRate, type BuildLine, type SinglePlayerSettings } from '../../shared/singleplayer.ts';
import type { Confirmation } from './confirm.ts';

/**
 * A stored settings block, one field at a time, as appState reads chat's: a
 * bad value costs only its own field. Before XP rate and members existed the
 * block was `{ cheats }` alone, which reads as that with the other two at
 * their defaults.
 */
export function readSinglePlayerSettings(x: unknown): SinglePlayerSettings {
    const settings: SinglePlayerSettings = { ...DEFAULT_SINGLE_PLAYER_SETTINGS };
    if (typeof x !== 'object' || x === null) return settings;
    const s = x as Record<string, unknown>;
    if (typeof s.cheats === 'boolean') settings.cheats = s.cheats;
    if (isXpRate(s.xpRate)) settings.xpRate = s.xpRate;
    if (typeof s.members === 'boolean') settings.members = s.members;
    return settings;
}

/**
 * One change as the shell sent it, checked. Null for a key that is not a
 * setting, or a value that setting cannot take: an XP rate is one of
 * XP_RATES, not any number.
 */
export function readSettingChange(key: unknown, value: unknown): Partial<SinglePlayerSettings> | null {
    if (key === 'cheats' && typeof value === 'boolean') return { cheats: value };
    if (key === 'members' && typeof value === 'boolean') return { members: value };
    if (key === 'xpRate' && isXpRate(value)) return { xpRate: value };
    return null;
}

/** True when applying the change would leave any setting different. */
export function changesSettings(current: SinglePlayerSettings, patch: Partial<SinglePlayerSettings>): boolean {
    return (
        (patch.cheats !== undefined && patch.cheats !== current.cheats) ||
        (patch.xpRate !== undefined && patch.xpRate !== current.xpRate) ||
        (patch.members !== undefined && patch.members !== current.members)
    );
}

/** The restart a change costs, asked on the window while the world is running. The shell sends one setting at a time. */
export function restartConfirmation(patch: Partial<SinglePlayerSettings>): Confirmation {
    const ask = (message: string, detail: string): Confirmation => ({ message: `${message} restarts your world and logs you out.`, detail, button: 'Restart', destructive: false });
    if (patch.cheats !== undefined) {
        return patch.cheats
            ? ask('Turning cheats on', 'Developer commands such as ::tele and ::give will work. The Commands tab lists them.')
            : ask('Turning cheats off', 'Developer commands will be refused.');
    }
    if (patch.xpRate !== undefined) {
        return ask(`Changing the XP rate to ${patch.xpRate}` + String.fromCharCode(0xD7), `Experience your characters earn from then on is multiplied by ${patch.xpRate}. What they already have stays as it is.`);
    }
    return patch.members
        ? ask('Turning members on', 'Your world becomes a members world again.')
        : ask('Turning members off', 'Your world becomes a free one, as the free-to-play game was.');
}

/** A download's size as a player reads it: whole megabytes. */
function megabytes(bytes: number): string {
    return `${Math.round(bytes / 1_000_000)} MB`;
}

/**
 * Switching builds while the world runs, asked on the window. A line that is
 * not downloaded yet downloads first, and the world keeps running on the old
 * build until it lands. Characters live per revision, so the question says
 * whether they come along.
 */
export function switchConfirmation(to: BuildLine, fromRevision: number): Confirmation {
    const download = to.state !== 'installed' && to.size !== null ? `It downloads first (${megabytes(to.size)}), and your world keeps running until then.` : null;
    const characters = to.revision === fromRevision ? 'Your characters come with you.' : `Your rev ${fromRevision} characters stay where they are, and rev ${to.revision} has its own. Characters can copy one across.`;
    return {
        message: `Switching to ${to.name} restarts your world and logs you out.`,
        detail: download === null ? characters : `${download} ${characters}`,
        button: 'Switch',
        destructive: false
    };
}

/** Removing a build frees its folder and nothing else: the characters are in the revision's world folder. */
export function removeBuildConfirmation(line: BuildLine): Confirmation {
    return {
        message: `Remove ${line.name}?`,
        detail: line.size === null ? 'Your characters stay.' : `Your characters stay, and it can be downloaded again (${megabytes(line.size)}).`,
        button: 'Remove',
        destructive: false
    };
}
