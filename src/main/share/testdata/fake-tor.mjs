// A stand-in for Tor in torProcess's tests: it logs to stdout the lines the
// real 0.4.9.14 logs, writes the onion address where the real one does,
// before it has bootstrapped, and behaves as FAKE_TOR_MODE says.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const mode = process.env.FAKE_TOR_MODE ?? 'ok';
const value = flag => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const hsDir = value('--HiddenServiceDir');
const socks = value('--SocksPort');
const host = process.env.FAKE_TOR_HOST ?? `${'a'.repeat(52)}2345`;

const say = (level, line) => process.stdout.write(`Oct 18 19:36:15.000 [${level}] ${line}\n`);
const later = (ms, fn) => setTimeout(fn, ms);

const keepAlive = setInterval(() => {}, 1 << 30);
process.on('SIGTERM', () => {
    say('notice', 'Catching signal TERM, exiting cleanly.');
    clearInterval(keepAlive);
    later(10, () => process.exit(0));
});

say('notice', 'Tor 0.4.9.14 running on Darwin with Libevent 2.1.12-stable.');
switch (mode) {
    case 'ok':
        if (socks === 'auto') say('notice', 'Opened Socks listener connection (ready) on 127.0.0.1:49731');
        if (hsDir) {
            later(20, () => {
                mkdirSync(hsDir, { recursive: true, mode: 0o700 });
                writeFileSync(join(hsDir, 'hostname'), `${host}.onion\n`);
            });
        }
        later(40, () => say('notice', 'Bootstrapped 50% (loading_descriptors): Loading relay descriptors'));
        later(80, () => say('notice', 'Bootstrapped 100% (done): Done'));
        break;
    case 'bind-fail':
        say('warn', 'Could not bind to 127.0.0.1:9050: Address already in use. Is Tor already running?');
        later(10, () => process.exit(1));
        break;
    default:
        say('err', `unknown FAKE_TOR_MODE ${mode}`);
        process.exit(2);
}
