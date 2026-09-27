import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeAll, writeWhole } from './wholeFile.ts';

const dirs: string[] = [];
const tempDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'zanaris-kit-whole-'));
    dirs.push(dir);
    return dir;
};
afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test('writeWhole replaces the contents and leaves nothing beside the file', () => {
    const file = join(tempDir(), 'state.json');
    writeFileSync(file, 'old');
    writeWhole(file, 'new');
    assert.equal(readFileSync(file, 'utf8'), 'new');
    assert.equal(existsSync(`${file}.incoming`), false);
});

test('writeWhole makes a file that was not there', () => {
    const file = join(tempDir(), 'servers.json');
    writeWhole(file, '{}\n');
    assert.equal(readFileSync(file, 'utf8'), '{}\n');
});

test('a write that fails leaves the old contents whole', () => {
    const file = join(tempDir(), 'state.json');
    writeFileSync(file, 'old');
    // A directory where the incoming file goes: the write fails before anything touches the file itself.
    mkdirSync(`${file}.incoming`);
    assert.throws(() => writeWhole(file, 'new'));
    assert.equal(readFileSync(file, 'utf8'), 'old');
});

test('writeAll keeps writing after a short write, and refuses one that writes nothing', () => {
    const written: number[] = [];
    const bytes = Uint8Array.from([1, 2, 3, 4, 5, 6, 7]);
    // At most three bytes a call, as a disk filling up might allow.
    writeAll(0, bytes, (_fd, from, offset, length) => {
        const n = Math.min(3, length);
        written.push(...from.subarray(offset, offset + n));
        return n;
    });
    assert.deepEqual(written, [1, 2, 3, 4, 5, 6, 7]);
    assert.throws(() => writeAll(0, bytes, () => 0), /wrote 0 of 7 bytes/);
});
