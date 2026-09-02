import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Uses electron-vite's default entry conventions:
//   src/main/index.ts, src/preload/index.ts, src/renderer/index.html
export default defineConfig({
    main: { plugins: [externalizeDepsPlugin()] },
    preload: { plugins: [externalizeDepsPlugin()] },
    renderer: { plugins: [react(), tailwindcss()] }
});
