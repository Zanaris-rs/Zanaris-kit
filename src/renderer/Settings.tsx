import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { SettingsState } from '../shared/ipc';
import { TAB_BAR_HEIGHT } from '../shared/layout';
import type { ThemeDraft } from '../shared/themes';
import type { Editing } from '../main/appearance.ts';
import Appearance from './settings/Appearance';
import Servers, { QuietButton } from './settings/Servers';
import Tab from './tab';
import TopBar from './topBar';
import { applyTheme } from './theme';

type Section = 'servers' | 'appearance';

const SECTIONS: readonly { id: Section; label: string }[] = [
    { id: 'servers', label: 'Servers' },
    { id: 'appearance', label: 'Appearance' }
];

/** A game window's tab bar's height, so the window buttons sit on both the same. */
const BAR: CSSProperties = { height: TAB_BAR_HEIGHT, flexShrink: 0 };

/** The theme being edited and what its editor opened on. Held here rather than in the editor so a trip to Servers and back keeps it. */
export interface ThemeEditing {
    initial: ThemeDraft;
    draft: ThemeDraft;
}

/**
 * Tells main about the theme being edited, which every window wears until the
 * editor closes — one report in flight at a time, the newest waiting its turn
 * and anything between dropped. A colour well reports on every step of a drag
 * and each report restyles every window, so queueing them all would leave the
 * windows trailing the well long after it stopped.
 */
function useReportEditing(editing: ThemeEditing | null): void {
    const waiting = useRef<{ report: Editing | null } | null>(null);
    const sending = useRef(false);
    useEffect(() => {
        waiting.current = {
            report: editing
                ? {
                      look: { colors: editing.draft.colors, background: editing.draft.background },
                      name: editing.draft.name,
                      changed: JSON.stringify(editing.draft) !== JSON.stringify(editing.initial)
                  }
                : null
        };
        if (sending.current) return;
        sending.current = true;
        void (async () => {
            while (waiting.current) {
                const { report } = waiting.current;
                waiting.current = null;
                try {
                    await window.zanaris.appearance.editing(report);
                } catch {
                    // Nothing to show: the next change reports again, and closing the editor reports null.
                }
            }
            sending.current = false;
        })();
    }, [editing]);
}

/**
 * The Settings window's page. One window for the whole app, so everything on
 * it is app-wide. Two sections, Servers and Appearance, chosen from a strip of
 * tabs across the top, drawn as chat's and Your world's are; it opens on
 * Servers.
 *
 * Below the strip, framed as a tool pane's body is, a `tile`: the kit's
 * panels are raised stone with their lists sunk into it, and a page on ink
 * alone reads as the inverse of every other panel in the app. The app theme's
 * picture is the box around it, showing through that stone.
 *
 * It wears `state.appearance.look`, which main makes the draft's look while
 * the theme editor is open. The draft is held here, above the sections, so
 * switching to Servers and back returns to the editor as it was.
 */
export default function Settings(): ReactNode {
    const [state, setState] = useState<SettingsState | null>(null);
    const [section, setSection] = useState<Section>('servers');
    const [editing, setEditing] = useState<ThemeEditing | null>(null);
    useReportEditing(editing);

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

    // Settings wears the app theme, since it belongs to no one server — or,
    // while the editor is open, the theme being edited, as every window does.
    useLayoutEffect(() => {
        if (state) applyTheme(state.appearance.look);
    }, [state]);

    // Nothing but ink until the first state, as the shell does: drawn before
    // it, the frame would show 2004 stone for a beat under any other theme.
    if (!state) return <div className="h-full bg-ink" />;

    return (
        // The picture is the outer box's own image, under the frame's see-through stone.
        <div className="picture flex h-full flex-col bg-ink text-cream">
            {/*
             * The sections are a strip across the top, as a game window's tabs
             * are, because on macOS both are their window's title bar. Buttons with
             * aria-current, as chat's and Your world's rows are, since there is
             * no tabpanel here that a tablist could point at.
             */}
            <TopBar frame={state.frame} style={BAR}>
                <div role="group" aria-label="Settings" className="flex min-w-0 flex-1 items-center gap-[5px]">
                    {SECTIONS.map(s => (
                        <Tab key={s.id} role="button" label={s.label} open={section === s.id} onSelect={() => setSection(s.id)} />
                    ))}
                </div>
            </TopBar>

            {/* The 8px above the first section is the gap the row of sections used to leave under itself, when it sat inside this stone. */}
            <div className="tile flex min-h-0 flex-1 flex-col pt-2">
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
                {section === 'appearance' && <Appearance view={state.appearance} editing={editing} setEditing={setEditing} />}
            </div>
        </div>
    );
}
