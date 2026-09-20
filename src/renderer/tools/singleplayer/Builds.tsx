import { useState, type CSSProperties, type ReactNode } from 'react';
import { worldRunning, type BuildLine, type SinglePlayerView } from '../../../shared/singleplayer';

/*
 * `.btn` and the base `button` rule are unlayered CSS, which beats a Tailwind
 * utility whatever the order, so every button's size is inline and a quiet
 * button's colour sits on a span inside it.
 */
const BUTTON_SIZE: CSSProperties = { fontSize: 12, padding: '0 6px' };

const STATE: Record<BuildLine['state'], string> = {
    absent: 'Not downloaded',
    downloading: 'Downloading',
    installed: 'Installed',
    outdated: 'Update needed',
    unavailable: 'Not in this version of the kit'
};

function megabytes(bytes: number): string {
    return `${Math.round(bytes / 1_000_000)} MB`;
}

function QuietButton({ onClick, disabled = false, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }): ReactNode {
    return (
        <button type="button" disabled={disabled} onClick={onClick} style={BUTTON_SIZE} className="btn group shrink-0">
            <span className={disabled ? 'text-faint' : 'text-dim group-hover:text-cream'}>{children}</span>
        </button>
    );
}

/** What a line's state reads as, beside its name. The one the world runs is In use once it is on disk. */
function stateLabel(line: BuildLine, inUse: boolean): string {
    if (line.state === 'downloading') return `Downloading ${Math.floor((line.progress ?? 0) * 100)}%`;
    if (inUse && line.state === 'installed') return 'In use';
    return STATE[line.state];
}

/** One build line: what it is, where it stands here, and what can be done with it. */
function Row({ line, inUse, running, busy, act }: { line: BuildLine; inUse: boolean; running: boolean; busy: boolean; act: (change: () => Promise<string | null | void>) => void }): ReactNode {
    const api = window.zanaris.singlePlayer;
    const onDisk = line.state === 'installed' || line.state === 'outdated';
    const fetchable = line.state === 'absent' || line.state === 'outdated';
    const warn = line.state === 'outdated' || line.error !== null;
    return (
        <li className="py-1.5">
            <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-cream">{line.name}</span>
                <span className="text-[12px] text-dim">
                    rev {line.revision}
                    {line.size !== null && ` · ${megabytes(line.size)}`}
                </span>
                <span className={`ml-auto text-[12px] ${warn ? 'text-warn' : inUse ? 'text-cream' : 'text-dim'}`}>{stateLabel(line, inUse)}</span>
            </div>
            {line.note && <p className="text-[12px] text-warn">{line.note}</p>}
            <p className="font-mono text-[11px] text-faint">
                engine {line.engine.slice(0, 8)} · content {line.content.slice(0, 8)}
            </p>
            {line.error && <p className="text-[12px] text-warn">{line.error}</p>}
            <div className="mt-1 flex flex-wrap items-center gap-1">
                {/* Use on a line that is not here downloads it first; main asks before restarting a running world. */}
                {!inUse && (line.state === 'installed' || fetchable) && (
                    <QuietButton disabled={busy} onClick={() => act(() => api.useBuild(line.id))}>
                        {line.state === 'installed' ? 'Use' : line.state === 'outdated' ? 'Update and use' : 'Download and use'}
                    </QuietButton>
                )}
                {fetchable && (
                    <QuietButton disabled={busy} onClick={() => act(() => api.downloadBuild(line.id))}>
                        {line.state === 'outdated' ? 'Update' : `Download`}
                    </QuietButton>
                )}
                {/* Text, not a button, as Delete is in Characters: rare, and main asks first. The running build is refused by main too. */}
                {onDisk && !(inUse && running) && (
                    <button type="button" disabled={busy} onClick={() => act(() => api.removeBuild(line.id))} className="group ml-0.5">
                        <span className="text-[12px] text-dim underline-offset-2 group-hover:text-alarm group-hover:underline">Remove</span>
                    </button>
                )}
            </div>
        </li>
    );
}

/**
 * The Builds section: every build line this kit knows, where each stands on
 * this computer, and the one the world runs. The lines and their states are
 * main's; this only asks for a switch, a download or a removal.
 */
export default function Builds({ view }: { view: SinglePlayerView }): ReactNode {
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const running = worldRunning(view.status);

    /** Runs a request, and shows what main answers when it refuses. */
    const act = (change: () => Promise<string | null | void>): void => {
        setBusy(true);
        setNotice(null);
        void change()
            .then(refusal => {
                if (typeof refusal === 'string') setNotice(refusal);
            })
            .finally(() => setBusy(false));
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="sunk mx-2.5 mt-2.5 min-h-0 flex-1 overflow-y-auto px-2 py-1">
                <ul>
                    {view.builds.map(line => (
                        <Row key={line.id} line={line} inUse={line.id === view.selected} running={running} busy={busy} act={act} />
                    ))}
                </ul>
            </div>
            {notice !== null && (
                <p role="alert" className="mx-2.5 mt-1.5 text-[12px] text-warn">
                    {notice}
                </p>
            )}
            <p className="px-2.5 pt-1.5 text-[12px] text-dim">Each revision keeps its own characters. Characters can copy one from this revision to another.</p>
            <p className="px-2.5 pt-1 pb-2 text-[12px] text-dim">Builds download from the kit's releases on GitHub, and each is checked against the digest this version of the kit carries before it runs.</p>
        </div>
    );
}
