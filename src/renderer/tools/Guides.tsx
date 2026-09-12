import type { ReactNode } from 'react';
import type { Bookmark } from '../../shared/worlds';
import type { PagesView } from '../../shared/pages';
import { linkIcon, OpenExternal } from '../icons';

/**
 * The Guides list: this server's reference links, and the way into the pane.
 *
 * It is a menu rather than a viewer. Clicking a row opens the page beside the
 * game and leaves the list up, so the next one is another click away; the rail
 * tab shuts it when the reading matters more than the menu does. A row whose
 * page is already open says so and brings it to the front instead of opening
 * a second copy.
 *
 * Which links a window has is the catalog's, not this component's: a server
 * with no bookmarks never offers the tool at all, which is the whole of why
 * Lost City has forums and prices here and Zanaris does not.
 */

function Row({ link, open, onOpen }: { link: Bookmark; open: boolean; onOpen: () => void }): ReactNode {
    return (
        <li className="flex items-stretch">
            <button
                type="button"
                aria-current={open ? 'true' : undefined}
                onClick={onOpen}
                className={`flex min-w-0 flex-1 items-center gap-2.5 px-2 py-[6px] text-left ${open ? 'bg-stone-lit' : 'hover:bg-stone-lit/40'}`}
            >
                <span className="shrink-0">{linkIcon(link.icon)}</span>
                <span className="min-w-0 flex-1 truncate">{link.name}</span>
                {open && <span className="shrink-0 text-[12px] text-faint">open</span>}
            </button>
            {/*
             * The same escape hatch LostKit's own nav offers: some of these are
             * more use on a second monitor than in a 720px column, and a link
             * the pane cannot show at all is one the browser still can.
             */}
            <button
                type="button"
                title={`Open ${link.name} in your browser`}
                aria-label={`Open ${link.name} in your browser`}
                onClick={() => void window.zanaris.pages.openExternal(link.url)}
                className="flex w-[30px] shrink-0 items-center justify-center text-faint hover:text-cream"
            >
                <OpenExternal />
            </button>
        </li>
    );
}

export default function Guides({ links, pages }: { links: Bookmark[]; pages: PagesView }): ReactNode {
    const openUrls = new Set(pages.tabs.map(t => t.bookmark));
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {/* The client centres a panel's title over its contents, so this one is centred too. */}
            <h2 className="title">Guides</h2>

            <ul className="sunk mx-2.5 min-h-0 flex-1 overflow-y-auto">
                {links.map(link => (
                    <Row key={link.url} link={link} open={openUrls.has(link.url)} onOpen={() => void window.zanaris.pages.open(link.url)} />
                ))}
            </ul>

            <p className="px-2.5 pt-2 pb-1.5 text-[12px] text-dim">
                Pages open beside the game and stay as you left them. Links off these sites open in your browser.
            </p>
        </div>
    );
}
