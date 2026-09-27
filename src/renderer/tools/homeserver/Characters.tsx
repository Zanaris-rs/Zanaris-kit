import { useId, useState, type CSSProperties, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { NAME_INPUT_MAX, nameProblem, toDisplayName } from '../../../shared/names';
import { formatPlaytime, PROBLEM_LABEL, PROBLEM_TEXT, type CharacterAction, type CharacterInfo, type CharacterOutcome, type SaveSummary, type HomeServerView } from '../../../shared/homeserver';
import { Caret } from '../../icons';
import { scrollClass, sectionClass } from './fill';

/*
 * `.btn` and the base `button` rule are unlayered CSS, which beats a Tailwind
 * utility whatever the order, so every button's size is inline and a quiet
 * button's colour sits on a span inside it.
 */
const BUTTON_SIZE: CSSProperties = { fontSize: 13, padding: '1px 8px' };
const SPENT: CSSProperties = { ...BUTTON_SIZE, color: 'var(--color-faint)' };

/*
 * A row is a bare `<button>`, so its padding is inline and its highlight is on
 * the `<li>`, as Worlds' rows' are. Narrow, its sides are 4px, as the
 * launcher's rows are: at `PANE_MIN_WIDTH`, with the section's scrollbar
 * showing, that leaves a row 76px, and a name 62 beside the caret.
 */
const ROW_PADDING: CSSProperties = { padding: '5px 8px' };
const ROW_PADDING_NARROW: CSSProperties = { padding: '5px 4px' };

const FIELD = 'sunk w-full min-w-0 px-[7px] py-[3px] font-sans text-[13px] text-cream placeholder:text-faint';

/** The one name being asked for: a picked save waiting to be imported, or a character being renamed or copied. */
type Prompt = { kind: 'import'; token: string; summary: SaveSummary; draft: string } | { kind: 'rename' | 'duplicate'; from: string; draft: string };

const ACTION: Record<Prompt['kind'], string> = { import: 'Import', rename: 'Rename', duplicate: 'Copy' };

/** A secondary action. A label of more than one word wraps inside it in a narrow pane, as Timers' does, rather than running past the edge of its row. */
function QuietButton({ onClick, disabled = false, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }): ReactNode {
    return (
        <button type="button" disabled={disabled} onClick={onClick} style={BUTTON_SIZE} className="btn group">
            <span className={disabled ? 'text-faint' : 'text-dim group-hover:text-cream'}>{children}</span>
        </button>
    );
}

function summaryLine(summary: SaveSummary): string {
    return `Combat ${summary.combatLevel} · Total ${summary.totalLevel} · ${formatPlaytime(summary.playtimeTicks)} played`;
}

function promptLabel(prompt: Prompt): string {
    if (prompt.kind === 'import') return 'Import as';
    const who = toDisplayName(prompt.from);
    return prompt.kind === 'rename' ? `Rename ${who} to` : `Copy ${who} as`;
}

/**
 * One character: its name, then its levels or what is wrong with its file,
 * two lines whatever the width so that the rows line up. The row is one
 * button, and what can be done with the character is its menu, which a click
 * or a right-click opens — right-click, as the game's own options are. The
 * five buttons it replaced were a line of their own on every row in a wide
 * pane, and five lines in a narrow one.
 */
function Row({ character, busy, wide, choose }: { character: CharacterInfo; busy: boolean; wide: boolean; choose: (action: CharacterAction) => void }): ReactNode {
    const usable = character.summary !== null;
    /*
     * The menu is main's, as a nick's is in chat. A click opens it at the
     * pointer, and a key press, which has none, under the row. The pane's own
     * menu is a right-click anywhere else in it, so this one stops there. A
     * disabled button still hears a right-click, so busy is checked here too:
     * one change at a time.
     */
    const open = (event: MouseEvent<HTMLButtonElement>): void => {
        event.preventDefault();
        event.stopPropagation();
        if (busy) return;
        const box = event.currentTarget.getBoundingClientRect();
        const byKey = event.type === 'click' && event.detail === 0;
        void window.zanaris.homeServer.characterMenu(character.name, byKey ? box.left : event.clientX, byKey ? box.bottom : event.clientY).then(action => {
            if (action !== null) choose(action);
        });
    };
    return (
        <li className={`border-b border-edge-dark last:border-b-0${busy ? '' : ' hover:bg-stone-lit/40'}`}>
            <button type="button" aria-haspopup="menu" disabled={busy} onClick={open} onContextMenu={open} style={wide ? ROW_PADDING : ROW_PADDING_NARROW} className="group block w-full text-left">
                <span className="flex items-start gap-1">
                    {/* A name wider than the row, as twelve letters can be at `PANE_MIN_WIDTH`, breaks rather than scrolling the list sideways. */}
                    <span className="min-w-0 flex-1 text-cream wrap-anywhere">{character.displayName}</span>
                    <span className="shrink-0 text-faint group-hover:text-cream">
                        <Caret compact />
                    </span>
                </span>
                <span className={`block text-[12px] ${usable ? 'text-dim' : 'text-warn'}`}>
                    {character.summary ? summaryLine(character.summary) : PROBLEM_LABEL[character.problem ?? 'unreadable']}
                </span>
            </button>
        </li>
    );
}

/**
 * The Characters section: every save in the world's folder, and the ways to
 * move one in, out or around. The list is main's, read from the files; this
 * only asks for changes, and main asks the player before any that could lose
 * something.
 */
export default function Characters({ view, wide }: { view: HomeServerView; wide: boolean }): ReactNode {
    const id = useId();
    const api = window.zanaris.homeServer;
    const [prompt, setPrompt] = useState<Prompt | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    /** Runs a change, shows a refusal, and calls `after` when the change went through. */
    const act = (change: () => Promise<CharacterOutcome>, after?: () => void): void => {
        setBusy(true);
        setNotice(null);
        void change()
            .then(outcome => {
                if (outcome.kind === 'refused') setNotice(outcome.message);
                else if (outcome.kind === 'done') after?.();
            })
            .finally(() => setBusy(false));
    };

    const pick = (): void => {
        setBusy(true);
        setNotice(null);
        void api
            .pickImport()
            .then(picked => {
                if (picked === null) return;
                if (picked.ok) setPrompt({ kind: 'import', token: picked.token, summary: picked.summary, draft: picked.suggestedName });
                else setNotice(PROBLEM_TEXT[picked.problem]);
            })
            .finally(() => setBusy(false));
    };

    const ask = (kind: 'rename' | 'duplicate', from: string): void => {
        setNotice(null);
        setPrompt({ kind, from, draft: kind === 'rename' ? toDisplayName(from) : '' });
    };

    /** Carries out what a character's menu chose, through the calls its buttons used to make. */
    const choose = (name: string, action: CharacterAction): void => {
        switch (action.kind) {
            case 'rename':
            case 'duplicate':
                return ask(action.kind, name);
            case 'copy-to':
                return act(() => api.copyTo(name, action.revision));
            case 'export':
                return act(() => api.exportCharacter(name));
            case 'delete':
                return act(() => api.remove(name));
        }
    };

    const problem = prompt === null ? null : nameProblem(prompt.draft);
    /* An empty field is where a prompt starts, not a mistake: the spent button says enough until something is typed. */
    const shown = prompt === null || prompt.draft.trim() === '' ? null : problem;

    const submit = (event: FormEvent): void => {
        event.preventDefault();
        if (prompt === null || problem !== null || busy) return;
        const current = prompt;
        const change = (): Promise<CharacterOutcome> => {
            switch (current.kind) {
                case 'import':
                    return api.importAs(current.token, current.draft);
                case 'rename':
                    return api.rename(current.from, current.draft);
                case 'duplicate':
                    return api.duplicate(current.from, current.draft);
            }
        };
        act(change, () => setPrompt(null));
    };

    return (
        <div className={sectionClass(wide)}>
            {/* The rows carry their own sides, so that a row's highlight reaches the well's. */}
            <div className={`sunk ${scrollClass(wide)} py-1`}>
                {view.characters.length === 0 ? (
                    <p className={`py-1 text-dim ${wide ? 'px-2' : 'px-1'}`}>No characters yet. Type any name at the game's login screen to make one; it shows here once the game has saved it.</p>
                ) : (
                    <ul>
                        {view.characters.map(character => (
                            <Row key={character.name} character={character} busy={busy} wide={wide} choose={action => choose(character.name, action)} />
                        ))}
                    </ul>
                )}
            </div>

            {prompt !== null && (
                <form onSubmit={submit} className="flex flex-col gap-0.5">
                    {/* The name here breaks where it is wider than the pane, as the list's do. */}
                    <label htmlFor={`${id}-name`} className="text-[12px] text-dim wrap-anywhere">
                        {promptLabel(prompt)}
                    </label>
                    {/*
                     * Narrow, the row wraps, so the box, which is as wide as the
                     * row, has a line to itself and its buttons go under it:
                     * beside them it was 14px at `PANE_MIN_WIDTH`, and Cancel
                     * ran out of the pane.
                     */}
                    <div className={`flex items-center gap-1.5${wide ? '' : ' flex-wrap'}`}>
                        <input
                            id={`${id}-name`}
                            autoFocus
                            value={prompt.draft}
                            maxLength={NAME_INPUT_MAX}
                            autoComplete="off"
                            spellCheck={false}
                            placeholder="Character name"
                            aria-invalid={shown !== null}
                            aria-describedby={`${id}-note`}
                            onChange={event => {
                                setNotice(null);
                                setPrompt({ ...prompt, draft: event.target.value });
                            }}
                            className={FIELD}
                        />
                        <button type="submit" disabled={busy || problem !== null} style={busy || problem !== null ? SPENT : BUTTON_SIZE} className="btn shrink-0">
                            {ACTION[prompt.kind]}
                        </button>
                        <QuietButton onClick={() => setPrompt(null)}>Cancel</QuietButton>
                    </div>
                    <span id={`${id}-note`} className={`text-[12px] wrap-anywhere ${shown !== null ? 'text-warn' : 'text-dim'}`}>
                        {shown ??
                            (problem === null ? (
                                <>
                                    {prompt.kind === 'import' && `${summaryLine(prompt.summary)}. `}
                                    You'll log in as <span className="text-cream">{toDisplayName(prompt.draft)}</span>.
                                </>
                            ) : (
                                'Letters, numbers and spaces. The game keeps the first twelve.'
                            ))}
                    </span>
                </form>
            )}

            {notice !== null && (
                <p role="alert" className="text-[12px] text-warn">
                    {notice}
                </p>
            )}

            <p className="text-[12px] text-dim">The game saves a character when you log out and every 15 minutes, so one you are playing shows its last save.</p>
            {/* Actions run along the bottom of a panel here, as they do in the client's own interfaces. Import is gold until a name is being asked for. */}
            <div className="flex flex-wrap items-center gap-2">
                {prompt === null ? (
                    <button type="button" disabled={busy} onClick={pick} style={busy ? SPENT : BUTTON_SIZE} className="btn">
                        Import…
                    </button>
                ) : (
                    <QuietButton disabled={busy} onClick={pick}>
                        Import…
                    </QuietButton>
                )}
                <QuietButton onClick={() => void api.openSaves()}>Open saves folder</QuietButton>
            </div>
        </div>
    );
}
