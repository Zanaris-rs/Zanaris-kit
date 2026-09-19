import { useId, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { NAME_INPUT_MAX, nameProblem, toDisplayName } from '../../../shared/names';
import { formatPlaytime, PROBLEM_LABEL, PROBLEM_TEXT, type CharacterInfo, type CharacterOutcome, type SaveSummary, type SinglePlayerView } from '../../../shared/singleplayer';

/*
 * `.btn` and the base `button` rule are unlayered CSS, which beats a Tailwind
 * utility whatever the order, so every button's size is inline and a quiet
 * button's colour sits on a span inside it.
 */
const BUTTON_SIZE: CSSProperties = { fontSize: 13, padding: '1px 8px' };
const SPENT: CSSProperties = { ...BUTTON_SIZE, color: 'var(--color-faint)' };
/* A row's own actions, a size down so they fit beside a name. */
const ROW_BUTTON: CSSProperties = { fontSize: 12, padding: '0 6px' };

const FIELD = 'sunk w-full min-w-0 px-[7px] py-[3px] font-sans text-[13px] text-cream placeholder:text-faint';

/** The one name being asked for: a picked save waiting to be imported, or a character being renamed or copied. */
type Prompt = { kind: 'import'; token: string; summary: SaveSummary; draft: string } | { kind: 'rename' | 'duplicate'; from: string; draft: string };

const ACTION: Record<Prompt['kind'], string> = { import: 'Import', rename: 'Rename', duplicate: 'Copy' };

function QuietButton({ onClick, disabled = false, size = BUTTON_SIZE, children }: { onClick: () => void; disabled?: boolean; size?: CSSProperties; children: ReactNode }): ReactNode {
    return (
        <button type="button" disabled={disabled} onClick={onClick} style={size} className="btn group shrink-0">
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

/** One character: its name and levels, or what is wrong with its file, and what can be done with it. */
function Row({
    character,
    busy,
    act,
    ask,
    copyTo
}: {
    character: CharacterInfo;
    busy: boolean;
    act: (change: () => Promise<CharacterOutcome>) => void;
    ask: (kind: 'rename' | 'duplicate') => void;
    /** Offers the character to another revision; null where no other revision is listed. */
    copyTo: (() => void) | null;
}): ReactNode {
    const api = window.zanaris.singlePlayer;
    const usable = character.summary !== null;
    return (
        <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1">
            <span className="text-cream">{character.displayName}</span>
            <span className={`min-w-0 flex-1 text-[12px] ${usable ? 'text-dim' : 'text-warn'}`}>
                {character.summary ? summaryLine(character.summary) : PROBLEM_LABEL[character.problem ?? 'unreadable']}
            </span>
            <span className="flex shrink-0 items-center gap-1">
                {/* A damaged save can still be exported or deleted; main refuses to rename or copy one, which would only spread it. */}
                <QuietButton size={ROW_BUTTON} disabled={busy || !usable} onClick={() => ask('rename')}>
                    Rename
                </QuietButton>
                <QuietButton size={ROW_BUTTON} disabled={busy || !usable} onClick={() => ask('duplicate')}>
                    Copy
                </QuietButton>
                {copyTo && (
                    <QuietButton size={ROW_BUTTON} disabled={busy || !usable} onClick={copyTo}>
                        Copy to…
                    </QuietButton>
                )}
                <QuietButton size={ROW_BUTTON} disabled={busy} onClick={() => act(() => api.exportCharacter(character.name))}>
                    Export
                </QuietButton>
                {/* Text, not a button: deleting is rare, and main asks first. */}
                <button type="button" disabled={busy} onClick={() => act(() => api.remove(character.name))} className="group ml-0.5">
                    <span className="text-[12px] text-dim underline-offset-2 group-hover:text-alarm group-hover:underline">Delete</span>
                </button>
            </span>
        </li>
    );
}

/**
 * The Characters section: every save in the world's folder, and the ways to
 * move one in, out or around. The list is main's, read from the files; this
 * only asks for changes, and main asks the player before any that could lose
 * something.
 */
export default function Characters({ view }: { view: SinglePlayerView }): ReactNode {
    const id = useId();
    const api = window.zanaris.singlePlayer;
    const [prompt, setPrompt] = useState<Prompt | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    /** The character being offered to another revision, while the revisions are asked for. */
    const [copying, setCopying] = useState<string | null>(null);
    /** The revisions another listed build runs: each keeps its own characters. Main refuses any other. */
    const others = [...new Set(view.builds.map(line => line.revision))].filter(revision => revision !== view.revision).sort((a, b) => a - b);

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
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="sunk mx-2.5 mt-2.5 min-h-0 flex-1 overflow-y-auto px-2 py-1">
                {view.characters.length === 0 ? (
                    <p className="py-1 text-dim">No characters yet. Type any name at the game's login screen to make one; it shows here once the game has saved it.</p>
                ) : (
                    <ul>
                        {view.characters.map(character => (
                            <Row
                                key={character.name}
                                character={character}
                                busy={busy}
                                act={act}
                                ask={kind => {
                                    setCopying(null);
                                    ask(kind, character.name);
                                }}
                                copyTo={
                                    others.length === 0
                                        ? null
                                        : () => {
                                              setPrompt(null);
                                              setNotice(null);
                                              setCopying(character.name);
                                          }
                                }
                            />
                        ))}
                    </ul>
                )}
            </div>

            {prompt !== null && (
                <form onSubmit={submit} className="mx-2.5 mt-2 flex flex-col gap-0.5">
                    <label htmlFor={`${id}-name`} className="text-[12px] text-dim">
                        {promptLabel(prompt)}
                    </label>
                    <div className="flex items-center gap-1.5">
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
                    <span id={`${id}-note`} className={`text-[12px] ${shown !== null ? 'text-warn' : 'text-dim'}`}>
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

            {copying !== null && (
                <div className="mx-2.5 mt-2 flex flex-col gap-0.5">
                    <span className="text-[12px] text-dim">
                        Copy {toDisplayName(copying)} from rev {view.revision} to
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                        {others.map(revision => (
                            <button
                                key={revision}
                                type="button"
                                disabled={busy}
                                onClick={() => act(() => api.copyTo(copying, revision), () => setCopying(null))}
                                style={busy ? SPENT : BUTTON_SIZE}
                                className="btn shrink-0"
                            >
                                rev {revision}
                            </button>
                        ))}
                        <QuietButton onClick={() => setCopying(null)}>Cancel</QuietButton>
                    </div>
                    <span className="text-[12px] text-dim">The copy is made in the other revision's world. Nothing here changes.</span>
                </div>
            )}

            {notice !== null && (
                <p role="alert" className="mx-2.5 mt-1.5 text-[12px] text-warn">
                    {notice}
                </p>
            )}

            <p className="px-2.5 pt-1.5 text-[12px] text-dim">The game saves a character when you log out and every 15 minutes, so one you are playing shows its last save.</p>
            {/* Actions run along the bottom of a panel here, as they do in the client's own interfaces. Import is gold until a name is being asked for. */}
            <div className="flex flex-wrap items-center gap-2 px-2.5 pt-2 pb-2">
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
