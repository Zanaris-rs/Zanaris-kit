import { Fragment, type CSSProperties, type ReactNode } from 'react';
import type { Bookmark } from '../shared/worlds';
import type { PaneContentItem } from '../shared/panes';
import { OpenExternal } from './icons';
import { gameSprite, linkSprite, toolSprite } from './sprites';

/**
 * What an empty pane shows: this server's links, and the tools this window
 * offers, as one list of things the pane could become.
 *
 * It replaced the Guides panel outright, which is why `guides` is no longer a
 * tool. With a pane able to hold anything, a separate panel whose only job was
 * to list the links had nothing left to be — and a chooser in the pane it is
 * about to fill is a shorter path than a panel that opens somewhere else and
 * puts the page somewhere else again.
 *
 * The list itself is main's, built by `paneMenu.ts` and sent with the pane, so
 * the launcher and the dropdown in every pane's header cannot come to offer
 * different things. Which links a window has is the catalog's: a server with no
 * bookmarks simply shows none, which is the whole of why Lost City has forums
 * and prices here and Zanaris does not.
 */

/**
 * One row, whatever it opens. Every row carries a sprite, so the tools above
 * the rule and the links below it start their names on the same line; a row
 * with no escape hatch keeps the hatch's width empty for the same reason.
 *
 * Narrow (`WIDE_ENOUGH`), the sprite goes above the name rather than beside
 * it, with the hatch at the right of the sprite's line, so the name has the
 * row's whole width and wraps rather than truncating. Beside a sprite and a
 * hatch, a narrow pane left the names no width at all.
 */

/*
 * The row's label is a bare `<button>`, and the base `button` rule in
 * styles.css is unlayered CSS too — the same rule `.btn`/`.sunk`/`.tile` beat
 * a utility of equal specificity with (`tab.tsx`'s `PADDED` is the same fix
 * for the same reason), so `px-2 py-[6px]` on the button itself was a silent
 * no-op and the label sat flush against the well's own border. `background:
 * none` beats a background utility the same way, so the open/hover highlight
 * moved to the `<li>`, which carries no such reset — and now covers the
 * escape hatch beside the button too, which reads as one row.
 *
 * Narrow, the row's sides are 4px and the list has no padding at its sides:
 * at `PANE_MIN_WIDTH`, with the list's scrollbar showing, that leaves a name
 * 76px, and the widest word the kit's own names have, "Coordinates", is 70.
 */
const ROW_PADDING: CSSProperties = { padding: '6px 8px' };
const ROW_PADDING_NARROW: CSSProperties = { padding: '5px 4px' };

function Row({ sprite, label, open, onOpen, link, wide }: { sprite: ReactNode; label: string; open: boolean; onOpen: () => void; link?: Bookmark; wide: boolean }): ReactNode {
    /*
     * The same escape hatch LostKit's own nav offers: some of these are
     * more use on a second monitor than in a 720px column, and a link
     * the pane cannot show at all is one the browser still can.
     */
    const hatch = link && (
        <button
            type="button"
            title={`Open ${link.name} in your browser`}
            aria-label={`Open ${link.name} in your browser`}
            onClick={() => void window.zanaris.panes.openExternal(link.url)}
            className={`flex w-[30px] shrink-0 items-center justify-center text-faint hover:text-cream${wide ? '' : ' absolute top-0 right-0 h-[28px]'}`}
        >
            <OpenExternal />
        </button>
    );
    const marker = open && <span className="shrink-0 text-[12px] text-faint">open</span>;
    const highlight = open ? 'bg-stone-lit' : 'hover:bg-stone-lit/40';

    if (!wide) {
        return (
            <li className={`relative ${highlight}`}>
                <button type="button" aria-current={open ? 'true' : undefined} onClick={onOpen} style={ROW_PADDING_NARROW} className="block w-full text-left">
                    <span className="flex items-center gap-2">
                        <span className="shrink-0">{sprite}</span>
                        {marker}
                    </span>
                    <span className="block break-words">{label}</span>
                </button>
                {hatch}
            </li>
        );
    }
    return (
        <li className={`flex items-stretch ${highlight}`}>
            <button
                type="button"
                aria-current={open ? 'true' : undefined}
                onClick={onOpen}
                style={ROW_PADDING}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
            >
                <span className="shrink-0">{sprite}</span>
                {/* The title is the whole name, however much of it the row has room for. */}
                <span title={label} className="min-w-0 flex-1 truncate">
                    {label}
                </span>
                {marker}
            </button>
            {hatch ?? <span aria-hidden="true" className="w-[30px] shrink-0" />}
        </li>
    );
}

function spriteOf(item: PaneContentItem, link: Bookmark | undefined): ReactNode {
    const { content } = item;
    if (content.kind === 'tool') return toolSprite(content.tool);
    if (content.kind === 'game') return gameSprite();
    return linkSprite(link?.icon);
}

/** Keyed by what the row *does*, not by its label: two links could be named the same and still be two rows. */
function keyOf(item: PaneContentItem): string {
    const { content } = item;
    if (content.kind === 'page') return `page:${content.bookmark}`;
    if (content.kind === 'tool') return `tool:${content.tool}`;
    return content.kind;
}

/**
 * The pane width below which a row puts its sprite above its name.
 *
 * Beside a sprite and the hatch's column, a name has the pane less 118px, with
 * the list's scrollbar showing — room for the longest name the kit offers,
 * "Move game here" at 98px, from 216. A pane knows its own width, so the
 * shape is read from it, as Worlds' is.
 */
const WIDE_ENOUGH = 220;

export default function Launcher({
    paneId,
    links,
    contents,
    width
}: {
    paneId: string;
    /** The catalog's own entries, for the icons a bare menu item has no room to carry. */
    links: Bookmark[];
    /** Everything this pane could become, already named and ordered by main. */
    contents: PaneContentItem[];
    width: number;
}): ReactNode {
    const wide = width >= WIDE_ENOUGH;
    const fill = (item: PaneContentItem): void => void window.zanaris.panes.setContent(paneId, item.content);
    const bookmarks = new Map(links.map(link => [link.url, link]));
    return (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
            <ul className={`sunk min-h-0 flex-1 overflow-y-auto ${wide ? 'p-1' : 'py-1'}`}>
                {contents.map((item, i) => {
                    const link = item.content.kind === 'page' ? bookmarks.get(item.content.bookmark) : undefined;
                    // The one line the stone draws rather than main: this
                    // server's links are a different kind of destination from
                    // the window's own things, and the group each item arrives
                    // in is what says where that line falls.
                    const rule = i > 0 && item.group === 'link' && contents[i - 1]!.group !== 'link';
                    return (
                        <Fragment key={keyOf(item)}>
                            {rule && <li aria-hidden="true" className="sep" />}
                            <Row sprite={spriteOf(item, link)} label={link?.name ?? item.label} open={item.current} onOpen={() => fill(item)} link={link} wide={wide} />
                        </Fragment>
                    );
                })}
            </ul>

            <p className="text-[12px] text-dim">
                Add pane, at the top right, opens more beside this. Links off these sites open in your browser.
            </p>
        </div>
    );
}
