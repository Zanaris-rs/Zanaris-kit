import type { Detail } from '../../shared/worlds.ts';

/** A switch the user asked for and has not confirmed yet. */
export type SwitchIntent =
    | { kind: 'world'; to: number }
    | { kind: 'detail'; to: Detail };

/**
 * What the confirmation asks before a switch throws the player out of the
 * game. The wording lives here rather than in the dialog call so it can be
 * read and tested without Electron.
 */
export function switchWarning(intent: SwitchIntent): { message: string; detail: string } {
    if (intent.kind === 'world') {
        return {
            message: `Switch to World ${intent.to}?`,
            detail: "If you're in game, you'll be logged out."
        };
    }
    return {
        message: `Switch to ${intent.to} detail?`,
        detail: "If you're in game, you'll be logged out."
    };
}
