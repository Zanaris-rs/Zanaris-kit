import { app, net } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { accessSync, chmodSync, constants, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { APP_ID } from '../branding.ts';
import { downloadChecked } from '../download.ts';
import { feedFrom, installMode, MAC_HELPER, type HandOff } from '../update.ts';
import type { UpdateIo } from './service.ts';

const run = promisify(execFile);

function writable(path: string): boolean {
    try {
        accessSync(path, constants.W_OK);
        return true;
    } catch {
        return false;
    }
}

/**
 * Starts an install as the kit exits. Nothing is waited for: the Mac's helper
 * and the Windows installer outlive the kit, and the AppImage's replacement is
 * done before this returns. An AppImage that cannot be replaced says so in the
 * result file, which the next launch reads, as the Mac's helper does.
 */
function handOff(plan: HandOff, log: (msg: string) => void): void {
    // A spawn that fails — an installer an antivirus took away — says so as an
    // 'error' event, after this has returned: heard, it is logged rather than
    // thrown at a kit on its way out, and the next launch finds the attempt failed.
    const refused = (what: string) => (err: Error) => log(`[update] could not start ${what}: ${err.message}`);
    switch (plan.kind) {
        case 'mac':
            spawn('/bin/sh', ['-c', MAC_HELPER, 'zanaris-update', ...plan.args], { detached: true, stdio: 'ignore' }).on('error', refused('the helper')).unref();
            return;
        case 'windows':
            spawn(plan.installer, plan.args, { detached: true, stdio: 'ignore' }).on('error', refused('the installer')).unref();
            return;
        case 'appimage':
            try {
                copyFileSync(plan.from, plan.part);
                chmodSync(plan.part, 0o755);
                renameSync(plan.part, plan.to);
                if (plan.remove) rmSync(plan.remove, { force: true });
                writeFileSync(plan.result, 'ok');
            } catch (err) {
                // The kit is on its way out: nothing here may throw. A result that
                // cannot be written leaves the next launch its own words for it.
                try {
                    rmSync(plan.part, { force: true });
                    writeFileSync(plan.result, `The AppImage couldn't be replaced: ${(err as Error).message}`);
                } catch {
                    // As above.
                }
                return;
            }
            if (plan.relaunch) spawn(plan.to, [], { detached: true, stdio: 'ignore' }).on('error', refused('the new AppImage')).unref();
    }
}

/** The update's io over Electron and the file system. It decides nothing: `update.ts` does. */
export function updateIo(log: (msg: string) => void): UpdateIo {
    const feed = feedFrom(process.env.ZANARIS_UPDATE_FEED);
    if (feed.latest !== feedFrom(undefined).latest) log(`[update] reading releases from ${feed.latest}`);
    return {
        current: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        dir: join(app.getPath('userData'), 'updates'),
        join,
        feed,
        mode: installMode({ platform: process.platform, packaged: app.isPackaged, execPath: process.execPath, appImage: process.env.APPIMAGE, exists: existsSync, writable }),
        pid: process.pid,
        fetchLatest: async () => {
            const res = await net.fetch(feed.latest, {
                signal: AbortSignal.timeout(8_000),
                headers: { Accept: 'application/vnd.github+json', 'User-Agent': `zanaris-kit/${app.getVersion()}` }
            });
            // GitHub's answer while the repository has no release that is not a prerelease.
            if (res.status === 404) return null;
            if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status}.`);
            return res.json();
        },
        // net.fetch rather than Node's: it follows the system proxy, as the rest of the kit's requests do.
        download: (asset, to, onProgress, signal) =>
            downloadChecked({ url: asset.url, file: asset.name, size: asset.size, sha256: asset.sha256, to, fetch: (url, init) => net.fetch(url, init), onProgress, signal }),
        unpack: async (zip, into) => {
            mkdirSync(into, { recursive: true });
            // ditto, not unzip: it keeps the framework's symlinks, and with them the signature.
            await run('/usr/bin/ditto', ['-x', '-k', zip, into]);
        },
        checkApp: async (bundle, version) => {
            try {
                await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
            } catch {
                return "The download's signature doesn't check out.";
            }
            const plist = join(bundle, 'Contents', 'Info.plist');
            const read = async (key: string): Promise<string> => (await run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist])).stdout.trim();
            try {
                if ((await read('CFBundleIdentifier')) !== APP_ID) return "The download isn't Zanaris Kit.";
                if ((await read('CFBundleShortVersionString')) !== version) return `The download isn't version ${version}.`;
            } catch {
                return "The download isn't an app the kit can read.";
            }
            return null;
        },
        fs: {
            exists: existsSync,
            readText: path => readFileSync(path, 'utf8'),
            writeText: (path, text) => {
                mkdirSync(join(path, '..'), { recursive: true });
                writeFileSync(path, text);
            },
            mkdir: path => mkdirSync(path, { recursive: true }),
            rm: path => rmSync(path, { recursive: true, force: true }),
            rename: renameSync
        },
        handOff: plan => handOff(plan, log),
        log
    };
}
