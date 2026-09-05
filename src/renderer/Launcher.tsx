import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { CatalogState, ServerInfo } from '../shared/ipc';

function hostOf(url: string): string {
    try {
        return new URL(url).host;
    } catch {
        return url;
    }
}

function describe(server: ServerInfo): string {
    const parts = [server.revision === null ? 'rev unknown' : `rev ${server.revision}`];
    parts.push(server.wiki ? `${hostOf(server.wiki.home)} wiki` : 'no wiki');
    if (server.notes) parts.push(server.notes);
    if (server.openCount > 0) parts.push(server.openCount === 1 ? '1 window open' : `${server.openCount} windows open`);
    return parts.join(' · ');
}

function ServerRow({ server, onOpen, onRemove }: { server: ServerInfo; onOpen: () => void; onRemove: () => void }): ReactNode {
    return (
        <li className="flex items-center gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0 flex-1">
                <div className="truncate text-bone">{server.name}</div>
                <div className="truncate text-[11px] text-dim">{describe(server)}</div>
                <div className="truncate font-mono text-[11px] text-dim/70">{hostOf(server.url)}</div>
            </div>
            {server.openCount === 0 && (
                <button type="button" onClick={onRemove} className="shrink-0 text-[11px] text-dim hover:text-brass">
                    Remove
                </button>
            )}
            <button
                type="button"
                onClick={onOpen}
                className="shrink-0 border border-brass px-3 py-1 text-[12px] text-brass hover:bg-brass hover:text-ink"
            >
                {server.openCount > 0 ? 'Open another' : 'Open'}
            </button>
        </li>
    );
}

const field = 'min-w-0 border border-line bg-surface px-2 py-1 text-[12px] text-bone placeholder:text-dim/60 focus:border-brass';

export default function Launcher(): ReactNode {
    const [state, setState] = useState<CatalogState | null>(null);
    const [name, setName] = useState('');
    const [url, setUrl] = useState('');
    const [revision, setRevision] = useState('');
    const [wiki, setWiki] = useState('');
    const [notes, setNotes] = useState('');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;
        void window.swiftkit.launcher.get().then(s => {
            if (alive) setState(s);
        });
        const unsubscribe = window.swiftkit.launcher.onState(setState);
        return () => {
            alive = false;
            unsubscribe();
        };
    }, []);

    const run = async (action: Promise<{ ok: true } | { ok: false; error: string }>): Promise<boolean> => {
        const result = await action;
        setError(result.ok ? null : result.error);
        return result.ok;
    };

    const submit = async (event: FormEvent): Promise<void> => {
        event.preventDefault();
        const rev = revision.trim();
        const ok = await run(
            window.swiftkit.launcher.add({
                name,
                url,
                revision: rev === '' ? null : Number(rev),
                wikiHome: wiki.trim() === '' ? null : wiki,
                notes: notes.trim() === '' ? null : notes
            })
        );
        if (ok) {
            setName('');
            setUrl('');
            setRevision('');
            setWiki('');
            setNotes('');
        }
    };

    return (
        <div className="flex h-full flex-col">
            <header className="border-b border-line px-4 pt-4 pb-3">
                <h1 className="text-[15px] font-medium text-bone">SwiftKit</h1>
                <p className="mt-1 text-[12px] text-dim">Open a server in a new window. Each window knows its server and keeps playing while you use the others.</p>
                {state?.recovered && (
                    <p className="mt-2 border border-brass/50 px-2 py-1 text-[11px] text-brass">
                        Your server list couldn't be read and was reset to the defaults. The old file was kept beside it.
                    </p>
                )}
            </header>

            <ul className="min-h-0 flex-1 overflow-y-auto">
                {state?.servers.map(server => (
                    <ServerRow
                        key={server.id}
                        server={server}
                        onOpen={() => void run(window.swiftkit.launcher.open(server.id))}
                        onRemove={() => void run(window.swiftkit.launcher.remove(server.id))}
                    />
                ))}
            </ul>

            <form onSubmit={submit} className="border-t border-line px-4 py-3">
                <h2 className="mb-2 text-[12px] font-medium text-bone">Add a server</h2>
                <div className="grid grid-cols-[1fr_96px] gap-2">
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" spellCheck={false} className={field} />
                    <input value={revision} onChange={e => setRevision(e.target.value)} placeholder="Revision" inputMode="numeric" className={field} />
                    <input value={url} onChange={e => setUrl(e.target.value)} placeholder="host/rs2.cgi?lowmem=1" spellCheck={false} autoComplete="off" className={`col-span-2 font-mono ${field}`} />
                    <input value={wiki} onChange={e => setWiki(e.target.value)} placeholder="Wiki address, optional" spellCheck={false} autoComplete="off" className={`col-span-2 font-mono ${field}`} />
                    <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes, optional" className={`col-span-2 ${field}`} />
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                    <p className="min-h-[1.2em] text-[11px]" aria-live="polite">
                        {error ? <span className="text-brass">{error}</span> : <span className="text-dim">Revision and wiki can be left blank.</span>}
                    </p>
                    <button type="submit" className="shrink-0 border border-line px-3 py-1 text-[12px] text-bone hover:border-brass hover:text-brass">
                        Add and open
                    </button>
                </div>
            </form>
        </div>
    );
}
