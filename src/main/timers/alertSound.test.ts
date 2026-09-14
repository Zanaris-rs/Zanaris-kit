import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The one sound every alert plays, `static/sounds/alert.wav`. It is an asset
 * rather than code, so what is tested is what the shell and the owner rely on:
 * that Chromium can decode it (plain 16-bit PCM WAV), that it is short, and
 * that it is loud — the system sound it replaced was too quiet to hear over
 * the game, and a later swap to a quieter file should fail here, not in play.
 */

function readWav(bytes: Buffer): { format: number; channels: number; rate: number; bits: number; samples: Int16Array } {
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
    let at = 12;
    let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
    while (at + 8 <= bytes.length) {
        const id = bytes.toString('ascii', at, at + 4);
        const size = bytes.readUInt32LE(at + 4);
        const body = at + 8;
        if (id === 'fmt ') fmt = { format: bytes.readUInt16LE(body), channels: bytes.readUInt16LE(body + 2), rate: bytes.readUInt32LE(body + 4), bits: bytes.readUInt16LE(body + 14) };
        if (id === 'data') {
            assert.ok(fmt, 'fmt comes before data');
            const count = Math.floor(Math.min(size, bytes.length - body) / 2);
            const samples = new Int16Array(count);
            for (let i = 0; i < count; i++) samples[i] = bytes.readInt16LE(body + i * 2);
            return { ...fmt, samples };
        }
        at = body + size + (size % 2);
    }
    assert.fail('no data chunk');
}

const dbfs = (level: number): number => 20 * Math.log10(level / 32768);

test('the alert is 16-bit PCM WAV that Chromium decodes', () => {
    const wav = readWav(readFileSync('static/sounds/alert.wav'));
    assert.equal(wav.format, 1, 'PCM');
    assert.equal(wav.bits, 16);
    assert.equal(wav.channels, 1);
    assert.equal(wav.rate, 44_100);
});

test('the alert is short', () => {
    const wav = readWav(readFileSync('static/sounds/alert.wav'));
    const seconds = wav.samples.length / wav.channels / wav.rate;
    assert.ok(seconds > 0.2 && seconds < 1, `${seconds.toFixed(3)} s`);
});

test('the alert is loud without clipping', () => {
    const { samples } = readWav(readFileSync('static/sounds/alert.wav'));
    let peak = 0;
    let sumSquares = 0;
    for (const s of samples) {
        peak = Math.max(peak, Math.abs(s));
        sumSquares += s * s;
    }
    const rms = Math.sqrt(sumSquares / samples.length);
    assert.ok(dbfs(peak) > -2 && peak < 32767, `peak ${dbfs(peak).toFixed(1)} dBFS`);
    assert.ok(dbfs(rms) > -13, `rms ${dbfs(rms).toFixed(1)} dBFS`);
});
