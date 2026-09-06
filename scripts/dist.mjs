// npm run dist: a local package for this platform, never published.
// Stages the engine first when engine-dist/ is missing.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const onWindows = process.platform === 'win32';
const npm = onWindows ? 'npm.cmd' : 'npm';
const run = args => execFileSync(npm, args, { stdio: 'inherit', shell: onWindows });

if (!existsSync('engine-dist/VERSION.json')) run(['run', 'stage:engine']);
run(['run', 'build']);
run(['exec', '--', 'electron-builder', '--publish', 'never']);
