import type { Detail } from '../../shared/worlds.ts';

/** A switch the user asked for and has not confirmed yet. */
export type SwitchIntent =
    | { kind: 'world'; to: number; from: number }
    | { kind: 'detail'; to: Detail; world: number };

/**
 * What the confirmation asks before a switch throws the player out of the
 * game. The wording lives here rather than in the dialog call so it can be
 * read and tested without Electron.
 */
export function switchWarning(intent: SwitchIntent): { message: string; detail: string } {
    if (intent.kind === 'world') {
        return {
            message: `Switch to World ${intent.to}?`,
            detail: `SwiftKit loads World ${intent.to} straight away, whether or not you are logged in. If you are in game on World ${intent.from}, that logs you out.`
        };
    }
    return {
        message: `Switch to ${intent.to} detail?`,
        detail: `SwiftKit reloads World ${intent.world} at ${intent.to} detail straight away, whether or not you are logged in. If you are in game, that logs you out.`
    };
}
