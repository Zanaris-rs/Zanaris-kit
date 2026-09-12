import type { ReactNode } from 'react';
import type { Bookmark } from '../shared/worlds';
import type { ToolId } from '../shared/ipc';
import type { PaneContent } from '../shared/panes';
import { linkIcon, OpenExternal } from './icons';

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
 * Which links a window has is the catalog's, not this component's: a server
 * with no bookmarks simply shows none, which is the whole of why Lost City has
 * forums and prices here and Zanaris does not.
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
                onClick={() => void window.zanaris.panes.openExternal(link.url)}
                className="flex w-[30px] shrink-0 items-center justify-center text-faint hover:text-cream"
            >
                <OpenExternal />
            </button>
        </li>
    );
}

const TOOL_LABELS: Record<ToolId, string> = { chat: 'Chat', worlds: 'Worlds', hiscores: 'Hiscores', singleplayer: 'Single player' };

export default function Launcher({
    paneId,
    links,
    tools,
    gameAvailable
}: {
    paneId: string;
    links: Bookmark[];
    tools: ToolId[];
    /** False while another pane already holds the game: there is one per window, so a second is unrepresentable rather than merely unwanted. */
    gameAvailable: boolean;
}): ReactNode {
    const fill = (content: PaneContent): void => void window.zanaris.panes.setContent(paneId, content);
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {/* The client centres a panel's title over its contents, so this one is centred too. */}
            <h2 className="title">Open here</h2>

            <ul className="sunk mx-2.5 min-h-0 flex-1 overflow-y-auto">
                {tools.map(tool => (
                    <li key={tool} className="flex items-stretch">
                        <button type="button" onClick={() => fill({ kind: 'tool', tool })} className="min-w-0 flex-1 px-2 py-[6px] text-left hover:bg-stone-lit/40">
                            {TOOL_LABELS[tool]}
                        </button>
                    </li>
                ))}
                <li className="flex items-stretch">
                    <button
                        type="button"
                        disabled={!gameAvailable}
                        title={gameAvailable ? undefined : 'The game is already open in another pane'}
                        onClick={() => fill({ kind: 'game' })}
                        className="min-w-0 flex-1 px-2 py-[6px] text-left hover:bg-stone-lit/40 disabled:text-faint disabled:hover:bg-transparent"
                    >
                        Game
                    </button>
                </li>
                {links.length > 0 && <li aria-hidden="true" className="sep my-1" />}
                {links.map(link => (
                    <Row key={link.url} link={link} open={false} onOpen={() => fill({ kind: 'page', bookmark: link.url })} />
                ))}
            </ul>

            <p className="px-2.5 pt-2 pb-1.5 text-[12px] text-dim">
                Split a pane to open more at once. Links off these sites open in your browser.
            </p>
        </div>
    );
}
