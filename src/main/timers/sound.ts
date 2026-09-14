/**
 * Which sound a timer's alert plays, decided without touching the system: the
 * files to try on each platform, what a file's bytes are, and AIFF rewritten as
 * something Chromium can decode. `timers/electron.ts` runs the commands and
 * reads the files; everything it acts on is decided here.
 */

/** What CoreAudio plays when `com.apple.sound.beep.sound` is unset. Checked on macOS 14.7.1: the path sits beside the key in `AudioServices`. */
export const MAC_DEFAULT_ALERT = '/System/Library/Sounds/Tink.aiff';
export const LINUX_ALERTS: readonly string[] = ['/usr/share/sounds/freedesktop/stereo/bell.oga', '/usr/share/sounds/freedesktop/stereo/complete.oga'];
/** A system alert is well under a megabyte; anything past this is not one, and is not read into memory to find out. */
export const SOUND_BYTES_MAX = 5 * 1024 * 1024;

export interface SoundFacts {
    /** `defaults read -g com.apple.sound.beep.sound`, trimmed; null when unset or unreadable. */
    macAlert: string | null;
    /** The default value of `HKCU\AppEvents\Schemes\Apps\.Default\.Default\.Current`; null when there is none. */
    windowsDefault: string | null;
    env: Readonly<Record<string, string | undefined>>;
}

/** The files to try, best first. The bundled chime is not among them: it is what is left when none of these play. */
export function alertSoundCandidates(platform: string, facts: SoundFacts): string[] {
    switch (platform) {
        case 'darwin':
            return [...new Set([facts.macAlert, MAC_DEFAULT_ALERT].filter((path): path is string => typeof path === 'string' && path !== ''))];
        case 'win32':
            return facts.windowsDefault ? [expandWindowsVars(facts.windowsDefault, facts.env)] : [];
        case 'linux':
            return [...LINUX_ALERTS];
        default:
            return [];
    }
}

/** `%SystemRoot%`-style variables, matched without regard to case as Windows does. One it cannot find is left as written. */
export function expandWindowsVars(path: string, env: Readonly<Record<string, string | undefined>>): string {
    return path.replace(/%([^%]+)%/g, (whole, name: string) => {
        const key = Object.keys(env).find(k => k.toLowerCase() === name.toLowerCase());
        return (key === undefined ? undefined : env[key]) ?? whole;
    });
}

/**
 * The value out of `reg query <key> /ve`. The label before the type is
 * localised — "(Default)", "(Standard)" — so the type is what is matched, and
 * a key with no sound chosen has nothing after its type.
 */
export function parseRegDefault(stdout: string): string | null {
    for (const line of stdout.split(/\r?\n/)) {
        const match = /\sREG_(?:EXPAND_)?SZ\s+(.+?)\s*$/.exec(line);
        if (match?.[1]) return match[1];
    }
    return null;
}

export type SoundFormat = 'wav' | 'ogg' | 'flac' | 'mp3' | 'mp4' | 'aiff';

function hasAscii(bytes: Uint8Array, at: number, text: string): boolean {
    if (bytes.length < at + text.length) return false;
    for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text.charCodeAt(i)) return false;
    return true;
}

function writeAscii(bytes: Uint8Array, at: number, text: string): void {
    for (let i = 0; i < text.length; i++) bytes[at + i] = text.charCodeAt(i);
}

/** What a file is, by its first bytes. Null for anything this does not recognise, Core Audio Format included. */
export function sniff(bytes: Uint8Array): SoundFormat | null {
    if (hasAscii(bytes, 0, 'RIFF') && hasAscii(bytes, 8, 'WAVE')) return 'wav';
    if (hasAscii(bytes, 0, 'OggS')) return 'ogg';
    if (hasAscii(bytes, 0, 'fLaC')) return 'flac';
    if (hasAscii(bytes, 0, 'ID3')) return 'mp3';
    if (bytes.length >= 2 && bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0) return 'mp3';
    if (hasAscii(bytes, 4, 'ftyp')) return 'mp4';
    if (hasAscii(bytes, 0, 'FORM') && (hasAscii(bytes, 8, 'AIFF') || hasAscii(bytes, 8, 'AIFC'))) return 'aiff';
    return null;
}

/** Bytes Chromium can decode, or null. AIFF is rewritten; the formats Chromium reads are returned as they came. */
export function toPlayable(bytes: Uint8Array): Uint8Array | null {
    if (bytes.length === 0 || bytes.length > SOUND_BYTES_MAX) return null;
    const format = sniff(bytes);
    if (format === null) return null;
    return format === 'aiff' ? aiffToWav(bytes) : bytes;
}

/** An 80-bit IEEE extended float, which is how AIFF stores its sample rate. */
function readExtended(view: DataView, at: number): number {
    const exponent = view.getUint16(at) & 0x7fff;
    const mantissa = view.getUint32(at + 2) * 2 ** 32 + view.getUint32(at + 6);
    if (exponent === 0 && mantissa === 0) return 0;
    return mantissa * 2 ** (exponent - 16383 - 63);
}

/** One sample, scaled to 16 bits by keeping its top bits. AIFF's 8-bit samples are signed, unlike WAV's. */
function readSample16(view: DataView, at: number, bits: number, littleEndian: boolean): number {
    switch (bits) {
        case 8:
            return view.getInt8(at) * 256;
        case 16:
            return view.getInt16(at, littleEndian);
        case 24: {
            const high = view.getUint8(littleEndian ? at + 2 : at);
            const middle = view.getUint8(at + 1);
            return ((high << 24) >> 16) | middle;
        }
        default:
            return view.getInt32(at, littleEndian) >> 16;
    }
}

/**
 * Uncompressed AIFF, or AIFF-C marked `NONE` or `sowt`, as 16-bit little-endian
 * PCM WAV at the same rate and channel count. Null for anything else, or for a
 * file whose chunks do not add up — this reads files off disk, and a bad one
 * must cost only itself.
 */
export function aiffToWav(bytes: Uint8Array): Uint8Array | null {
    if (sniff(bytes) !== 'aiff') return null;
    try {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const compressed = hasAscii(bytes, 8, 'AIFC');
        let format: { channels: number; frames: number; bits: number; rate: number; littleEndian: boolean } | null = null;
        let sound: { start: number; end: number } | null = null;
        let at = 12;
        while (at + 8 <= bytes.length) {
            const size = view.getUint32(at + 4);
            const body = at + 8;
            if (hasAscii(bytes, at, 'COMM')) {
                if (size < 18 || body + 18 > bytes.length) return null;
                let littleEndian = false;
                if (compressed) {
                    if (size < 22 || body + 22 > bytes.length) return null;
                    if (hasAscii(bytes, body + 18, 'sowt')) littleEndian = true;
                    else if (!hasAscii(bytes, body + 18, 'NONE')) return null;
                }
                format = { channels: view.getUint16(body), frames: view.getUint32(body + 2), bits: view.getUint16(body + 6), rate: readExtended(view, body + 8), littleEndian };
            } else if (hasAscii(bytes, at, 'SSND')) {
                if (size < 8 || body + 8 > bytes.length) return null;
                sound = { start: body + 8 + view.getUint32(body), end: Math.min(body + size, bytes.length) };
            }
            at = body + size + (size % 2);
        }
        if (!format || !sound) return null;
        const { channels, bits, littleEndian } = format;
        const rate = Math.round(format.rate);
        if (channels < 1 || channels > 8 || ![8, 16, 24, 32].includes(bits) || !(rate >= 1 && rate <= 384_000)) return null;
        const width = bits / 8;
        const frames = Math.min(format.frames, Math.floor(Math.max(0, sound.end - sound.start) / (width * channels)));
        if (frames <= 0) return null;
        const samples = frames * channels;

        const out = new Uint8Array(44 + samples * 2);
        const wav = new DataView(out.buffer);
        writeAscii(out, 0, 'RIFF');
        wav.setUint32(4, 36 + samples * 2, true);
        writeAscii(out, 8, 'WAVE');
        writeAscii(out, 12, 'fmt ');
        wav.setUint32(16, 16, true);
        wav.setUint16(20, 1, true);
        wav.setUint16(22, channels, true);
        wav.setUint32(24, rate, true);
        wav.setUint32(28, rate * channels * 2, true);
        wav.setUint16(32, channels * 2, true);
        wav.setUint16(34, 16, true);
        writeAscii(out, 36, 'data');
        wav.setUint32(40, samples * 2, true);
        for (let i = 0; i < samples; i++) wav.setInt16(44 + i * 2, readSample16(view, sound.start + i * width, bits, littleEndian), true);
        return out;
    } catch {
        return null;
    }
}
