/*
 * How a section fills the Your world tool, by the tool's shape
 * (`WIDE_ENOUGH`, in YourWorld.tsx).
 *
 * Wide, the tool is as tall as its pane and a section's list scrolls inside
 * it, with what sits above and below the list always in view. Narrow, there
 * is not the height for that: at `PANE_MIN_WIDTH` the tool's header and its
 * row of sections wrap to about 250px, and under them and Commands' notes and
 * search the list of commands was left 24px of an 800px pane. So narrow, the
 * tool scrolls as one page instead, and a list grows to fill whatever room
 * there is but never shrinks below what it holds.
 */

/** A section's column. */
export function sectionClass(wide: boolean): string {
    return wide ? 'flex min-h-0 flex-1 flex-col gap-2' : 'flex flex-1 flex-col gap-2';
}

/** The part of a section that scrolls while the tool is wide: its list, World's settings, or the whole of Friends. */
export function scrollClass(wide: boolean): string {
    return wide ? 'min-h-0 flex-1 overflow-y-auto' : 'flex-1';
}
