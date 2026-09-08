import { useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import type { HiscoresView, PlayerSkill } from '../../shared/hiscores';
import { hiscoresSkillName, normaliseName } from '../../shared/hiscores';

/*
 * .btn is hand-written CSS carrying the gold label, so a control that wants a
 * quieter colour overrides it inline. A utility class of equal specificity
 * would be settled by stylesheet order rather than by intent.
 */
const SPENT: CSSProperties = { color: 'var(--color-faint)' };

/**
 * The profile keeps a looked-up name only while it is 30 characters or less
 * and drops it otherwise, so the box refuses to take one longer than that
 * rather than accepting a name the prefill would silently lose. Main rejects
 * the same length at the IPC boundary; this only spares the user typing it.
 */
const NAME_MAX = 30;

/*
 * Three numeric columns of fixed width and one name column that gives way.
 * The numbers are the reason: right-aligned tabular figures only line up
 * across rows if every row hands them the same box, so the columns are sized
 * for the widest value each can hold at 13px Arial — a seven-figure rank, a
 * total level of four digits and a comma, an Overall xp of nine digits and
 * two — and the skill name is the one that truncates when the panel narrows or
 * a scrollbar takes its 12px. Sized in border-box terms because `table-fixed`
 * reads a <col> width that way, so the cell padding below comes out of these
 * numbers rather than adding to them. A column too narrow for its number does
 * not clip it and cannot wrap it either — a comma-separated figure offers no
 * break opportunity — so it overflows the cell, leftward out of a right-aligned
 * one and across its neighbour. That is why these are generous: the failure is
 * two numbers on top of each other, not a scrollbar.
 */
const COL_RANK = 'w-[66px]';
const COL_LEVEL = 'w-[44px]';
const COL_XP = 'w-[92px]';

/* The well's own padding, carried by the cells: a table cannot inherit it from the scroller. */
const CELL = 'px-1 py-[3px]';
const FIRST = 'pl-2';
const LAST = 'pr-2';

/*
 * The header stays put while the rows scroll under it. It carries its own
 * background because a sticky row is painted over the ones passing beneath
 * it — flat well rather than the stone's grain, which is a 70px tile that
 * cannot be lined up with the scrolled copy behind it anyway, and at this
 * height nobody can tell.
 */
const HEAD = `${CELL} sticky top-0 bg-well text-[12px] font-normal text-dim`;

/** One skill's line. Overall is picked out in gold, as the client picks out a total. */
function Row({ skill }: { skill: PlayerSkill }): ReactNode {
    return (
        <tr className={skill.type === 0 ? 'text-gold' : undefined}>
            <th scope="row" className={`${CELL} ${FIRST} truncate text-left font-normal`}>
                {hiscoresSkillName(skill.type)}
            </th>
            <td className={`${CELL} text-right tabular-nums`}>{skill.rank.toLocaleString()}</td>
            <td className={`${CELL} text-right tabular-nums`}>{skill.level.toLocaleString()}</td>
            <td className={`${CELL} ${LAST} text-right tabular-nums`}>{skill.xp.toLocaleString()}</td>
        </tr>
    );
}

/**
 * The Hiscores tool: a name, a table, and the server's own page.
 *
 * The lookup fires on submit and never on a keystroke. Lost City rate-limits
 * after a handful of requests inside a minute — typing a twelve-character name
 * would spend that budget before the player finished the name — so Enter or
 * the button is the only thing that asks the server anything.
 */
export default function Hiscores({ view }: { view: HiscoresView }): ReactNode {
    /*
     * Seeded from the view once, then the box is the user's. `view.name` moves
     * only when some window on this server looks a name up, and following it
     * afterwards would rewrite a half-typed name under the cursor because
     * another window went first. The panel is unmounted whenever the rail
     * points elsewhere, so reopening it does pick the remembered name back up.
     */
    const [draft, setDraft] = useState(view.name);

    const loading = view.status === 'loading';
    /*
     * Whether the box holds a name at all, asked of `normaliseName` rather than
     * of the string's length: it keeps only [a-z0-9_], so a box holding `!!!`
     * is as empty as one holding spaces, and the URL built from it would name
     * nobody. Main refuses both at the boundary; this keeps the button spent
     * rather than letting it look live and be ignored.
     */
    const ready = normaliseName(draft) !== '';

    const submit = (event: FormEvent): void => {
        event.preventDefault();
        if (!ready || loading) return;
        void window.zanaris.hiscores.lookup(draft.trim());
    };

    /*
     * Whose rows these are, in the form that actually went to the server.
     * `normaliseName` drops everything outside [a-z0-9_], so `José` is looked
     * up as `jos` — a valid three-letter name that may well belong to somebody
     * else, which comes back as another player's table rather than an honest
     * not-found. The same function the URL is built from is called here, so
     * this is the name that was asked for and not a second guess at it. It is
     * a caption rather than a warning: it also answers "whose numbers am I
     * looking at" when a failed lookup has left the last good table up under a
     * different name in the box.
     */
    const shown = view.shown === null ? null : normaliseName(view.shown);

    /* Canonical type order, Overall first, whatever order the server sent — and only the types it actually sent. */
    const rows = [...view.skills].sort((a, b) => a.type - b.type);

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {/* The client centres a panel's title over its contents, so this one is centred too. */}
            <h2 className="title">Hiscores</h2>

            <form onSubmit={submit} className="flex items-center gap-1.5 px-2.5 pb-[7px]">
                <input
                    value={draft}
                    onChange={event => setDraft(event.target.value)}
                    aria-label="Player name"
                    placeholder="Player name"
                    maxLength={NAME_MAX}
                    autoComplete="off"
                    spellCheck={false}
                    className="sunk min-w-0 flex-1 px-[7px] py-[3px] font-sans text-[13px] text-cream placeholder:text-faint"
                />
                <button type="submit" disabled={!ready || loading} style={!ready || loading ? SPENT : undefined} className="btn shrink-0">
                    Look up
                </button>
            </form>

            {shown !== null && (
                <p className="px-2.5 pb-[5px] text-[12px] text-dim">
                    Showing <span className="text-cream">{shown}</span>
                </p>
            )}

            <div className="sunk mx-2.5 min-h-0 flex-1 overflow-y-auto">
                <table className="w-full table-fixed">
                    <colgroup>
                        <col />
                        <col className={COL_RANK} />
                        <col className={COL_LEVEL} />
                        <col className={COL_XP} />
                    </colgroup>
                    <thead>
                        <tr>
                            <th scope="col" className={`${HEAD} ${FIRST} text-left`}>
                                Skill
                            </th>
                            <th scope="col" className={`${HEAD} text-right`}>
                                Rank
                            </th>
                            <th scope="col" className={`${HEAD} text-right`}>
                                Lvl
                            </th>
                            <th scope="col" className={`${HEAD} ${LAST} text-right`}>
                                XP
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(skill => (
                            <Row key={skill.type} skill={skill} />
                        ))}
                    </tbody>
                </table>
                {/*
                 * Only the untouched panel explains itself here. Every other
                 * empty table has a reason the foot is already giving in the
                 * service's own words, and saying it twice in one panel would
                 * read as two separate things having gone wrong.
                 */}
                {rows.length === 0 && view.status === 'idle' && (
                    <p className="px-2 py-2 text-[12px] text-dim">Nothing looked up yet. Type a name and press Look up.</p>
                )}
            </div>

            {/* What the last lookup came to, under the table it belongs to, in the words the service chose for it. */}
            <p className="px-2.5 pt-2 pb-1.5 text-[12px]" aria-live="polite">
                {view.error ? (
                    /* A name nobody holds and a lookup that failed both land here; the service has already told them apart. */
                    <span className="text-warn">{view.error}</span>
                ) : (
                    <span className="text-dim">{loading ? 'Looking up…' : ''}</span>
                )}
            </p>

            {view.site && (
                <p className="px-2.5 pb-2 text-[12px]">
                    {/*
                     * This leaves the kit. The plan wanted the server's page as a tab
                     * in this window, but page tabs are not built — so it opens in the
                     * system browser, and the label says so rather than letting the
                     * window that appears be the way the user finds out.
                     */}
                    <button type="button" onClick={() => void window.zanaris.hiscores.openSite()} className="link">
                        Full hiscores <span className="text-dim">— opens in your browser</span>
                    </button>
                </p>
            )}
        </div>
    );
}
