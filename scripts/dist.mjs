// npm run dist: a local package for this platform, never published.
// The kit ships no engine: single player downloads a build the first time it
// opens, so there is nothing to stage here and nothing to check afterwards.
import { execFileSync } from 'node:child_process';

const onWindows = process.platform === 'win32';
const npm = onWindows ? 'npm.cmd' : 'npm';
const run = args => execFileSync(npm, args, { stdio: 'inherit', shell: onWindows });

run(['run', 'build']);
run(['exec', '--', 'electron-builder', '--publish', 'never']);
