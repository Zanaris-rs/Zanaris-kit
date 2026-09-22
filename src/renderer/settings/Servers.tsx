import { useId, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import type { NewServerInput } from '../../shared/catalog.ts';
import type { ServerRow, ServersView } from '../../main/servers.ts';

/*
 * `.btn` and the base `button` rule are unlayered CSS, which beats a Tailwind
 * utility of equal specificity whatever the order, so Open — one per row, none
 * of them this section's single primary action — sits on `.btn` for its size
 * and shape but keeps a quiet, dim label on a span inside it (a span has no
 * unlayered rule to lose to) rather than the gold `.btn` sets by default.
 * Copied from `Timers.tsx` rather than reinvented, so the two agree — one a
 * game window's pane, the other this section of Settings.
 */
const BUTTON_SIZE: CSSProperties = { fontSize: 13, padding: '1px 8px' };
/* The startup checkbox wears the gold the client's own accents do. */
const ACCENT: CSSProperties = { accentColor: 'var(--color-gold)' };
/* The add form's fields, one quiet sunk box each — the same class `Timers.tsx` uses for its own. */
const FIELD = 'sunk w-full min-w-0 px-[7px] py-[3px] font-sans text-[13px] text-cream placeholder:text-faint';

/** A secondary action: stone, a dim 13px label that lights on hover, and spent when it cannot be used. Same shape as `Timers.tsx`'s. */
function QuietButton({ onClick, disabled = false, children }: { onClick?: () => void; disabled?: boolean; children: ReactNode }): ReactNode {
    return (
        <button type="button" disabled={disabled} onClick={onClick} style={BUTTON_SIZE} className="btn group shrink-0">
            <span className={disabled ? 'text-faint' : 'text-dim group-hover:text-cream'}>{children}</span>
        </button>
    );
}

/**
 * Runs an IPC request that answers null or a refusal: marks it busy while in
 * flight, and on an answer either runs `onDone` (nothing to say — the caller
 * decides what "worked" means, since a removed row's own answer is to
 * disappear when Settings' next state arrives, where a saved form's is to
 * clear itself) or shows the refusal. Shared by the row's Remove and the add
 * form's Save so a refusal — a built-in guard, or a race with another
 * window's own Remove — is never silently dropped.
 */
async function send(request: Promise<string | null>, setBusy: (busy: boolean) => void, setRefusal: (refusal: string | null) => void, onDone?: () => void): Promise<void> {
    setBusy(true);
    try {
        const refused = await request;
        if (refused === null) onDone?.();
        else setRefusal(refused);
    } finally {
        setBusy(false);
    }
}

/** One line of the catalog: its name, revision if it has one, notes if any, how many windows have it open, an Open button, a startup checkbox, and Remove where the row allows it. */
function Row({ row }: { row: ServerRow }): ReactNode {
    const [busy, setBusy] = useState(false);
    const [refusal, setRefusal] = useState<string | null>(null);

    return (
        <li className="border-b border-edge-dark px-2 py-1.5 last:border-b-0">
            <div className="flex min-w-0 items-center gap-1">
                <span className="min-w-0 flex-1 truncate">{row.name}</span>
                {row.revision !== null && (
                    <span className="shrink-0 border border-edge-lit px-[3px] text-[10px] leading-[13px] text-dim">rev {row.revision}</span>
                )}
                <button type="button" style={BUTTON_SIZE} className="btn group shrink-0" onClick={() => void window.zanaris.servers.open(row.id)}>
                    <span className="text-dim group-hover:text-cream">Open</span>
                </button>
            </div>
            {row.notes && <p className="text-[12px] text-dim">{row.notes}</p>}
            {row.open > 0 && <p className="text-[12px] text-dim">{row.open} {row.open === 1 ? 'window' : 'windows'} open</p>}
            <div className="mt-1 flex items-center gap-2">
                <label className="flex items-center gap-2 text-[12px] text-cream">
                    <input type="checkbox" checked={row.atStartup} style={ACCENT} onChange={e => void window.zanaris.servers.setStartup(row.id, e.target.checked)} />
                    Open at startup
                </label>
                {row.removable && (
                    /* Text, not a button: removing is rare, and a red slab beside Save is the loudest thing in this section. Routed through the same `send` round-trip as `Timers.tsx`'s Delete, so the built-in guard and a race with another window's own Remove both surface here rather than vanishing silently. */
                    <button
                        type="button"
                        disabled={busy}
                        className="group ml-auto"
                        onClick={() => void send(window.zanaris.servers.remove(row.id), setBusy, setRefusal)}
                    >
                        <span className="text-[12px] text-dim underline-offset-2 group-hover:text-alarm group-hover:underline">Remove</span>
                    </button>
                )}
            </div>
            {refusal && (
                <p role="alert" className="text-[12px] text-warn">
                    {refusal}
                </p>
            )}
        </li>
    );
}

/** The add form's fields, as typed — strings throughout, since a blank revision box is not the number zero and is not this form's business to parse. */
interface NewServerDraft {
    name: string;
    url: string;
    revision: string;
    wikiHome: string;
    notes: string;
}

const EMPTY_DRAFT: NewServerDraft = { name: '', url: '', revision: '', wikiHome: '', notes: '' };

/**
 * The draft as the wire wants it. Blank optional fields become null, which is
 * an emptiness check, not a rule about what a revision or an address may be —
 * those rules are `createServer`'s alone, in main, and a `revision` box that
 * holds something other than a whole number crosses over as `Number` reads it
 * and comes back as that function's own refusal, same as a blank one does.
 */
function toInput(draft: NewServerDraft): NewServerInput {
    return {
        name: draft.name,
        url: draft.url,
        revision: draft.revision.trim() === '' ? null : Number(draft.revision),
        wikiHome: draft.wikiHome.trim() === '' ? null : draft.wikiHome,
        notes: draft.notes.trim() === '' ? null : draft.notes
    };
}

/**
 * One field of the add form: a label, a text box, and nothing else — there is
 * no per-field problem to show, because there is no rule here to check it
 * against. See `toInput` and the ruling above `readNewServerInput`.
 */
function Field({ id, label, value, onChange, placeholder }: { id: string; label: string; value: string; onChange: (value: string) => void; placeholder?: string }): ReactNode {
    return (
        <div className="flex min-w-0 flex-col gap-0.5">
            <label htmlFor={id} className="text-[12px] text-dim">
                {label}
            </label>
            <input id={id} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} className={FIELD} />
        </div>
    );
}

/**
 * The add form. It does not re-run `createServer` — it cannot, since the
 * renderer cannot import main — so it submits whatever is typed and shows
 * main's refusal through the same round-trip `Timers.tsx`'s form uses. Save
 * is disabled only while name or address is blank, which is a blank check,
 * not a second copy of the rules.
 */
function AddServerForm({ onDone }: { onDone: () => void }): ReactNode {
    const id = useId();
    const [draft, setDraft] = useState<NewServerDraft>(EMPTY_DRAFT);
    const [refusal, setRefusal] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const saveable = draft.name.trim() !== '' && draft.url.trim() !== '' && !busy;

    const change = (patch: Partial<NewServerDraft>): void => {
        setDraft(current => ({ ...current, ...patch }));
        setRefusal(null);
    };

    const submit = (event: FormEvent): void => {
        event.preventDefault();
        void send(window.zanaris.servers.add(toInput(draft)), setBusy, setRefusal, () => setDraft(EMPTY_DRAFT));
    };

    return (
        <form onSubmit={submit} className="mt-2 flex flex-col gap-2 border-t border-edge-dark pt-2">
            <Field id={`${id}-name`} label="Name" value={draft.name} onChange={name => change({ name })} />
            <Field id={`${id}-url`} label="Address" value={draft.url} onChange={url => change({ url })} />
            <Field id={`${id}-revision`} label="Revision" value={draft.revision} onChange={revision => change({ revision })} placeholder="Leave blank if unknown" />
            <Field id={`${id}-wiki`} label="Wiki" value={draft.wikiHome} onChange={wikiHome => change({ wikiHome })} />
            <Field id={`${id}-notes`} label="Notes" value={draft.notes} onChange={notes => change({ notes })} />

            {refusal && (
                <p role="alert" className="text-[12px] text-warn">
                    {refusal}
                </p>
            )}

            <div className="flex items-center gap-1.5">
                {/* The form's one gold button. Spent, not hidden, while it cannot be saved: Open and Remove keep their own quiet colour regardless. */}
                <button type="submit" disabled={!saveable} style={saveable ? BUTTON_SIZE : { ...BUTTON_SIZE, color: 'var(--color-faint)' }} className="btn">
                    Save
                </button>
                <QuietButton onClick={onDone}>Cancel</QuietButton>
            </div>
        </form>
    );
}

/** The Servers section: every catalog entry, each with Open, a startup checkbox and — where the row allows it — Remove, plus a form to add one more. */
export default function Servers({ view }: { view: ServersView }): ReactNode {
    const [adding, setAdding] = useState(false);

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <ul className="sunk mx-2.5 min-h-0 flex-1 overflow-y-auto">
                {view.rows.map(row => (
                    <Row key={row.id} row={row} />
                ))}
                {adding && (
                    <li className="px-2 py-1.5">
                        <span className="text-[12px] text-dim">Add a server</span>
                        <AddServerForm onDone={() => setAdding(false)} />
                    </li>
                )}
            </ul>

            {/* Exactly one gold `.btn` in this section at a time: this one while the form is closed, Save while it is open. */}
            <div className="flex items-center gap-2 px-2.5 pt-2 pb-1.5">
                {!adding ? (
                    <button type="button" onClick={() => setAdding(true)} style={BUTTON_SIZE} className="btn">
                        Add a server
                    </button>
                ) : (
                    <QuietButton disabled>Add a server</QuietButton>
                )}
            </div>
        </div>
    );
}
