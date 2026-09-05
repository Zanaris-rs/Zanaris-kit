import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Launcher from './Launcher';
import Shell from './Shell';
import './styles.css';

/** Main loads the same bundle as `?view=launcher` or `?view=shell`. */
const view = new URLSearchParams(location.search).get('view');

createRoot(document.getElementById('root')!).render(<StrictMode>{view === 'shell' ? <Shell /> : <Launcher />}</StrictMode>);
