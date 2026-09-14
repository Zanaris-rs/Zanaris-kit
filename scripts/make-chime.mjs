#!/usr/bin/env node
// Writes static/sounds/chime.wav: what a timer's alert plays when the system's
// own alert sound cannot be found, read or decoded. Generated here rather than
// taken from anywhere, so it carries no licence but this repository's.
// Deterministic: running it again writes the same bytes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 44_100;
const DURATION = 0.44;
const PEAK = 0.55;
/** Two rising sine tones, the second overlapping the first's tail. */
const NOTES = [
    { freq: 880, start: 0, length: 0.2 },
    { freq: 1318.51, start: 0.12, length: 0.32 }
];

const frames = Math.round(RATE * DURATION);
const pcm = new Float64Array(frames);
for (const note of NOTES) {
    const first = Math.round(note.start * RATE);
    const count = Math.min(frames - first, Math.round(note.length * RATE));
    for (let i = 0; i < count; i++) {
        const t = i / RATE;
        const attack = Math.min(1, t / 0.005);
        const decay = Math.exp(-t * 9);
        // Faded over the last 10 ms so the note does not end on a click.
        const tail = Math.min(1, (count - i) / (0.01 * RATE));
        pcm[first + i] += Math.sin(2 * Math.PI * note.freq * t) * attack * decay * tail;
    }
}

let loudest = 0;
for (const sample of pcm) loudest = Math.max(loudest, Math.abs(sample));
const scale = loudest === 0 ? 0 : PEAK / loudest;

const out = Buffer.alloc(44 + frames * 2);
out.write('RIFF', 0, 'ascii');
out.writeUInt32LE(36 + frames * 2, 4);
out.write('WAVE', 8, 'ascii');
out.write('fmt ', 12, 'ascii');
out.writeUInt32LE(16, 16);
out.writeUInt16LE(1, 20);
out.writeUInt16LE(1, 22);
out.writeUInt32LE(RATE, 24);
out.writeUInt32LE(RATE * 2, 28);
out.writeUInt16LE(2, 32);
out.writeUInt16LE(16, 34);
out.write('data', 36, 'ascii');
out.writeUInt32LE(frames * 2, 40);
for (let i = 0; i < frames; i++) out.writeInt16LE(Math.round(pcm[i] * scale * 32767), 44 + i * 2);

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'static', 'sounds', 'chime.wav');
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, out);
console.log(`wrote ${file} (${out.length} bytes)`);
