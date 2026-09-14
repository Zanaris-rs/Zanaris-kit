import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LINUX_ALERTS, MAC_DEFAULT_ALERT, SOUND_BYTES_MAX, aiffToWav, alertSoundCandidates, expandWindowsVars, parseRegDefault, sniff, toPlayable } from './sound.ts';

const u16 = (n: number): number[] => [(n >> 8) & 0xff, n & 0xff];
const u32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const chars = (s: string): number[] => [...s].map(c => c.charCodeAt(0));

/** An 80-bit IEEE extended float, as AIFF stores its sample rate. Whole-number rates only. */
function extended80(rate: number): number[] {
    const exponent = Math.floor(Math.log2(rate));
    const mantissa = BigInt(rate) << BigInt(63 - exponent);
    const bytes = u16(16383 + exponent);
    for (let shift = 56n; shift >= 0n; shift -= 8n) bytes.push(Number((mantissa >> shift) & 0xffn));
    return bytes;
}

/** Builds an AIFF (or AIFF-C with `compression`) holding these interleaved samples at this bit depth. */
function aiff(opts: { bits: 8 | 16 | 24 | 32; channels: number; rate: number; samples: number[]; compression?: 'NONE' | 'sowt' | 'ima4' }): Uint8Array {
    const width = opts.bits / 8;
    const data: number[] = [];
    for (const sample of opts.samples) {
        const big: number[] = [];
        for (let i = width - 1; i >= 0; i--) big.push((sample >> (i * 8)) & 0xff);
        data.push(...(opts.compression === 'sowt' ? big.reverse() : big));
    }
    const aifc = opts.compression !== undefined;
    const comm = [...u16(opts.channels), ...u32(opts.samples.length / opts.channels), ...u16(opts.bits), ...extended80(opts.rate), ...(aifc ? [...chars(opts.compression!), 0, 0] : [])];
    const chunks = [
        ...(aifc ? [...chars('FVER'), ...u32(4), ...u32(0xa2805140)] : []),
        ...chars('COMM'),
        ...u32(comm.length),
        ...comm,
        ...chars('SSND'),
        ...u32(8 + data.length),
        ...u32(0),
        ...u32(0),
        ...data,
        ...(data.length % 2 ? [0] : [])
    ];
    return new Uint8Array([...chars('FORM'), ...u32(4 + chunks.length), ...chars(aifc ? 'AIFC' : 'AIFF'), ...chunks]);
}

function readWav(wav: Uint8Array): { channels: number; rate: number; bits: number; samples: number[] } {
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    assert.equal(sniff(wav), 'wav');
    const count = view.getUint32(40, true) / 2;
    return {
        channels: view.getUint16(22, true),
        rate: view.getUint32(24, true),
        bits: view.getUint16(34, true),
        samples: Array.from({ length: count }, (_, i) => view.getInt16(44 + i * 2, true))
    };
}

test('macOS tries the chosen alert sound, then the one CoreAudio falls back to', () => {
    const facts = { macAlert: '/System/Library/Sounds/Glass.aiff', windowsDefault: null, env: {} };
    assert.deepEqual(alertSoundCandidates('darwin', facts), ['/System/Library/Sounds/Glass.aiff', MAC_DEFAULT_ALERT]);
    assert.deepEqual(alertSoundCandidates('darwin', { ...facts, macAlert: null }), [MAC_DEFAULT_ALERT]);
    assert.deepEqual(alertSoundCandidates('darwin', { ...facts, macAlert: MAC_DEFAULT_ALERT }), [MAC_DEFAULT_ALERT]);
});

test('Windows tries its default sound with the variables in its path expanded', () => {
    const facts = { macAlert: null, windowsDefault: '%SystemRoot%\\media\\Windows Background.wav', env: { SYSTEMROOT: 'C:\\Windows' } };
    assert.deepEqual(alertSoundCandidates('win32', facts), ['C:\\Windows\\media\\Windows Background.wav']);
    assert.deepEqual(alertSoundCandidates('win32', { ...facts, windowsDefault: null }), []);
    assert.equal(expandWindowsVars('%Nope%\\a.wav', {}), '%Nope%\\a.wav', 'an unknown variable is left as written');
});

test('Linux tries the freedesktop sounds, and anything else tries nothing', () => {
    const facts = { macAlert: null, windowsDefault: null, env: {} };
    assert.deepEqual(alertSoundCandidates('linux', facts), [...LINUX_ALERTS]);
    assert.deepEqual(alertSoundCandidates('freebsd', facts), []);
});

test('the registry default is read from reg query output, whatever the label is called', () => {
    const english = '\r\nHKEY_CURRENT_USER\\AppEvents\\Schemes\\Apps\\.Default\\.Default\\.Current\r\n    (Default)    REG_EXPAND_SZ    %SystemRoot%\\media\\Windows Background.wav\r\n\r\n';
    assert.equal(parseRegDefault(english), '%SystemRoot%\\media\\Windows Background.wav');
    assert.equal(parseRegDefault('    (Standard)    REG_SZ    C:\\sounds\\ding.wav'), 'C:\\sounds\\ding.wav');
    assert.equal(parseRegDefault('    (Default)    REG_SZ\r\n'), null, 'no sound chosen');
    assert.equal(parseRegDefault(''), null);
});

test('formats Chromium decodes pass through untouched', () => {
    const cases: [string, number[]][] = [
        ['wav', [...chars('RIFF'), 0, 0, 0, 0, ...chars('WAVE')]],
        ['ogg', chars('OggS')],
        ['flac', chars('fLaC')],
        ['mp3', chars('ID3')],
        ['mp3', [0xff, 0xfb, 0x90, 0x00]],
        ['mp4', [0, 0, 0, 0x20, ...chars('ftypM4A ')]]
    ];
    for (const [format, header] of cases) {
        const bytes = new Uint8Array([...header, 1, 2, 3]);
        assert.equal(sniff(bytes), format);
        assert.equal(toPlayable(bytes), bytes, format);
    }
});

test('a 24-bit stereo AIFF, the shape of macOS system sounds, becomes 16-bit WAV', () => {
    const samples = [0x123456, -0x123456, 0x7fffff, -0x800000];
    const wav = readWav(toPlayable(aiff({ bits: 24, channels: 2, rate: 48_000, samples }))!);
    assert.deepEqual(wav, { channels: 2, rate: 48_000, bits: 16, samples: samples.map(s => s >> 8) });
});

test('8-, 16- and 32-bit AIFF convert with their samples intact', () => {
    assert.deepEqual(readWav(aiffToWav(aiff({ bits: 16, channels: 1, rate: 44_100, samples: [1000, -1000, 32767, -32768] }))!).samples, [1000, -1000, 32767, -32768]);
    assert.deepEqual(readWav(aiffToWav(aiff({ bits: 8, channels: 1, rate: 22_050, samples: [100, -100, 127, -128] }))!).samples, [25600, -25600, 32512, -32768]);
    assert.deepEqual(readWav(aiffToWav(aiff({ bits: 32, channels: 1, rate: 44_100, samples: [0x12345678, -0x12345678] }))!).samples, [0x1234, -0x12345678 >> 16]);
    assert.equal(readWav(aiffToWav(aiff({ bits: 16, channels: 1, rate: 44_100, samples: [0] }))!).rate, 44_100);
});

test('uncompressed AIFF-C converts, little-endian sowt included; compressed AIFF-C does not', () => {
    const samples = [1000, -1000, 32767, -32768];
    assert.deepEqual(readWav(toPlayable(aiff({ bits: 16, channels: 2, rate: 44_100, samples, compression: 'sowt' }))!).samples, samples);
    assert.deepEqual(readWav(toPlayable(aiff({ bits: 24, channels: 1, rate: 48_000, samples: [0x123456], compression: 'NONE' }))!).samples, [0x1234]);
    // 24-bit stereo sowt: little-endian branch of readSample16 must handle 24-bit correctly
    const samples24 = [0x123456, -0x123456, 0x7fffff, -0x800000];
    assert.deepEqual(readWav(toPlayable(aiff({ bits: 24, channels: 2, rate: 48_000, samples: samples24, compression: 'sowt' }))!).samples, samples24.map(s => s >> 8));
    assert.equal(toPlayable(aiff({ bits: 16, channels: 1, rate: 44_100, samples, compression: 'ima4' })), null);
});

test('what cannot be played is refused rather than handed on', () => {
    assert.equal(toPlayable(new Uint8Array()), null);
    assert.equal(toPlayable(new Uint8Array([...chars('caff'), 0, 1, 0, 0])), null, 'Core Audio Format');
    assert.equal(toPlayable(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])), null);
    const header = new Uint8Array([...chars('FORM'), ...u32(4), ...chars('AIFF')]);
    assert.equal(toPlayable(header), null, 'an AIFF with no chunks');
    const truncated = aiff({ bits: 16, channels: 1, rate: 44_100, samples: [1, 2, 3] }).slice(0, 40);
    assert.equal(toPlayable(truncated), null, 'an AIFF cut off before its sound');
    const huge = new Uint8Array(SOUND_BYTES_MAX + 1);
    huge.set([...chars('RIFF'), 0, 0, 0, 0, ...chars('WAVE')]);
    assert.equal(toPlayable(huge), null, 'over the size cap');
});

test('the bundled chime is always playable, and short', () => {
    const bytes = new Uint8Array(readFileSync('static/sounds/chime.wav'));
    assert.equal(toPlayable(bytes), bytes);
    const wav = readWav(bytes);
    assert.equal(wav.channels, 1);
    assert.equal(wav.rate, 44_100);
    assert.equal(wav.bits, 16);
    assert.ok(wav.samples.length / wav.rate < 0.5);
    assert.ok(wav.samples.some(s => Math.abs(s) > 10_000), 'and audible');
});

test('a frame count or sound offset that overruns the data is clamped or refused, never over-read', () => {
    // Frame count larger than SSND payload should be clamped
    let bytes = aiff({ bits: 16, channels: 1, rate: 44_100, samples: [1000, -1000, 32767] });
    const view = new DataView(bytes.buffer);
    // Find COMM chunk: starts at byte 12 (after 'FORM', size, 'AIFF'), then 'COMM' tag at 12
    // COMM structure: tag (4) + size (4) + channels (2) + frameCount (4) = first u32 at offset 22
    view.setUint32(22, 1000, false); // big-endian, set frame count to 1000 (much larger than 3 samples)
    const wav = readWav(aiffToWav(bytes)!);
    assert.deepEqual(wav.samples, [1000, -1000, 32767], 'frame count clamped to available data');

    // SSND offset that pushes sound start past the data should return null
    bytes = aiff({ bits: 16, channels: 1, rate: 44_100, samples: [1000, -1000, 32767] });
    // Locate 'SSND' tag by scanning
    let ssndIndex = -1;
    for (let i = 0; i < bytes.length - 4; i++) {
        if (bytes[i] === chars('S')[0] && bytes[i + 1] === chars('S')[0] &&
            bytes[i + 2] === chars('N')[0] && bytes[i + 3] === chars('D')[0]) {
            ssndIndex = i;
            break;
        }
    }
    assert.ok(ssndIndex >= 0, 'SSND found');
    // SSND structure: tag (4) + size (4) + offset (4) = offset field at ssndIndex + 8
    const dv = new DataView(bytes.buffer);
    dv.setUint32(ssndIndex + 8, 1000, false); // big-endian, set offset to 1000 (beyond data)
    assert.equal(aiffToWav(bytes), null, 'offset overrun refused');
});
