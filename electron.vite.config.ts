import { readFileSync } from 'node:fs';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The game revision the bundled engine is, stamped into the main bundle.
const lock = JSON.parse(readFileSync('engine.lock.json', 'utf8')) as { revision: number };

// Uses electron-vite's default entry conventions:
//   src/main/index.ts, src/preload/index.ts, src/renderer/index.html
export default defineConfig({
    main: { plugins: [externalizeDepsPlugin()], define: { __ENGINE_REVISION__: JSON.stringify(lock.revision) } },
    preload: { plugins: [externalizeDepsPlugin()] },
    renderer: { plugins: [react(), tailwindcss()] }
});
