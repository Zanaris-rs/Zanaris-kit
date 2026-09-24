import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Settings from './Settings';
import Shell from './Shell';
import './styles.css';

// One bundle, two pages: a server window's shell, and the Settings window at #settings.
const Page = location.hash === '#settings' ? Settings : Shell;

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <Page />
    </StrictMode>
);
