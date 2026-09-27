import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Settings from './Settings';
import Shell from './Shell';
import { WindowBoundary } from './paneNotice';
import './styles.css';

// One bundle, two pages: a server window's shell, and the Settings window at #settings.
const settings = location.hash === '#settings';
const Page = settings ? Settings : Shell;

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <WindowBoundary page={settings ? 'settings' : 'shell'}>
            <Page />
        </WindowBoundary>
    </StrictMode>
);
