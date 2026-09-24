import type { ReactNode } from 'react';
import type { ToolId } from '../shared/ipc';
import message from './sprites/755.png';
import sextant from './sprites/2574.png';
import clueScroll from './sprites/2677.png';
import puzzleBox from './sprites/2795.png';
import crandorMap from './sprites/1538.png';
import coins from './sprites/1004.png';
import book from './sprites/757.png';
import bookOfBalance from './sprites/3844.png';
import lamp from './sprites/2528.png';
import skull from './sprites/964.png';
import casket from './sprites/405.png';
import beer from './sprites/1917.png';
import lawRune from './sprites/563.png';
import statsTab from './sprites/sideicons-1.png';
import watch from './sprites/2575.png';
import toyHorsey from './sprites/2520.png';
import mapFlag from './sprites/mapmarker-0-2x.png';

/*
 * The launcher's pictures: the game's own sprites — inventory icons, and a few
 * from its interface — so a row reads as something from the client rather
 * than an icon set beside it.
 *
 * A file named for an object id is the 32x32 PNG the Website repo
 * (Zanaris-rs/Website, `public/img/game/items/`) renders with the 274 client's
 * own `ObjType.getSprite` — see its `scripts/update-game-icons.sh`.
 *
 * A file named `<sheet>-<index>` is one cell of an interface sprite sheet in
 * the content repo (Zanaris-rs/Content, branch 274, `sprites/<sheet>.png`),
 * with the sheet's magenta key turned into transparency. `sideicons-1` is the
 * stats tab's 30x30 icon; it sits a pixel inside the items' 32 on each side.
 * A `-2x` suffix means the cell was cropped to its drawn pixels and doubled
 * pixel for pixel: the minimap flag is 8x15, drawn in the game at its own
 * size, and `Sprite` halves everything, so doubling it here is what shows it
 * at the size the game does.
 *
 * They are copied here rather than fetched, since the shell's CSP loads
 * nothing that is not its own. Picking another is copying another file across.
 */

const LINKS: Record<string, string> = {
    forums: message,
    coordinates: sextant,
    cluehelp: clueScroll,
    puzzle: puzzleBox,
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
    worlds: lawRune,
    hiscores: statsTab,
    timers: watch,
    singleplayer: toyHorsey
};

/** The game, and moving it here: the flag the minimap plants where you clicked to walk. */
const GAME = mapFlag;

/**
 * One sprite at half its pixel size, centred in the 18px every chrome glyph
 * is drawn in, so the launcher's pictures sit at the size of the app's other
 * icons rather than twice it. Half is the one scale that stays exact: on a
 * 2x display each sprite pixel is one screen pixel. The `2x` descriptor is
 * what halves it, so no sprite's size is written down twice. `.sprite` in
 * the stylesheet says how it is smoothed.
 *
 * Item sprites carry their own margin inside their 32px, as they do in an
 * inventory slot, so nothing here pads them.
 */
function Sprite({ src }: { src: string }): ReactNode {
    return (
        <span className="flex size-[18px] items-center justify-center">
            <img srcSet={`${src} 2x`} alt="" aria-hidden="true" draggable={false} className="sprite" />
        </span>
    );
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
