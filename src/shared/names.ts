/**
 * Character names, as the engine reads them. A single-player character is the
 * file `data/players/main/<safe name>.sav`, and the engine finds it by passing
 * whatever was typed at the login screen through `toSafeName`. These are ports
 * of the engine's `src/util/JString.ts` and have to stay in step with it.
 *
 * `toSafeName` can only return `[a-z0-9_]{1,12}` with no underscore at either
 * end, or the literal `invalid_name`. That is what makes a name safe to build
 * a path from: nothing it returns holds a separator, a dot or a drive.
 */

export const INVALID_NAME = 'invalid_name';

/**
 * The longest name the kit's name fields take. The engine keeps twelve
 * characters; the field takes more so the shortening shows as it happens.
 */
export const NAME_INPUT_MAX = 32;

/** 37 to the twelfth: base37 holds twelve characters at most. */
const BASE37_LIMIT = 6582952005840035281n;

// prettier-ignore
const BASE37_LOOKUP: readonly string[] = [
    '_', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i',
    'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's',
    't', 'u', 'v', 'w', 'x', 'y', 'z',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
];

/**
 * Names Windows will not create a file under, whatever the extension. The
 * engine would log such a character in and fail to save it there, and a save
 * carried there from another machine could never be copied in, so the kit
 * refuses them on every platform.
 */
const WINDOWS_RESERVED = new Set(['con', 'prn', 'aux', 'nul', ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap(n => [`com${n}`, `lpt${n}`])]);

/** JString.toBase37. Anything that is not an ASCII letter or digit counts as `_`. */
export function toBase37(text: string): bigint {
    const trimmed = text.trim();
    let value = 0n;
    for (let i = 0; i < trimmed.length && i < 12; i++) {
        const c = trimmed.charCodeAt(i);
        value *= 37n;
        if (c >= 0x41 && c <= 0x5a) value += BigInt(c + 1 - 0x41);
        else if (c >= 0x61 && c <= 0x7a) value += BigInt(c + 1 - 0x61);
        else if (c >= 0x30 && c <= 0x39) value += BigInt(c + 27 - 0x30);
    }
    while (value % 37n === 0n && value !== 0n) value /= 37n;
    return value;
}

/** JString.fromBase37. */
export function fromBase37(value: bigint): string {
    if (value < 0n || value >= BASE37_LIMIT) return INVALID_NAME;
    if (value % 37n === 0n) return INVALID_NAME;
    let text = '';
    let rest = value;
    while (rest !== 0n) {
        text = BASE37_LOOKUP[Number(rest % 37n)]! + text;
        rest /= 37n;
    }
    return text;
}

/** JString.toSafeName: the name the engine files a character under. */
export function toSafeName(text: string): string {
    return fromBase37(toBase37(text));
}

/** JString.toDisplayName: the name as the game writes it. */
export function toDisplayName(text: string): string {
    return toSafeName(text)
        .replaceAll('_', ' ')
        .replace(/\w\S*/g, word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

/**
 * Why a typed name cannot become a character, or null when it can. The
 * character is filed under `toSafeName(typed)`, which may not be what was
 * typed; `toDisplayName` is how to show it.
 */
export function nameProblem(typed: string): string | null {
    if (typed.length > NAME_INPUT_MAX) return 'That name is too long.';
    if (toBase37(typed) === 0n) return 'A name needs at least one letter or number.';
    const name = toSafeName(typed);
    if (name === INVALID_NAME) return 'The game keeps that name for itself.';
    if (WINDOWS_RESERVED.has(name)) return "Windows can't keep a save under that name.";
    return null;
}
