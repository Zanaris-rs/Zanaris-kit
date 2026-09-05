import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { ServerInfo } from '../shared/ipc';

/** The host, plus the path when it carries meaning (Lost City Labs keys worlds by path). */
function whereOf(url: string): string {
    try {
        const u = new URL(url);
        return u.pathname === '/' || u.pathname === '/rs2.cgi' ? u.host : `${u.host}${u.pathname}`;
    } catch {
        return url;
    }
}

function ServerRow({ server, onOpen }: { server: ServerInfo; onOpen: (id: string) => void }): ReactNode {
    return (
        <li className="flex items-center gap-3 border-b border-line px-4 py-3">
            <span
                className={`h-1.5 w-1.5 shrink-0 ${server.open ? 'bg-live' : 'bg-line'}`}
                aria-label={server.open ? 'open' : 'closed'}
            />
            <div className="min-w-0 flex-1">
                <div className="truncate text-bone">{server.name}</div>
                <div className="truncate font-mono text-[11px] text-dim">{whereOf(server.url)}</div>
            </div>
            <button
                type="button"
                onClick={() => onOpen(server.id)}
                className={`shrink-0 border px-3 py-1 text-[12px] ${
                    server.open
                        ? 'border-line text-dim hover:border-dim hover:text-bone'
                        : 'border-brass text-brass hover:bg-brass hover:text-ink'
                }`}
            >
                {server.open ? 'Focus' : 'Open'}
            </button>
        </li>
    );
}

export default function App(): ReactNode {
    const [servers, setServers] = useState<ServerInfo[]>([]);
    const [address, setAddress] = useState('');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;
        void window.swiftkit.servers.list().then(list => {
            if (alive) setServers(list);
        });
        const unsubscribe = window.swiftkit.servers.onState(setServers);
        return () => {
            alive = false;
            unsubscribe();
        };
    }, []);

    const open = async (id: string): Promise<void> => {
        const result = await window.swiftkit.servers.open(id);
        setError(result.ok ? null : result.error);
    };

    const submit = async (event: FormEvent): Promise<void> => {
        event.preventDefault();
        const result = await window.swiftkit.servers.openUrl(address);
        if (result.ok) {
            setAddress('');
            setError(null);
        } else {
            setError(result.error);
        }
    };

    const openCount = servers.filter(s => s.open).length;

    return (
        <div className="flex h-full flex-col">
            <header className="border-b border-line px-4 pt-4 pb-3">
                <h1 className="text-[15px] font-medium text-bone">SwiftKit</h1>
                <p className="mt-1 text-[12px] text-dim">
                    Each server opens in its own window and keeps playing while you use the others.
                </p>
            </header>

            <ul className="min-h-0 flex-1 overflow-y-auto">
                {servers.map(server => (
                    <ServerRow key={server.id} server={server} onOpen={open} />
                ))}
            </ul>

            <form onSubmit={submit} className="border-t border-line px-4 py-3">
                <label htmlFor="address" className="mb-1 block text-[11px] text-dim">
                    Another server
                </label>
                <div className="flex gap-2">
                    <input
                        id="address"
                        value={address}
                        onChange={e => setAddress(e.target.value)}
                        placeholder="host/rs2.cgi?lowmem=1"
                        spellCheck={false}
                        autoComplete="off"
                        className="min-w-0 flex-1 border border-line bg-surface px-2 py-1 font-mono text-[12px] text-bone placeholder:text-dim/60 focus:border-brass"
                    />
                    <button
                        type="submit"
                        className="shrink-0 border border-line px-3 py-1 text-[12px] text-bone hover:border-brass hover:text-brass"
                    >
                        Open
                    </button>
                </div>
                <p className="mt-2 min-h-[1.2em] text-[11px]" aria-live="polite">
                    {error ? (
                        <span className="text-brass">{error}</span>
                    ) : (
                        <span className="text-dim">
                            {openCount === 0 ? 'Nothing open.' : `${openCount} open.`}
                        </span>
                    )}
                </p>
            </form>
        </div>
    );
}
