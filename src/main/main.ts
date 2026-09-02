import { app, BrowserWindow, shell, session } from 'electron';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveServerTarget, isReachable, type ServerTarget } from './serverUrl';
import { WebSocketTap } from './tap';
import { HandshakeReader, type Handshake } from './seedProbe';
import { findAdjacentPair, seedWordFromRandom, type RngDump } from './rngProbe';
import { loadPrivateKey, decryptLoginBlock } from './rsa';

const OFFLINE_PAGE = resolve(__dirname, '../../static/offline.html');
const SEAM_ENABLED = process.env.SWIFTKIT_SEAM !== '0';
const RNG_PROBE_ENABLED = process.env.SWIFTKIT_RNG !== '0';

function log(msg: string): void {
    console.log(msg);
}

let win: BrowserWindow | null = null;
let tap: WebSocketTap | null = null;
let target: ServerTarget;
let pollTimer: NodeJS.Timeout | null = null;

function createWindow(): BrowserWindow {
    const gameSession = session.fromPartition('persist:swiftkit-game');

    const w = new BrowserWindow({
        width: 800,
        height: 700,
        minWidth: 640,
        minHeight: 480,
        title: 'SwiftKit',
        backgroundColor: '#000000',
        show: false,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            session: gameSession
        }
    });

    w.once('ready-to-show', () => w.show());

    const allowedOrigin = `http://127.0.0.1:${target.port}`;
    w.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith(allowedOrigin) && !url.startsWith('file://')) {
            event.preventDefault();
            log(`[nav] blocked navigation to ${url}`);
        }
    });
    w.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url);
        return { action: 'deny' };
    });

    return w;
}

/** The spike's whole point: did observing Math.random recover the real seed? */
async function verifySeedRecovery(h: Handshake): Promise<void> {
    log('');
    log('  ── seed recovery spike ────────────────────────────────────');
    log(`  revision (plaintext)  : ${h.revision}${h.reconnect ? ' (reconnect)' : ''}`);
    log(`  server seed hi / lo   : ${h.serverSeedHi} / ${h.serverSeedLo}`);
    log(`  RSA block             : ${h.rsaBlock.length} bytes`);

    let dump: RngDump | null = null;
    try {
        dump = (await win!.webContents.executeJavaScript(
            'window.__swiftkitRng ? window.__swiftkitRng.dump() : null'
        )) as RngDump | null;
    } catch (err) {
        log(`  RNG probe             : read FAILED — ${(err as Error).message}`);
    }

    if (!dump) {
        log('  RNG probe             : NOT INSTALLED — injection did not reach the main world');
        log('  ───────────────────────────────────────────────────────────');
        return;
    }
    log(`  RNG probe             : installed, ${dump.seq} draws observed, window ${dump.values.length}`);

    const pemPath = resolve(target.serverRoot, 'engine/data/config/private.pem');
    if (!existsSync(pemPath)) {
        log(`  oracle                : private.pem not found — cannot verify against ground truth`);
        log('  ───────────────────────────────────────────────────────────');
        return;
    }

    let trueSeeds: [number, number, number, number];
    let magic: number;
    try {
        const decrypted = decryptLoginBlock(h.rsaBlock, loadPrivateKey(pemPath));
        magic = decrypted.magic;
        trueSeeds = decrypted.seeds;
    } catch (err) {
        log(`  oracle                : RSA decrypt FAILED — ${(err as Error).message}`);
        log('  ───────────────────────────────────────────────────────────');
        return;
    }

    log('');
    log(`  [1] RSA magic byte    : ${magic} ${magic === 10 ? 'OK (decrypt correct)' : 'FAIL (expected 10)'}`);

    const plaintextMatch = trueSeeds[2] === h.serverSeedHi && trueSeeds[3] === h.serverSeedLo;
    log(`  [2] seed[2],[3]       : ${trueSeeds[2]}, ${trueSeeds[3]}`);
    log(
        `      vs plaintext wire : ${plaintextMatch ? 'MATCH — 2 of 4 words need no recovery' : 'MISMATCH'}`
    );

    const pair = findAdjacentPair(dump, trueSeeds[0], trueSeeds[1]);
    log(`  [3] seed[0],[1]       : ${trueSeeds[0]}, ${trueSeeds[1]}`);
    if (pair.found) {
        log(`      found in RNG ring : YES at draw #${pair.index} of ${dump.seq}`);
        log(`      candidate pairs   : ${pair.candidates} (consecutive-pair search)`);
        const v = dump.values;
        const i = pair.index! - dump.baseSeq;
        log(`      confirm           : floor(99999999 * ${v[i]!.toFixed(17)}) = ${seedWordFromRandom(v[i]!)}`);
        log(`                          floor(99999999 * ${v[i + 1]!.toFixed(17)}) = ${seedWordFromRandom(v[i + 1]!)}`);
    } else {
        log(`      found in RNG ring : NO — searched ${pair.candidates} consecutive pairs`);
    }

    log('');
    const verdict = magic === 10 && plaintextMatch && pair.found;
    log(`  VERDICT: ${verdict ? 'seed fully recoverable without the private key' : 'recovery FAILED'}`);
    log('  ───────────────────────────────────────────────────────────');
    log('');

    try {
        const at = await win!.webContents.executeJavaScript('window.__swiftkitRng.disarm()');
        log(`[rng] disarmed after ${at} draws — Math.random restored to native`);
    } catch (err) {
        log(`[rng] disarm failed: ${(err as Error).message}`);
    }
}

async function loadWhenReady(w: BrowserWindow): Promise<void> {
    if (await isReachable(target.url)) {
        log(`[main] server reachable — loading ${target.url}`);
        await w.loadURL(target.url);
        return;
    }

    log(`[main] server not reachable at ${target.url} — waiting`);
    await w.loadFile(OFFLINE_PAGE, { query: { url: target.url } });

    pollTimer = setInterval(async () => {
        if (!win || win.isDestroyed()) return;
        if (await isReachable(target.url)) {
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
            log(`[main] server came up — loading ${target.url}`);
            await win.loadURL(target.url);
        }
    }, 2000);
}

app.whenReady().then(async () => {
    target = resolveServerTarget();

    log('');
    log('  SwiftKit — Math.random seed-recovery spike');
    log(`  server root : ${target.serverRoot}`);
    log(`  target      : ${target.url}`);
    log(`  seam        : ${SEAM_ENABLED ? 'ON (CDP, observe-only)' : 'OFF'}`);
    log(`  rng probe   : ${RNG_PROBE_ENABLED ? 'ON' : 'OFF'}`);
    log('');
    log('  >>> Log in when the client loads. The spike reports on login. <<<');
    log('');

    win = createWindow();
    win.on('closed', () => {
        win = null;
    });

    // A BrowserWindow with nothing loaded has no renderer, and CDP commands
    // never resolve against it. Load about:blank first so the debugger has a
    // live target; addScriptToEvaluateOnNewDocument then applies to the *next*
    // document, which is the game page.
    await win.loadURL('about:blank');

    if (SEAM_ENABLED) {
        tap = new WebSocketTap(win.webContents, log, RNG_PROBE_ENABLED);
        const reader = new HandshakeReader(h => {
            void verifySeedRecovery(h);
        }, log);
        tap.onGameFrame = (dir, bytes) => reader.feed(dir, bytes);
        // Must complete before navigating to the game so the probe is registered first.
        await tap.attach();
    }

    await loadWhenReady(win);
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
    if (pollTimer) clearInterval(pollTimer);
    tap?.detach();
});
