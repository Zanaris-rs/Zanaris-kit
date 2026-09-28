/*
 * How a section fills the Home server tool, by the tool's shape
 * (`WIDE_ENOUGH`, in HomeServer.tsx).
 *
 * Wide, the tool is as tall as its pane and a section's list scrolls inside
 * it, with what sits above and below the list always in view. Narrow, there
 * is not the height for that: at `PANE_MIN_WIDTH` Commands' notes, search and
 * filters wrap to about 480px above its list, which under the tool's header
 * and menu of sections leaves the list about 160px of an 800px pane and none
 * of a 500px one. So narrow, what is under the header and the menu scrolls as
 * one page instead, and a list grows to fill whatever room there is but never
 * shrinks below what it holds.
 */

/** A section's column. */
export function sectionClass(wide: boolean): string {
    return wide ? 'flex min-h-0 flex-1 flex-col gap-2' : 'flex flex-1 flex-col gap-2';
}

/** The part of a section that scrolls while the tool is wide: its list, World's settings, or the whole of Friends. */
export function scrollClass(wide: boolean): string {
    return wide ? 'min-h-0 flex-1 overflow-y-auto' : 'flex-1';
}
