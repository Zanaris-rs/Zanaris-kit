import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import type { SettingsState } from '../shared/ipc';
import Appearance from './settings/Appearance';
import Servers, { QuietButton } from './settings/Servers';
import Tab from './tab';
import { applyTheme } from './theme';

type Section = 'servers' | 'appearance';

const SECTIONS: readonly { id: Section; label: string }[] = [
    { id: 'servers', label: 'Servers' },
    { id: 'appearance', label: 'Appearance' }
];

/**
 * The Settings window's page. One window for the whole app, so everything on
 * it is app-wide. Two sections, Servers and Appearance, chosen from a row of
 * tabs drawn as chat's and Your world's are; it opens on Servers.
 *
 * Framed as a tool pane's body is (`Shell.tsx` gives one `bg-ink tile`): the
 * kit's panels are raised stone with their lists sunk into it, and a page on
 * ink alone reads as the inverse of every other panel in the app.
 */
export default function Settings(): ReactNode {
    const [state, setState] = useState<SettingsState | null>(null);
    const [section, setSection] = useState<Section>('servers');

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
        if (state) applyTheme(state.appearance.look);
    }, [state]);

    // Nothing but ink until the first state, as the shell does: drawn before
    // it, the frame would show 2004 stone for a beat under any other theme.
    if (!state) return <div className="h-full bg-ink" />;

    return (
        <div className="tile flex h-full flex-col bg-ink text-cream">
            {/*
             * Buttons with aria-current, as chat's and Your world's rows are,
             * since there is no tabpanel here that a tablist could point at.
             */}
            <div role="group" aria-label="Settings" className="flex flex-wrap items-center gap-[5px] px-2.5 pt-2.5 pb-2">
                {SECTIONS.map(s => (
                    <Tab key={s.id} role="button" label={s.label} open={section === s.id} onSelect={() => setSection(s.id)} />
                ))}
            </div>

            {section === 'servers' && (
                <>
                    <Servers view={state.servers} />

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
                </>
            )}
            {section === 'appearance' && <Appearance view={state.appearance} />}
        </div>
    );
}
