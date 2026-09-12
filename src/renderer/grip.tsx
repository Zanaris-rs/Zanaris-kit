import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';

/**
 * A draggable edge between two regions, and — for anyone without a pointer — a
 * separator that answers arrow keys.
 *
 * It lives here rather than in the shell because there is one per seam, and a
 * window has as many seams as the user has made splits. They differ in an axis,
 * a label and which number they move, and in nothing else — every line below
 * about frames, echoes and the exact ceiling was written once and paid for
 * twice over in the getting-right. A second copy would be a second copy to keep
 * in step, and the half that drifted would be the half nobody was dragging that
 * week.
 *
 * `value` is the size of the pane *before* the seam — the one to its left on an
 * 'x' split, the one above it on a 'y' split — so the pointer and the number
 * run the same way on both axes: moving the seam forward along its axis, right
 * or down, gives that pane more room, and moving it back takes room away. The
 * arrow keys follow the seam rather than the number, so Right and Down grow the
 * pane before it too, which is also what a separator's arrows are expected to
 * do: they move the divider in the direction they point.
 *
 * Neither path clamps. Main owns the range, and restating it here would be a
 * second copy of that to keep in step too.
 *
 * `requested` tracks the value this component believes is current. Outside a
 * drag `send` is the only thing allowed to move it: it sets `requested` to the
 * number being asked for, then — once `apply` resolves — sets it again to
 * whatever main actually applied. That second write is not optional. Main
 * skips its own layout work when a request lands exactly where the region
 * already is, which happens at both ends of the range: one more ArrowUp at
 * the floor, an End already at the ceiling. Without a reply to correct it,
 * `requested` would be left holding the out-of-range number it optimistically
 * guessed, and every later key press would build the next request on that
 * wrong number instead of the real one. Resolving `apply` with the applied
 * value, on every path including the one that changes nothing, is what makes
 * this safe rather than a renderer-side clamp of our own.
 */

/** A fine nudge, and Shift for the coarse one — a stroke of a drag in one press. */
const STEP = 10;
const STEP_COARSE = 50;

export default function Grip({
    axis,
    value,
    min,
    label,
    announceMax,
    reachMax,
    apply
}: {
    /** 'y' for an edge dragged up and down, 'x' for one dragged left and right. */
    axis: 'x' | 'y';
    /** The size the region currently has, as main last reported it. */
    value: number;
    min: number;
    label: string;
    /**
     * The ceiling to announce, which is not always the one to ask for. Where
     * main sends its own, this is exact; where it does not, it is the same
     * idea measured from this side of the glass, and `exactMax` below corrects
     * it the first time a request overshoots.
     */
    announceMax: () => number;
    /**
     * What End asks for. Deliberately at or above the true ceiling, so main's
     * clamp is what decides where End lands rather than an estimate that might
     * fall short — and a real quantity rather than a sentinel, so a reply that
     * fails to arrive leaves `requested` at a plausible number rather than a
     * nine-quadrillion one.
     */
    reachMax: () => number;
    /** Resolves with the value main actually applied, after its own clamp. */
    apply: (px: number) => Promise<number>;
}): ReactNode {
    const requested = useRef(value);
    const drag = useRef<{ pointerId: number; start: number; startValue: number } | null>(null);
    /*
     * Every frame of a drag ends in a layout, and every layout pushes state, so
     * this fires once a frame while the pointer is down — and while it is down
     * the pointer owns `requested`, not the echo. A push landing between a
     * pointermove and its frame would otherwise overwrite the position being
     * aimed at with the one already applied, spending that frame on a request
     * for the size the region is already at; one landing just before pointerup
     * would lose the release position outright. The echo is authoritative
     * again the moment the drag ends, which is when this effect has something
     * to say: a value that moved for a reason that was not this pointer.
     */
    useEffect(() => {
        if (drag.current) return;
        requested.current = value;
    }, [value]);

    /* The id of a scheduled frame, or null when none is pending. */
    const frame = useRef<number | null>(null);
    /* A pending frame calling back into an unmounted component would still reach main; nothing here needs that after the grip is gone. */
    useEffect(() => () => {
        if (frame.current !== null) cancelAnimationFrame(frame.current);
    }, []);

    /**
     * The exact ceiling, learned rather than guessed, the moment any request
     * overshoots it: main clamping a request down (`applied < px`) can only
     * mean the ceiling itself is `applied`. Until that happens this is null
     * and the announcement falls back to `estimateMax`.
     */
    const [exactMax, setExactMax] = useState<number | null>(null);

    /**
     * `px` is rounded here, once, before it goes anywhere else. A fractional
     * pixel size is meaningless — pointer coordinates are fractional on any
     * HiDPI display, which is routine — and without this, `applied < px` stops
     * meaning "main clamped this": main rounds too, so an unrounded request
     * like 200.33 comes back as 200 from ordinary rounding, no ceiling
     * involved, and would have latched `exactMax` onto an arbitrary drag
     * position forever. Rounding is not clamping — it does not narrow the
     * range main enforces, only the precision of what is asked for — so it
     * does not cross the line about main being the authority.
     */
    const send = (px: number): void => {
        const rounded = Math.round(px);
        requested.current = rounded;
        void apply(rounded).then(applied => {
            // Stands aside for a live drag for the same reason the effect
            // above does, and it is not a different race: main answers this
            // call in the same breath as it pushes the state that effect
            // watches, so a reply folded in mid-drag puts the target back on
            // the frame the pointer has already moved past — and one landing
            // between the last pointermove and pointerup takes the release
            // position with it. Nothing in a drag needs the reply: each
            // pointermove recomputes the size from where the drag began, so
            // it cannot inherit a stale one, and the release's own send is
            // made after `drag` is cleared and does fold its answer in.
            if (!drag.current) requested.current = applied;
            if (applied < rounded) setExactMax(applied);
        });
    };

    const along = (event: PointerEvent<HTMLDivElement>): number => (axis === 'y' ? event.clientY : event.clientX);

    const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, start: along(event), startValue: requested.current };
    };

    /*
     * The OS can report pointer movement far faster than the shell repaints,
     * and each repaint is a full layout — so only the freshest position
     * survives to the next frame. A frame already pending is left alone and
     * just has its target replaced; a fresh one is scheduled only once nothing
     * is in flight. That is what keeps a fast drag from queuing a pile of
     * requests behind the one that already supersedes them all.
     */
    const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
        const d = drag.current;
        if (!d || event.pointerId !== d.pointerId) return;
        // Forward along the axis is bigger: the seam reports the pane before it,
        // so pushing the seam away from that pane is what gives it more room.
        requested.current = d.startValue + (along(event) - d.start);
        if (frame.current === null) {
            frame.current = requestAnimationFrame(() => {
                frame.current = null;
                send(requested.current);
            });
        }
    };

    const endDrag = (event: PointerEvent<HTMLDivElement>): void => {
        if (!drag.current || event.pointerId !== drag.current.pointerId) return;
        drag.current = null;
        if (frame.current !== null) {
            cancelAnimationFrame(frame.current);
            frame.current = null;
        }
        // The frame just cancelled may never have run, so the release position
        // is sent once here rather than left to whichever pointermove queued it —
        // otherwise the last pixel of a drag could go unsent and unpersisted.
        send(requested.current);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        const step = event.shiftKey ? STEP_COARSE : STEP;
        // The same way round as the pointer: the arrow that moves the seam
        // forward is the one that grows the pane behind it.
        const grow = axis === 'y' ? 'ArrowDown' : 'ArrowRight';
        const shrink = axis === 'y' ? 'ArrowUp' : 'ArrowLeft';
        switch (event.key) {
            case grow:
                send(requested.current + step);
                break;
            case shrink:
                send(requested.current - step);
                break;
            case 'Home':
                send(min);
                break;
            case 'End':
                send(reachMax());
                break;
            default:
                return;
        }
        event.preventDefault();
    };

    /*
     * Floored at `value`: `exactMax` is only ever refreshed when a request
     * happens to overshoot it, so a window dragged onto a display with a
     * larger ceiling after `exactMax` was learned on a smaller one would
     * otherwise leave the announcement stale and, if the region has since
     * grown past that stale number, smaller than `aria-valuenow` — an invalid
     * ARIA state. `value` is always current and always within the true
     * ceiling, so it is a safe floor regardless of how stale `exactMax` gets.
     */
    const announcedMax = Math.max(value, exactMax ?? announceMax());

    return (
        <div
            role="separator"
            /* The separator's own orientation is the line it draws, which is across the axis it moves along. */
            aria-orientation={axis === 'y' ? 'horizontal' : 'vertical'}
            aria-label={label}
            aria-valuenow={value}
            aria-valuemin={min}
            aria-valuemax={announcedMax}
            tabIndex={0}
            className={axis === 'y' ? 'grip grip-y absolute inset-x-0 top-0 h-1' : 'grip grip-x absolute inset-y-0 left-0 w-full'}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onLostPointerCapture={endDrag}
            onKeyDown={onKeyDown}
        />
    );
}
