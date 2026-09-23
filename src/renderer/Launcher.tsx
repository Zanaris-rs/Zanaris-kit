import { Fragment, type ReactNode } from 'react';
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
 */
function Row({ sprite, label, open, onOpen, link }: { sprite: ReactNode; label: string; open: boolean; onOpen: () => void; link?: Bookmark }): ReactNode {
    return (
        <li className="flex items-stretch">
            <button
                type="button"
                aria-current={open ? 'true' : undefined}
                onClick={onOpen}
                className={`flex min-w-0 flex-1 items-center gap-2.5 px-2 py-[6px] text-left ${open ? 'bg-stone-lit' : 'hover:bg-stone-lit/40'}`}
            >
                <span className="shrink-0">{sprite}</span>
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {open && <span className="shrink-0 text-[12px] text-faint">open</span>}
            </button>
            {/*
             * The same escape hatch LostKit's own nav offers: some of these are
             * more use on a second monitor than in a 720px column, and a link
             * the pane cannot show at all is one the browser still can.
             */}
            {link ? (
                <button
                    type="button"
                    title={`Open ${link.name} in your browser`}
                    aria-label={`Open ${link.name} in your browser`}
                    onClick={() => void window.zanaris.panes.openExternal(link.url)}
                    className="flex w-[30px] shrink-0 items-center justify-center text-faint hover:text-cream"
                >
                    <OpenExternal />
                </button>
            ) : (
                <span aria-hidden="true" className="w-[30px] shrink-0" />
            )}
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

export default function Launcher({
    paneId,
    links,
    contents
}: {
    paneId: string;
    /** The catalog's own entries, for the icons a bare menu item has no room to carry. */
    links: Bookmark[];
    /** Everything this pane could become, already named and ordered by main. */
    contents: PaneContentItem[];
}): ReactNode {
    const fill = (item: PaneContentItem): void => void window.zanaris.panes.setContent(paneId, item.content);
    const bookmarks = new Map(links.map(link => [link.url, link]));
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <ul className="sunk mx-2.5 min-h-0 flex-1 overflow-y-auto p-1">
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
                            <Row sprite={spriteOf(item, link)} label={link?.name ?? item.label} open={item.current} onOpen={() => fill(item)} link={link} />
                        </Fragment>
                    );
                })}
            </ul>

            <p className="px-2.5 pt-2 pb-2 text-[12px] text-dim">
                Add pane, at the top right, opens more beside this. Links off these sites open in your browser.
            </p>
        </div>
    );
}
