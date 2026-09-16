import { useId, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import type { ChatView } from '../../shared/chat';
import { NICK_MAX, PASSWORD_MAX, formatAutoJoin, isConnectionWanted, passwordProblem, readSettingsDraft, sameSettings, type SettingsSave } from '../../shared/chatSettings';

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

const FIELD = 'sunk w-full min-w-0 px-[7px] py-[3px] font-sans text-[13px] text-cream placeholder:text-faint';

/**
 * The chat Settings tab: who you are in chat, the password NickServ knows you
 * by, the channels a connect joins, and the connection itself.
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
export default function ChatSettings({ view, wide, onConnected }: { view: ChatView; wide: boolean; onConnected: () => void }): ReactNode {
    const id = useId();
    const saved = view.settings;
    /* Null while untouched, so the field follows what is saved. */
    const [nickDraft, setNickDraft] = useState<string | null>(null);
    const [channelsDraft, setChannelsDraft] = useState<string | null>(null);
    const [password, setPassword] = useState('');
    const [forget, setForget] = useState(false);
    const [refusal, setRefusal] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const nick = nickDraft ?? saved.nick ?? '';
    const channels = channelsDraft ?? formatAutoJoin(saved.autoJoin);
    const reading = readSettingsDraft({ nick, channels });
    const passwordNote = password === '' ? null : passwordProblem(password);
    const valid = reading.ok && passwordNote === null;
    const changed = !reading.ok || !sameSettings(reading.draft, saved.nick, saved.autoJoin) || password !== '' || forget;
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
        const form: SettingsSave = { nick, channels };
        if (password !== '') form.password = password;
        else if (forget) form.password = null;
        const refused = await window.zanaris.chat.saveSettings(form);
        if (refused !== null) {
            setRefusal(refused);
            return false;
        }
        setNickDraft(null);
        setChannelsDraft(null);
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

    return (
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <div className="sunk mx-2.5 min-h-0 flex-1 overflow-y-auto px-2.5 py-2.5 leading-[1.45]">
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
                            className={FIELD}
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
                            className={FIELD}
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
                        <input
                            id={`${id}-channels`}
                            value={channels}
                            autoComplete="off"
                            spellCheck={false}
                            placeholder="#LostHQ, #2004scape"
                            aria-invalid={shows('channels')}
                            aria-describedby={`${id}-channels-note`}
                            onChange={e => edit(() => setChannelsDraft(e.target.value))}
                            className={FIELD}
                        />
                        {note('channels') ?? (
                            <span id={`${id}-channels-note`} className="text-[12px] text-dim">
                                Joined every time you connect. Closing a channel's tab leaves it until the next connect.
                            </span>
                        )}
                    </div>
                </div>

                {refusal !== null && (
                    <p role="alert" className="mt-2.5 text-[12px] text-warn">
                        {refusal}
                    </p>
                )}
            </div>

            {/* Actions run along the bottom of a panel here, as they do in the client's own interfaces. */}
            <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-2">
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
