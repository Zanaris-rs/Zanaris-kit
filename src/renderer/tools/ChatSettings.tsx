import { useId, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { ChatView } from '../../shared/chat';
import { NICK_MAX, PASSWORD_MAX, formatAutoJoin, isConnectionWanted, passwordProblem, readIgnore, readSettingsDraft, sameNames, sameSettings, type SettingsSave } from '../../shared/chatSettings';

/*
 * One loud button at a time, as the rest of the pane has it. Offline, that is
 * Connect, in the red the chat's Send wears, because connecting is what this
 * tab is for. Connected, it is Save, in the gold the other tools' forms use,
 * spent until there is something to save; Disconnect is quiet beside it.
 *
 * `.btn` and the base `button` rule are unlayered CSS, which beats a Tailwind
 * utility whatever the order, so a quiet button's colour sits on a span inside
 * it and every size is inline.
 */
const BUTTON_SIZE: CSSProperties = { fontSize: 13, padding: '1px 8px' };
const SPENT: CSSProperties = { ...BUTTON_SIZE, color: 'var(--color-faint)' };

const FIELD = 'sunk w-full min-w-0 py-[3px] font-sans text-[13px] text-cream placeholder:text-faint';

/*
 * A field's sides. Narrow they are 4px rather than 7: at `PANE_MIN_WIDTH`,
 * with the page's scrollbar showing, that leaves a field 76px of text, which
 * holds "Pick a name" and "#2004scape," whole.
 */
const FIELD_SIDES = 'px-[7px]';
const FIELD_SIDES_NARROW = 'px-[4px]';

/*
 * The two lists are boxes that wrap, not one-line fields: a list longer than
 * its field was cut at the field's edge, and in a narrow pane that was even
 * the first of the three channels the kit starts with. Each grows to hold what
 * is in it (`field-sizing`), so one that fits reads as a one-line field.
 * Enter saves, as it does in the one-line fields: a list is written with
 * commas or spaces, and a line break pasted into one reads as a space.
 */
const LIST: CSSProperties = { fieldSizing: 'content', resize: 'none' };

function submitOnEnter(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
}

/** The checkbox in the kit's gold, as the other forms draw theirs. */
const ACCENT: CSSProperties = { accentColor: 'var(--color-gold)' };

/**
 * The chat Settings tab: who you are in chat, the password NickServ knows you
 * by, the channels a connect joins, who is ignored, whether a mention raises a
 * notification, and the connection itself.
 *
 * Each field shows what is saved until it is typed in, and goes back to
 * showing what is saved after a save — the saved nick, not the one the
 * connection happens to hold. Those differ after a taken nick's underscore, a
 * typed /nick or a services rename, and saving the connection's name back
 * would make a session's accident the next launch's nick. When they differ,
 * the field says what the connection is called.
 *
 * The password is never shown back, because the shell is never given it: the
 * field is empty, and says whether one is saved.
 */
export default function ChatSettings({ view, wide, narrow, onConnected }: { view: ChatView; wide: boolean; narrow: boolean; onConnected: () => void }): ReactNode {
    const id = useId();
    const saved = view.settings;
    /* Null while untouched, so the field follows what is saved. */
    const [nickDraft, setNickDraft] = useState<string | null>(null);
    const [channelsDraft, setChannelsDraft] = useState<string | null>(null);
    const [ignoreDraft, setIgnoreDraft] = useState<string | null>(null);
    const [notifyDraft, setNotifyDraft] = useState<boolean | null>(null);
    const [password, setPassword] = useState('');
    const [forget, setForget] = useState(false);
    const [refusal, setRefusal] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const nick = nickDraft ?? saved.nick ?? '';
    const channels = channelsDraft ?? formatAutoJoin(saved.autoJoin);
    /* Follows what is saved until typed in, so an /ignore typed in a channel shows up here. */
    const ignoreText = ignoreDraft ?? saved.ignore.join(', ');
    const notify = notifyDraft ?? saved.notify;
    const reading = readSettingsDraft({ nick, channels });
    const ignoreReading = readIgnore(ignoreText);
    const passwordNote = password === '' ? null : passwordProblem(password);
    const valid = reading.ok && ignoreReading.ok && passwordNote === null;
    const changed =
        !reading.ok ||
        !sameSettings(reading.draft, saved.nick, saved.autoJoin) ||
        !ignoreReading.ok ||
        !sameNames(ignoreReading.ignore, saved.ignore) ||
        notify !== saved.notify ||
        password !== '' ||
        forget;
    /* Only while connected is there a connection's name to differ from the saved one. */
    const calledElse = view.status === 'online' && view.nick !== null && saved.nick !== null && view.nick !== saved.nick ? view.nick : null;
    const connected = isConnectionWanted(view.status);

    const edit = (apply: () => void): void => {
        apply();
        setRefusal(null);
    };

    /** Saves what changed. True when there was nothing to save or it was saved; false when main refused, with its reason shown. */
    const save = async (): Promise<boolean> => {
        if (!changed) return true;
        const form: SettingsSave = { nick, channels, ignore: ignoreText, notify };
        if (password !== '') form.password = password;
        else if (forget) form.password = null;
        const refused = await window.zanaris.chat.saveSettings(form);
        if (refused !== null) {
            setRefusal(refused);
            return false;
        }
        setNickDraft(null);
        setChannelsDraft(null);
        setIgnoreDraft(null);
        setNotifyDraft(null);
        setPassword('');
        setForget(false);
        return true;
    };

    const submit = (event: FormEvent): void => {
        event.preventDefault();
        if (!valid || busy) return;
        setBusy(true);
        void (async () => {
            try {
                if (!(await save())) return;
                if (!connected) {
                    await window.zanaris.chat.connect();
                    onConnected();
                }
            } finally {
                setBusy(false);
            }
        })();
    };

    /* An empty nick is where a first run starts, not a mistake: the spent Connect button and the placeholder say enough until something is typed. */
    const shows = (field: 'nick' | 'channels'): boolean => !reading.ok && reading.problem.field === field && !(field === 'nick' && nick.trim() === '');
    const note = (field: 'nick' | 'channels'): ReactNode =>
        !reading.ok && shows(field) ? (
            <span id={`${id}-${field}-note`} className="text-[12px] text-warn">
                {reading.problem.message}
            </span>
        ) : null;

    const passwordPlaceholder = forget ? 'Forgotten when you save' : saved.hasPassword ? 'Saved — type to replace' : 'Optional';
    const field = `${FIELD} ${narrow ? FIELD_SIDES_NARROW : FIELD_SIDES}`;

    return (
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-2">
            {/*
             * Narrow, the page goes without its well and scrolls on the stone:
             * the well's border and padding were 24px of every line, a quarter
             * of the pane at `PANE_MIN_WIDTH`, and every field was cut short.
             */}
            <div className={`min-h-0 flex-1 overflow-y-auto leading-[1.45]${narrow ? '' : ' sunk px-2.5 py-2.5'}`}>
                {view.needsNick && (
                    <p className="mb-2.5">
                        Everyone playing shares these channels. Pick a name for chat — the other players will see it.{' '}
                        <span className="text-dim">It does not have to be your character's name.</span>
                    </p>
                )}

                <div className={`grid gap-x-3 gap-y-2.5 ${wide ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    <div className="flex min-w-0 flex-col gap-0.5">
                        <label htmlFor={`${id}-nick`} className="text-[12px] text-dim">
                            Nickname
                        </label>
                        <input
                            id={`${id}-nick`}
                            value={nick}
                            maxLength={NICK_MAX}
                            autoComplete="off"
                            spellCheck={false}
                            placeholder="Pick a name"
                            aria-invalid={shows('nick')}
                            aria-describedby={shows('nick') ? `${id}-nick-note` : undefined}
                            onChange={e => edit(() => setNickDraft(e.target.value))}
                            className={field}
                        />
                        {note('nick') ??
                            (calledElse !== null && (
                                <span className="text-[12px] text-dim">
                                    Connected as <span className="text-cream">{calledElse}</span> for now. The next connect asks for {saved.nick}.
                                </span>
                            ))}
                    </div>

                    <div className="flex min-w-0 flex-col gap-0.5">
                        <label htmlFor={`${id}-password`} className="text-[12px] text-dim">
                            NickServ password
                        </label>
                        <input
                            id={`${id}-password`}
                            type="password"
                            value={password}
                            maxLength={PASSWORD_MAX}
                            autoComplete="off"
                            placeholder={passwordPlaceholder}
                            aria-describedby={`${id}-password-note`}
                            onChange={e =>
                                edit(() => {
                                    setPassword(e.target.value);
                                    setForget(false);
                                })
                            }
                            className={field}
                        />
                        <span id={`${id}-password-note`} className={`text-[12px] ${passwordNote !== null ? 'text-warn' : 'text-dim'}`}>
                            {passwordNote ?? (saved.canSavePassword ? 'Sent to NickServ each time you connect. Kept encrypted by your system.' : 'This computer has no secure store for it, so it is kept only until you quit.')}
                        </span>
                        {saved.hasPassword && password === '' && (
                            /* Text, not a button: forgetting is rare, and it only happens on Save. */
                            <button type="button" onClick={() => edit(() => setForget(!forget))} className="group self-start">
                                <span className="text-[12px] text-dim underline-offset-2 group-hover:text-cream group-hover:underline">{forget ? 'Keep the saved password' : 'Forget the saved password'}</span>
                            </button>
                        )}
                    </div>

                    <div className={`flex min-w-0 flex-col gap-0.5 ${wide ? 'col-span-2' : ''}`}>
                        <label htmlFor={`${id}-channels`} className="text-[12px] text-dim">
                            Auto-join channels
                        </label>
                        <textarea
                            id={`${id}-channels`}
                            value={channels}
                            rows={1}
                            autoComplete="off"
                            spellCheck={false}
                            placeholder="#LostHQ, #2004scape"
                            aria-invalid={shows('channels')}
                            aria-describedby={`${id}-channels-note`}
                            onChange={e => edit(() => setChannelsDraft(e.target.value))}
                            onKeyDown={submitOnEnter}
                            style={LIST}
                            className={field}
                        />
                        {note('channels') ?? (
                            <span id={`${id}-channels-note`} className="text-[12px] text-dim">
                                Joined every time you connect. Closing a channel's tab leaves it until the next connect.
                            </span>
                        )}
                    </div>

                    <div className={`flex min-w-0 flex-col gap-0.5 ${wide ? 'col-span-2' : ''}`}>
                        <label htmlFor={`${id}-ignore`} className="text-[12px] text-dim">
                            Ignored nicks
                        </label>
                        <textarea
                            id={`${id}-ignore`}
                            value={ignoreText}
                            rows={1}
                            autoComplete="off"
                            spellCheck={false}
                            placeholder="Nobody"
                            aria-invalid={!ignoreReading.ok}
                            aria-describedby={`${id}-ignore-note`}
                            onChange={e => edit(() => setIgnoreDraft(e.target.value))}
                            onKeyDown={submitOnEnter}
                            style={LIST}
                            className={field}
                        />
                        <span id={`${id}-ignore-note`} className={`text-[12px] ${ignoreReading.ok ? 'text-dim' : 'text-warn'}`}>
                            {ignoreReading.ok ? 'Their messages, notices and invites are hidden. /ignore and /unignore change this list too.' : ignoreReading.message}
                        </span>
                    </div>

                    {/*
                     * The words are let go narrower than their longest, which
                     * breaks it rather than pushing the page sideways. Narrow,
                     * the box drops the margins the system gives it at its
                     * sides, so "background" still fits beside it whole.
                     */}
                    <label className={`flex items-start text-cream ${narrow ? 'gap-1.5' : 'gap-2'} ${wide ? 'col-span-2' : ''}`}>
                        <input type="checkbox" checked={notify} onChange={e => edit(() => setNotifyDraft(e.target.checked))} style={ACCENT} className={narrow ? 'mx-0 mt-[3px]' : 'mt-[3px]'} />
                        <span className="min-w-0 break-words">
                            Notify me of mentions and private messages <span className="text-[12px] text-dim">while the kit is in the background</span>
                        </span>
                    </label>
                </div>

                {refusal !== null && (
                    <p role="alert" className="mt-2.5 text-[12px] text-warn">
                        {refusal}
                    </p>
                )}
            </div>

            {/* Actions run along the bottom of a panel here, as they do in the client's own interfaces. */}
            <div className="flex flex-wrap items-center gap-1.5">
                {connected ? (
                    <>
                        <button type="submit" disabled={!changed || !valid || busy} style={changed && valid ? BUTTON_SIZE : SPENT} className="btn">
                            Save
                        </button>
                        <button type="button" disabled={busy} onClick={() => void window.zanaris.chat.disconnect()} style={BUTTON_SIZE} className="btn group">
                            <span className="text-dim group-hover:text-cream">Disconnect</span>
                        </button>
                    </>
                ) : (
                    <button type="submit" disabled={!valid || busy} style={BUTTON_SIZE} className="btn btn-red disabled:opacity-60">
                        {changed ? 'Save and connect' : 'Connect'}
                    </button>
                )}
            </div>
        </form>
    );
}
