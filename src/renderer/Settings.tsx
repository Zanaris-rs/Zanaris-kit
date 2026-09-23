import { useEffect, useState, type ReactNode } from 'react';
import type { SettingsState } from '../shared/ipc';
import Servers, { QuietButton } from './settings/Servers';

/**
 * The Settings window's page. One window for the whole app, so everything on
 * it is app-wide. One section today, Servers. A section menu arrives with the
 * second section, since a menu listing one entry would be decoration.
 *
 * Framed as a tool pane's body is (`Shell.tsx` gives one `bg-ink tile`): the
 * kit's panels are raised stone with their lists sunk into it, and a page on
 * ink alone reads as the inverse of every other panel in the app.
 */
export default function Settings(): ReactNode {
    const [state, setState] = useState<SettingsState | null>(null);

    useEffect(() => {
        let alive = true;
        void window.zanaris.settings.get().then(s => {
            if (alive && s) setState(s);
        });
        const unsubscribe = window.zanaris.settings.onState(setState);
        return () => {
            alive = false;
            unsubscribe();
        };
    }, []);

    return (
        <div className="tile flex h-full flex-col bg-ink text-cream">
            <h1 className="px-2.5 pt-2.5 pb-1.5 font-pixel text-[15px] text-gold">Servers</h1>
            {state && <Servers view={state.servers} />}

            {/*
             * The two files behind all of this, for the fields no form here
             * exposes. `servers.json` is safe to edit with the kit open — it is
             * re-read whenever a window regains focus. `state.json` is not: the
             * kit reads it once at launch and writes it as you go, so an edit
             * made now is overwritten by the next save. The note says so rather
             * than leaving somebody to lose their work and wonder.
             */}
            <div className="flex flex-col gap-1 border-t border-edge-dark px-2.5 pt-2 pb-2">
                <div className="flex flex-wrap items-center gap-1.5">
                    <QuietButton onClick={() => void window.zanaris.settings.editServers()}>Edit server list…</QuietButton>
                    <QuietButton onClick={() => void window.zanaris.settings.editState()}>Edit state.json…</QuietButton>
                </div>
                <p className="text-[12px] text-dim">The server list is re-read when a window regains focus. state.json is read only at launch and rewritten as you go, so quit the kit before editing it by hand.</p>
            </div>
        </div>
    );
}
