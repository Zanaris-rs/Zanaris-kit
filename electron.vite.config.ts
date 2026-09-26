import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Single player's build lines, stamped into the main bundle: the kit runs no
// build these do not pin. Read as they are; the main process checks each one.
const recipes = readdirSync('engines')
    .filter(file => file.endsWith('.json'))
    .sort()
    .map(file => JSON.parse(readFileSync(join('engines', file), 'utf8')) as unknown);

// Uses electron-vite's default entry conventions:
//   src/main/index.ts, src/preload/index.ts, src/renderer/index.html
export default defineConfig({
    main: { plugins: [externalizeDepsPlugin()], define: { __ENGINE_RECIPES__: JSON.stringify(recipes) } },
    preload: { plugins: [externalizeDepsPlugin()] },
    // Every asset ships as a file: the shell's CSP refuses data: images, so a
    // small sprite inlined as one would draw nothing.
    renderer: { plugins: [react(), tailwindcss()], build: { assetsInlineLimit: 0 } }
});
