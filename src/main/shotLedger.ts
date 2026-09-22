import { createHash } from 'node:crypto';

/**
 * The shell shots one capture run has written, by content.
 *
 * Every shell shot is taken after a step that changes what the shell draws,
 * so two with the same bytes mean one of them does not show its step. Usually
 * that is a stale frame: capturePage hands back the last frame a view
 * composited, and a shell that has stopped painting composites nothing new.
 * That is the capture hazard in CLAUDE.md, and its log line reads as correct
 * as any other, so the run compares the bytes itself. It has also caught a
 * step whose change was gone by the time of its shot, which is as wrong a
 * picture of that step as a stale frame.
 */
export class ShotLedger {
    private readonly seen = new Map<string, string>();

    /** Records a shot, and names the earlier one with the same bytes, if there is one. */
    record(name: string, png: Uint8Array): string | null {
        const digest = createHash('sha256').update(png).digest('hex');
        const twin = this.seen.get(digest);
        if (twin !== undefined) return twin;
        this.seen.set(digest, name);
        return null;
    }
}
