import { useEffect, useState } from 'react';

/*
 * What every place that draws a clock's digits shares: the Timers pane, and
 * the game's header while no Timers pane is beside the game.
 */

/** Each digit tone `clockTone` decides, as the class that draws it. */
export const TONE_CLASS = { alarm: 'text-alarm', gold: 'text-gold', dim: 'text-dim' } as const;

/**
 * How often the digits are redrawn while a clock runs. Only the drawing: each
 * redraw reads the value from main's snapshot, so a slow interval makes a digit
 * change late, never wrong — and the alert is main's, not this interval's.
 */
const DRAW_EVERY_MS = 250;

/** `Date.now()`, redrawn on that interval while `active`, and left alone while nothing runs. */
export function useNow(active: boolean): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!active) return;
        setNow(Date.now());
        const interval = window.setInterval(() => setNow(Date.now()), DRAW_EVERY_MS);
        return () => window.clearInterval(interval);
    }, [active]);
    return now;
}
