import { closeSync, fsyncSync, openSync, renameSync, writeSync } from 'node:fs';

type Write = (fd: number, bytes: Uint8Array, offset: number, length: number) => number;

/**
 * Every byte, however many calls it takes. One `writeSync` can write part of
 * what it was given and return the count rather than throw — a disk filling
 * mid-write is exactly that — and a count ignored is a file cut short, which
 * the rename would then put over the good one. `write` is injected so a test
 * can make the writes short.
 */
export function writeAll(fd: number, bytes: Uint8Array, write: Write = writeSync): void {
    let done = 0;
    while (done < bytes.length) {
        const wrote = write(fd, bytes, done, bytes.length - done);
        if (wrote <= 0) throw new Error(`wrote ${done} of ${bytes.length} bytes`);
        done += wrote;
    }
}

/**
 * Replaces a file's contents whole or not at all.
 *
 * A plain `writeFileSync` truncates the file first and writes after, so a
 * crash, a power cut or a full disk between the two leaves it empty or cut
 * short — and `state.json` or `servers.json` cut short is set aside at the next
 * launch, taking everything the player had saved with it. This writes the text
 * beside the file, flushes it to the disk, and only then renames it over the
 * old one, which the file system does in one step: a reader finds the old
 * contents or the new, never half of either.
 *
 * The flush is what makes the rename safe across a power cut: without it the
 * rename can reach the disk before the bytes it names do.
 */
export function writeWhole(file: string, text: string): void {
    const incoming = `${file}.incoming`;
    const fd = openSync(incoming, 'w');
    try {
        writeAll(fd, Buffer.from(text, 'utf8'));
        fsyncSync(fd);
    } finally {
        closeSync(fd);
    }
    renameSync(incoming, file);
}
