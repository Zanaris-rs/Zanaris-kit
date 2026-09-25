import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import type { SettingsState } from '../shared/ipc';
import Servers, { QuietButton } from './settings/Servers';
import { applyTheme } from './theme';

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

    // Settings wears the app theme: it belongs to no one server.
    useLayoutEffect(() => {
        if (state) applyTheme(state.appearance.colors);
    }, [state]);

    return (
        <div className="tile flex h-full flex-col bg-ink text-cream">
            <h1 className="px-2.5 pt-2.5 pb-1.5 font-pixel text-[15px] text-gold">Servers</h1>
            {state && <Servers view={state.servers} />}

            {/*
             * The file behind the list, for the fields no form here exposes —
             * a server's worlds source, its bookmarks, its map. Safe to edit
             * with the kit open, which is what the note says: `servers.json` is
             * re-read whenever a window regains focus.
             */}
            <div className="flex flex-col gap-1 border-t border-edge-dark px-2.5 pt-2 pb-2">
                {/* In a row of its own: the button sizes to its label, where a column would stretch it the width of the window. */}
                <div className="flex items-center">
                    <QuietButton onClick={() => void window.zanaris.settings.editServers()}>Edit server list…</QuietButton>
                </div>
                <p className="text-[12px] text-dim">Opens servers.json. The kit re-reads it whenever a window regains focus.</p>
            </div>
        </div>
    );
}
