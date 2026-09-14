/**
 * Plays a timer's alert at that clock's volume. The bytes come from main and
 * are decoded once; a fetch or decode that fails is forgotten, so the next
 * alert tries again, and until one succeeds the banner and the red digits are
 * what is left.
 */

let context: AudioContext | null = null;
let decoded: Promise<AudioBuffer | null> | null = null;

async function decode(): Promise<AudioBuffer | null> {
    const bytes = await window.zanaris.timers.sound();
    if (!bytes) return null;
    context ??= new AudioContext();
    // decodeAudioData takes its buffer away from the caller, so it is given a copy of its own.
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    return context.decodeAudioData(copy);
}

function sound(): Promise<AudioBuffer | null> {
    decoded ??= decode().then(
        buffer => {
            if (!buffer) decoded = null;
            return buffer;
        },
        () => {
            decoded = null;
            return null;
        }
    );
    return decoded;
}

export async function playAlert(volume: number): Promise<void> {
    if (!(volume > 0)) return;
    const buffer = await sound();
    if (!buffer || !context) return;
    if (context.state === 'suspended') await context.resume();
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = context.createGain();
    gain.gain.value = Math.min(1, volume);
    source.connect(gain).connect(context.destination);
    source.start();
}
