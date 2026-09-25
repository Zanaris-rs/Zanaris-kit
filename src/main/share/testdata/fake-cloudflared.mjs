// A stand-in for cloudflared in quickTunnel's tests: it prints what the real
// one prints, in the order it prints it, and behaves as FAKE_CF_MODE says.
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
const mode = process.env.FAKE_CF_MODE ?? 'ok';
const eol = mode === 'crlf' ? '\r\n' : '\n';
const http2 = args.includes('--protocol') && args[args.indexOf('--protocol') + 1] === 'http2';
const host = process.env.FAKE_CF_HOST ?? 'brave-otter-lamp-test';

if (process.env.FAKE_CF_RECORD) appendFileSync(process.env.FAKE_CF_RECORD, `${JSON.stringify({ pid: process.pid, args, env: Object.keys(process.env) })}\n`);

const say = line => process.stderr.write(`2026-09-16T10:00:00Z INF ${line}${eol}`);
const later = (ms, fn) => setTimeout(fn, ms);

function announce() {
    say('Thank you for trying Cloudflare Tunnel. Doing so, without a Cloudflare account, is a quick way to experiment. See https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/do-more-with-tunnels/trycloudflare');
    say('Requesting new quick Tunnel on trycloudflare.com... (api https://api.trycloudflare.com/tunnel)');
    say('+--------------------------------------------------------------------------------------------+');
    say('|  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |');
    say(`|  https://${host}.trycloudflare.com                                          |`);
    say('+--------------------------------------------------------------------------------------------+');
}

function register() {
    say(`Registered tunnel connection connIndex=0 connection=abc event=0 ip=198.41.192.7 location=lhr01 protocol=${http2 ? 'http2' : 'quic'}`);
}

function fail() {
    say('ERR Failed to dial a quic connection error="failed to dial to edge with quic: timeout: no recent network activity"');
    say('ERR initial tunnel connection failed');
    later(10, () => process.exit(1));
}

// Stay up until told to stop, the way the real one does.
const keepAlive = setInterval(() => {}, 1 << 30);
process.on('SIGTERM', () => {
    if (mode === 'ignore-term') return;
    say('Initiating graceful shutdown due to signal terminated ...');
    clearInterval(keepAlive);
    later(10, () => process.exit(0));
});

switch (mode) {
    case 'ok':
    case 'crlf':
    case 'ignore-term':
        announce();
        later(20, register);
        break;
    case 'quic-fail':
        announce();
        if (http2) later(20, register);
        else fail();
        break;
    case 'always-fail':
        announce();
        fail();
        break;
    case 'flood': {
        const junk = 'x'.repeat(199);
        for (let i = 0; i < 10_000; i++) say(junk);
        announce();
        later(20, register);
        break;
    }
    case 'crash-after-ready':
        announce();
        later(20, register);
        later(150, () => process.exit(3));
        break;
    default:
        say(`ERR unknown FAKE_CF_MODE ${mode}`);
        process.exit(2);
}
