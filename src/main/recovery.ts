/**
 * How often the kit reloads a page by itself after its renderer has gone.
 *
 * A game window's shell and Settings are reloaded without asking when their
 * renderer crashes, since each is the kit's own page and a window with none
 * has no chrome to offer anything from. A page that crashes as it loads would
 * then be reloaded forever, a process a second, so the reloads are counted:
 * up to `max` in any `windowMs`, and none after that until the count ages out.
 */
export class Recoveries {
    private readonly max: number;
    private readonly windowMs: number;
    private readonly times: number[] = [];

    constructor(max = 3, windowMs = 60_000) {
        this.max = max;
        this.windowMs = windowMs;
    }

    /** Whether one more may be made now, counting it when it may. */
    allow(now: number): boolean {
        while (this.times.length > 0 && now - this.times[0]! >= this.windowMs) this.times.shift();
        if (this.times.length >= this.max) return false;
        this.times.push(now);
        return true;
    }
}
