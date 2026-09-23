import type { ReactNode } from 'react';
import type { ToolId } from '../shared/ipc';
import message from './sprites/755.png';
import sextant from './sprites/2574.png';
import clueScroll from './sprites/2677.png';
import tile from './sprites/966.png';
import crandorMap from './sprites/1538.png';
import coins from './sprites/1004.png';
import book from './sprites/757.png';
import bookOfBalance from './sprites/3844.png';
import lamp from './sprites/2528.png';
import skull from './sprites/964.png';
import casket from './sprites/405.png';
import beer from './sprites/1917.png';
import glory from './sprites/1704.png';
import trophy from './sprites/26.png';
import watch from './sprites/2575.png';
import toyHorsey from './sprites/2520.png';
import partyhat from './sprites/1038.png';

/*
 * The launcher's pictures: the game's own inventory icons, so a row reads as
 * something from the client rather than an icon set beside it.
 *
 * Each file is named for its object id and is the 32x32 PNG the Website repo
 * (Zanaris-rs/Website, `public/img/game/items/`) renders with the 274 client's
 * own `ObjType.getSprite` — see its `scripts/update-game-icons.sh`. They are
 * copied here rather than fetched, since the shell's CSP loads nothing that is
 * not its own. Picking another is copying another file across.
 */

const LINKS: Record<string, string> = {
    forums: message,
    coordinates: sextant,
    cluehelp: clueScroll,
    puzzle: tile,
    worldmap: crandorMap,
    markets: coins,
    questguides: book,
    skillguides: bookOfBalance,
    calculator: lamp,
    bestiary: skull,
    itemdb: casket
};

const TOOLS: Record<ToolId, string> = {
    chat: beer,
    worlds: glory,
    hiscores: trophy,
    timers: watch,
    singleplayer: toyHorsey
};

/** The game itself: the one item everyone who played knows on sight. */
const GAME = partyhat;

/**
 * One inventory icon, at the client's own size and unsmoothed. Item sprites
 * carry their own margin inside the 32px, as they do in an inventory slot, so
 * nothing here pads them.
 */
function Sprite({ src }: { src: string }): ReactNode {
    return <img src={src} width={32} height={32} alt="" aria-hidden="true" draggable={false} style={{ imageRendering: 'pixelated' }} />;
}

/** A catalog link's sprite, or the message scroll when it names nothing this kit knows — a hand-added link still has a row that lines up. */
export function linkSprite(icon: string | undefined): ReactNode {
    return <Sprite src={(icon === undefined ? undefined : LINKS[icon]) ?? message} />;
}

export function toolSprite(tool: ToolId): ReactNode {
    return <Sprite src={TOOLS[tool]} />;
}

export function gameSprite(): ReactNode {
    return <Sprite src={GAME} />;
}
