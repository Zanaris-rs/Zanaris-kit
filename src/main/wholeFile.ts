import { closeSync, fsyncSync, openSync, renameSync, writeSync } from 'node:fs';

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
        writeSync(fd, text);
        fsyncSync(fd);
    } finally {
        closeSync(fd);
    }
    renameSync(incoming, file);
}
