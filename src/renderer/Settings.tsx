import { useEffect, useState, type ReactNode } from 'react';
import type { SettingsState } from '../shared/ipc';
import Servers from './settings/Servers';

/**
 * The Settings window's page. One window for the whole app, so everything on
 * it is app-wide. One section today, Servers. A section menu arrives with the
 * second section, since a menu listing one entry would be decoration.
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
        <div className="flex h-full flex-col bg-ink text-cream">
            <h1 className="px-2.5 pt-2.5 pb-1.5 font-pixel text-[15px] text-gold">Servers</h1>
            {state && <Servers view={state.servers} />}
        </div>
    );
}
