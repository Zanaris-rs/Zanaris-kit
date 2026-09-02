import { test } from 'node:test';
import assert from 'node:assert/strict';
import Isaac from './isaac.ts';
import { FrameSplitter, trialFrame, type FramedPacket } from './frame.ts';
import { SERVER_PROT } from '../shared/proto/rev289.gen.ts';

const SEED = [33158998, 99859750, 12931227, 1753455222];

/** Build a stream the way the engine does: opcode + isaac.nextInt(), then length, then body. */
function encode(packets: Array<{ opcode: number; payload: number[] }>, seed: number[]): Uint8Array {
    const isaac = new Isaac([...seed]);
    const out: number[] = [];
    for (const { opcode, payload } of packets) {
        const def = SERVER_PROT[opcode]!;
        out.push((opcode + isaac.nextInt()) & 0xff);
        if (def.length === -1) out.push(payload.length);
        else if (def.length === -2) out.push((payload.length >> 8) & 0xff, payload.length & 0xff);
        out.push(...payload);
    }
    return Uint8Array.from(out);
}

const UPDATE_STAT = 154; // length 6
const IF_CLOSE = 23; // length 0
const MESSAGE_GAME = SERVER_PROT.findIndex(p => p?.name === 'MESSAGE_GAME'); // length -1

function collect(stream: Uint8Array, chunk?: number): FramedPacket[] {
    const got: FramedPacket[] = [];
    const s = new FrameSplitter(new Isaac([...SEED]), p => got.push(p));
    if (chunk === undefined) s.push(stream);
    else for (let i = 0; i < stream.length; i += chunk) s.push(stream.subarray(i, i + chunk));
    assert.equal(s.desynced, false, s.desyncReason ?? '');
    return got;
}

test('frames fixed-length packets and decrypts opcodes', () => {
    const stream = encode(
        [
            { opcode: UPDATE_STAT, payload: [0, 0, 0, 4, 210, 5] },
            { opcode: UPDATE_STAT, payload: [1, 0, 0, 1, 44, 3] }
        ],
        SEED
    );
    const got = collect(stream);
    assert.equal(got.length, 2);
    assert.equal(got[0]!.def.name, 'UPDATE_STAT');
    assert.deepEqual([...got[0]!.payload], [0, 0, 0, 4, 210, 5]);
    assert.deepEqual([...got[1]!.payload], [1, 0, 0, 1, 44, 3]);
});

test('handles zero-length packets and u8 length prefixes', () => {
    const body = [...Buffer.from('Welcome to Lost City.', 'latin1'), 10];
    const stream = encode(
        [
            { opcode: IF_CLOSE, payload: [] },
            { opcode: MESSAGE_GAME, payload: body },
            { opcode: UPDATE_STAT, payload: [6, 0, 1, 0, 0, 40] }
        ],
        SEED
    );
    const got = collect(stream);
    assert.deepEqual(got.map(p => p.def.name), ['IF_CLOSE', 'MESSAGE_GAME', 'UPDATE_STAT']);
    assert.equal(got[1]!.payload.length, body.length);
});

test('reassembles packets split across arbitrary chunk boundaries', () => {
    const packets = Array.from({ length: 40 }, (_, i) => ({
        opcode: UPDATE_STAT,
        payload: [i % 20, 0, 0, 0, i, 1]
    }));
    const stream = encode(packets, SEED);
    const whole = collect(stream);
    for (const chunk of [1, 2, 3, 5, 7, 13]) {
        const split = collect(stream, chunk);
        assert.equal(split.length, whole.length, `chunk size ${chunk}`);
        assert.deepEqual(
            split.map(p => [...p.payload]),
            whole.map(p => [...p.payload]),
            `chunk size ${chunk}`
        );
    }
});

test('reports desync on an unknown opcode rather than guessing', () => {
    const stream = encode([{ opcode: UPDATE_STAT, payload: [0, 0, 0, 0, 1, 1] }], SEED);
    const s = new FrameSplitter(new Isaac([1, 2, 3, 4]), () => {});
    s.push(stream);
    assert.equal(s.desynced, true);
    assert.match(s.desyncReason!, /unknown opcode/);
});

test('trialFrame accepts the right seed and rejects wrong ones', () => {
    const packets = Array.from({ length: 10 }, (_, i) => ({ opcode: UPDATE_STAT, payload: [i, 0, 0, 0, i, 1] }));
    const stream = encode(packets, SEED);

    assert.equal(trialFrame(stream, SEED, 6), 'ok');
    assert.equal(trialFrame(stream, [SEED[0]! + 1, SEED[1]!, SEED[2]!, SEED[3]!], 6), 'fail');
    assert.equal(trialFrame(stream, [0, 0, 0, 0], 6), 'fail');
    assert.equal(trialFrame(stream.subarray(0, 3), SEED, 6), 'need-more');
});
