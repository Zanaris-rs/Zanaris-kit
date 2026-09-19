import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Artifact, Recipe } from '../../shared/engines.ts';
import { BuildStore, LOCAL_BUILD, type BuildStoreDeps } from './buildStore.ts';

const E274 = '1'.repeat(40);
const C274 = '2'.repeat(40);
const E289 = '3'.repeat(40);
const C289 = '4'.repeat(40);

function recipe(id: string, revision: number, engine: string, content: string, artifact: boolean = true): Recipe {
    return {
        id,
        name: `Lost City ${revision}`,
        revision,
        note: revision === 289 ? 'Developers only upstream' : null,
        engine: { repo: 'https://example.invalid/engine.git', commit: engine },
        content: { repo: 'https://example.invalid/content.git', commit: content },
        patches: 'patches/engine',
        artifact: artifact ? { tag: `engine-${id}-${engine.slice(0, 8)}-${content.slice(0, 8)}-abcdef12`, file: `engine-${id}.tar.gz`, size: 50_000_000, sha256: 'a'.repeat(64) } : null
    };
}

const R274 = recipe('lostcity-274', 274, E274, C274);
const R289 = recipe('lostcity-289', 289, E289, C289);

/** VERSION.json as the stage script writes it for a recipe. */
function versionOf(r: Recipe, over: Record<string, unknown> = {}): string {
    return JSON.stringify({ id: r.id, name: r.name, tag: r.artifact?.tag ?? null, engine: r.engine, content: r.content, patches: [], revision: r.revision, built: '2026-09-19T00:00:00.000Z', ...over });
}

interface Harness {
    deps: BuildStoreDeps;
    files: Map<string, string>;
    dirs: Set<string>;
    downloads: { artifact: Artifact; to: string; progress: (f: number) => void; resolve: () => void; reject: (err: Error) => void }[];
    /** What the next extract writes as VERSION.json, by archive path; by default the recipe's own. */
    unpacks: Map<string, string>;
    logs: string[];
}

function harness(over: { recipes?: Recipe[]; local?: string | null } = {}): Harness {
    const files = new Map<string, string>();
    const dirs = new Set<string>();
    const downloads: Harness['downloads'] = [];
    const unpacks = new Map<string, string>();
    const logs: string[] = [];
    const recipes = over.recipes ?? [R274, R289];
    const under = (p: string): ((k: string) => boolean) => k => k === p || k.startsWith(`${p}/`);
    const deps: BuildStoreDeps = {
        dir: '/builds',
        recipes,
        local: over.local ?? null,
        join: (...parts) => parts.join('/'),
        fs: {
            exists: p => files.has(p) || dirs.has(p),
            readText: p => {
                const text = files.get(p);
                if (text === undefined) throw new Error(`ENOENT ${p}`);
                return text;
            },
            mkdir: p => void dirs.add(p),
            rm: p => {
                for (const k of [...files.keys()].filter(under(p))) files.delete(k);
                for (const k of [...dirs].filter(under(p))) dirs.delete(k);
            },
            rename: (from, to) => {
                for (const k of [...files.keys()].filter(under(from))) {
                    files.set(to + k.slice(from.length), files.get(k)!);
                    files.delete(k);
                }
                for (const k of [...dirs].filter(under(from))) {
                    dirs.add(to + k.slice(from.length));
                    dirs.delete(k);
                }
            }
        },
        download: (artifact, to, progress) =>
            new Promise<void>((resolve, reject) => {
                downloads.push({
                    artifact,
                    to,
                    progress,
                    resolve: () => {
                        files.set(to, 'archive');
                        resolve();
                    },
                    reject
                });
            }),
        extract: async (archive, into) => {
            dirs.add(into);
            const id = recipes.find(r => archive.endsWith(r.artifact?.file ?? '\0'))!;
            files.set(`${into}/VERSION.json`, unpacks.get(archive) ?? versionOf(id));
            files.set(`${into}/src/app.js`, 'engine');
        },
        log: msg => void logs.push(msg)
    };
    return { deps, files, dirs, downloads, unpacks, logs };
}

const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

test('a line nothing has been downloaded for is absent, and one with no pinned build is unavailable', () => {
    const h = harness({ recipes: [R274, recipe('lostcity-289', 289, E289, C289, false)] });
    const store = new BuildStore(h.deps);
    assert.deepEqual(
        store.lines().map(l => [l.id, l.state, l.size]),
        [
            ['lostcity-274', 'absent', 50_000_000],
            ['lostcity-289', 'unavailable', null]
        ]
    );
    assert.equal(store.installed('lostcity-274'), null);
    const line = store.lines()[1]!;
    assert.equal(line.note, 'Developers only upstream');
    assert.equal(line.engine, E289);
    assert.equal(line.local, false);
});

test('a build on disk is installed when it is the pinned one and outdated when it is not', () => {
    const h = harness();
    h.files.set('/builds/lostcity-274/VERSION.json', versionOf(R274));
    h.files.set('/builds/lostcity-289/VERSION.json', versionOf(R289, { tag: 'engine-lostcity-289-older' }));
    const store = new BuildStore(h.deps);
    assert.deepEqual(store.lines().map(l => l.state), ['installed', 'outdated']);
    assert.deepEqual(store.installed('lostcity-274'), { id: 'lostcity-274', resources: '/builds/lostcity-274', revision: 274, tag: R274.artifact!.tag });
    assert.equal(store.installed('lostcity-289'), null, 'an outdated build does not run');
});

test('the developer\'s own stage is listed last, installed, with its own revision, and cannot be removed', () => {
    const h = harness({ local: '/app/engine-dist' });
    h.files.set('/app/engine-dist/VERSION.json', versionOf(R289, { id: undefined, name: undefined, tag: undefined }));
    const store = new BuildStore(h.deps);
    const local = store.lines().at(-1)!;
    assert.equal(local.id, LOCAL_BUILD);
    assert.equal(local.state, 'installed');
    assert.equal(local.revision, 289);
    assert.equal(local.local, true);
    assert.equal(local.size, null);
    assert.deepEqual(store.installed(LOCAL_BUILD), { id: LOCAL_BUILD, resources: '/app/engine-dist', revision: 289, tag: null });
    assert.throws(() => store.remove(LOCAL_BUILD), /own stage/);
});

test('a local folder with no VERSION.json the kit understands is not listed', () => {
    const h = harness({ local: '/app/engine-dist' });
    const store = new BuildStore(h.deps);
    assert.equal(store.lines().length, 2);
    assert.equal(store.installed(LOCAL_BUILD), null);
});

test('an install downloads into .incoming, checks what it unpacked, moves it into place and cleans up', async () => {
    const h = harness();
    const store = new BuildStore(h.deps);
    let heard = 0;
    store.subscribe(() => heard++);
    const install = store.install('lostcity-289');
    await flush();
    assert.equal(store.lines()[1]!.state, 'downloading');
    const download = h.downloads[0]!;
    assert.equal(download.to, '/builds/.incoming/lostcity-289/engine-lostcity-289.tar.gz');
    assert.equal(download.artifact, R289.artifact);
    download.resolve();
    await install;
    assert.equal(store.lines()[1]!.state, 'installed');
    assert.equal(h.files.get('/builds/lostcity-289/src/app.js'), 'engine');
    assert.equal([...h.files.keys()].some(k => k.includes('.incoming')), false, '.incoming is cleared');
    assert.equal([...h.dirs].some(k => k.includes('.incoming')), false);
    assert.ok(heard >= 2, 'the start and the end are both heard');
});

test('progress is reported in whole percents, and each one only once', async () => {
    const h = harness();
    const store = new BuildStore(h.deps);
    let heard = 0;
    const install = store.install('lostcity-274');
    await flush();
    store.subscribe(() => heard++);
    const { progress } = h.downloads[0]!;
    progress(0.001);
    progress(0.002);
    progress(0.011);
    progress(0.0115);
    assert.equal(heard, 1, 'only the step past 1% is heard');
    assert.equal(store.lines()[0]!.progress, 0.01);
    h.downloads[0]!.resolve();
    await install;
    assert.equal(store.lines()[0]!.progress, null);
});

test('a failed download leaves what was installed alone, keeps the reason, and clears .incoming', async () => {
    const h = harness();
    h.files.set('/builds/lostcity-274/VERSION.json', versionOf(R274, { tag: 'engine-lostcity-274-older' }));
    h.files.set('/builds/lostcity-274/src/app.js', 'old engine');
    const store = new BuildStore(h.deps);
    const install = store.install('lostcity-274');
    await flush();
    h.dirs.add('/builds/.incoming/lostcity-274');
    h.downloads[0]!.reject(new Error('engine-lostcity-274.tar.gz failed its checksum'));
    await assert.rejects(install, /checksum/);
    const line = store.lines()[0]!;
    assert.equal(line.state, 'outdated');
    // The download's own words name the file, and say enough.
    assert.equal(line.error, 'engine-lostcity-274.tar.gz failed its checksum');
    assert.equal(h.files.get('/builds/lostcity-274/src/app.js'), 'old engine');
    assert.equal([...h.dirs].some(k => k.includes('.incoming')), false);
});

test('an archive that unpacks to a different build is refused, and nothing is moved into place', async () => {
    const h = harness();
    const store = new BuildStore(h.deps);
    h.unpacks.set('/builds/.incoming/lostcity-289/engine-lostcity-289.tar.gz', versionOf(R289, { tag: 'engine-lostcity-289-other' }));
    const install = store.install('lostcity-289');
    await flush();
    h.downloads[0]!.resolve();
    await assert.rejects(install, /not the build this kit pins/);
    assert.equal(store.lines()[1]!.state, 'absent');
    assert.equal(h.files.has('/builds/lostcity-289/VERSION.json'), false);
    assert.equal([...h.files.keys()].some(k => k.includes('.incoming')), false);
});

test('a second install of the same line joins the first, and a new attempt clears the old reason', async () => {
    const h = harness();
    const store = new BuildStore(h.deps);
    const first = store.install('lostcity-274');
    await flush();
    h.downloads[0]!.reject(new Error('net::ERR_INTERNET_DISCONNECTED'));
    await assert.rejects(first);
    assert.equal(store.lines()[0]!.error, "The download didn't finish: net::ERR_INTERNET_DISCONNECTED", 'a bare network error gets the context it lacks');
    const again = store.install('lostcity-274');
    const joined = store.install('lostcity-274');
    await flush();
    assert.equal(h.downloads.length, 2, 'one more download, not two');
    assert.equal(store.lines()[0]!.error, null);
    h.downloads[1]!.resolve();
    await Promise.all([again, joined]);
    assert.equal(store.lines()[0]!.state, 'installed');
});

test('a line with nothing pinned, or not on the list, cannot be installed', async () => {
    const h = harness({ recipes: [recipe('lostcity-274', 274, E274, C274, false)] });
    const store = new BuildStore(h.deps);
    await assert.rejects(store.install('lostcity-274'), /no build to download/);
    await assert.rejects(store.install('nope'), /not a build/);
    assert.equal(h.downloads.length, 0);
});

test('remove deletes an installed build, and refuses one on its way down', async () => {
    const h = harness();
    h.files.set('/builds/lostcity-274/VERSION.json', versionOf(R274));
    const store = new BuildStore(h.deps);
    store.remove('lostcity-274');
    assert.equal(store.lines()[0]!.state, 'absent');
    assert.equal(h.files.has('/builds/lostcity-274/VERSION.json'), false);
    void store.install('lostcity-289').catch(() => undefined);
    await flush();
    assert.throws(() => store.remove('lostcity-289'), /downloading/);
});

test('a download a quit cut short is cleared when the store starts', () => {
    const h = harness();
    h.files.set('/builds/.incoming/lostcity-274/engine-lostcity-274.tar.gz', 'half');
    h.dirs.add('/builds/.incoming');
    new BuildStore(h.deps);
    assert.equal([...h.files.keys()].some(k => k.includes('.incoming')), false);
    assert.equal(h.dirs.has('/builds/.incoming'), false);
});
