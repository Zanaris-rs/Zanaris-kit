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

// The renderer's dev server's port, when a launcher hands one over in PORT;
// Vite's own 5173, or the next free one, otherwise. Builds never read it.
const devServer = process.env.PORT ? { port: Number(process.env.PORT), strictPort: true } : {};

// Uses electron-vite's default entry conventions:
//   src/main/index.ts, src/preload/index.ts, src/renderer/index.html
export default defineConfig({
    main: { plugins: [externalizeDepsPlugin()], define: { __ENGINE_RECIPES__: JSON.stringify(recipes) } },
    preload: { plugins: [externalizeDepsPlugin()] },
    // Every asset ships as a file: the shell's CSP refuses data: images, so a
    // small sprite inlined as one would draw nothing.
    renderer: { plugins: [react(), tailwindcss()], build: { assetsInlineLimit: 0 }, server: devServer }
});
