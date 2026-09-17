import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Characters, SAVE_BYTES_MAX, suggestName, type ChangeContext, type CharacterFs } from './characters.ts';
import type { Confirmation } from './confirm.ts';
import { buildSave, fixtureSave } from './testSaves.ts';

const DIR = '/home/data/players/main';

interface Disk {
    fs: CharacterFs;
    files: Map<string, { bytes: Uint8Array; modified: number }>;
    dirs: Set<string>;
    /** Every write, rename, copy, rm and trash, in order, as `<verb> <path> [<path>]`. */
    calls: string[];
    trashed: string[];
    trashFails: { value: boolean };
    renameFails: { value: boolean };
    writeFails: { value: boolean };
    put(path: string, bytes: Uint8Array): void;
}

/** An in-memory disk. Each write is newer than the last. */
function disk(): Disk {
    const files = new Map<string, { bytes: Uint8Array; modified: number }>();
    const dirs = new Set<string>();
    const calls: string[] = [];
    const trashed: string[] = [];
    const trashFails = { value: false };
    const renameFails = { value: false };
    const writeFails = { value: false };
    let clock = 0;
    const put = (path: string, bytes: Uint8Array): void => void files.set(path, { bytes, modified: ++clock });
    const get = (path: string): { bytes: Uint8Array; modified: number } => {
        const file = files.get(path);
        if (!file) throw new Error(`ENOENT ${path}`);
        return file;
    };
    const fs: CharacterFs = {
        exists: path => files.has(path) || dirs.has(path),
        readBytes: path => get(path).bytes,
        writeBytes: (path, bytes) => {
            calls.push(`write ${path}`);
            if (writeFails.value) throw new Error('ENOSPC');
            put(path, bytes);
        },
        rename: (from, to) => {
            calls.push(`rename ${from} ${to}`);
            if (renameFails.value) throw new Error('EPERM');
            const file = get(from);
            files.delete(from);
            files.set(to, file);
        },
        copyFile: (from, to) => {
            calls.push(`copy ${from} ${to}`);
            put(to, get(from).bytes);
        },
        mkdir: path => void dirs.add(path),
        rm: path => {
            if (!files.has(path) && !dirs.has(path)) return;
            calls.push(`rm ${path}`);
            files.delete(path);
            dirs.delete(path);
        },
        list: path =>
            [...files.keys(), ...dirs]
                .filter(key => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
                .map(key => key.slice(path.length + 1)),
        stat: path => {
            const file = files.get(path);
            if (file) return { size: file.bytes.length, modified: file.modified, isFile: true };
            return dirs.has(path) ? { size: 0, modified: 0, isFile: false } : null;
        },
        trash: async path => {
            calls.push(`trash ${path}`);
            if (trashFails.value) throw new Error('no trash here');
            trashed.push(path);
            files.delete(path);
        }
    };
    return { fs, files, dirs, calls, trashed, trashFails, renameFails, writeFails, put };
}

function setup(): Disk & { characters: Characters } {
    const d = disk();
    let next = 0;
    return { ...d, characters: new Characters({ fs: d.fs, join: (...parts) => parts.join('/'), dir: DIR, token: () => `token-${++next}` }) };
}

/** A context that answers every question the same way, and keeps them. */
function answering(yes: boolean, running = false): ChangeContext & { asked: Confirmation[] } {
    const asked: Confirmation[] = [];
    return {
        running,
        asked,
        confirm: async question => {
            asked.push(question);
            return yes;
        }
    };
}

const save = (d: Disk, name: string, bytes: Uint8Array = buildSave()): void => d.put(`${DIR}/${name}.sav`, bytes);

function pickOk(characters: Characters, path: string): string {
    const pick = characters.pick(path);
    if (!pick.ok) return assert.fail(`expected a save at ${path}, got ${pick.problem}`);
    return pick.token;
}

const FIXTURE_SUMMARY = { version: 7, combatLevel: 126, totalLevel: 1881, playtimeTicks: 3529 };
const GONE = 'That character is not in the saves folder any more.';

test('list shows each save with its levels, newest first, and a damaged one with its problem', () => {
    const d = setup();
    save(d, 'zezima', fixtureSave());
    const damaged = buildSave();
    damaged[30] = damaged[30]! ^ 0xff;
    save(d, 'broken', damaged);
    save(d, 'newbie', new Uint8Array(0));
    assert.deepEqual(d.characters.list(), [
        { name: 'newbie', displayName: 'Newbie', modified: 3, summary: { version: 0, combatLevel: 3, totalLevel: 28, playtimeTicks: 0 }, problem: null },
        { name: 'broken', displayName: 'Broken', modified: 2, summary: null, problem: 'corrupt' },
        { name: 'zezima', displayName: 'Zezima', modified: 1, summary: FIXTURE_SUMMARY, problem: null }
    ]);
});

test('list leaves out what the engine could never log in as, and anything that is not a save file', () => {
    const d = setup();
    save(d, 'zezima');
    d.put(`${DIR}/Zezima.sav`, buildSave());
    d.put(`${DIR}/two words.sav`, buildSave());
    d.put(`${DIR}/_bob.sav`, buildSave());
    d.put(`${DIR}/notes.txt`, new Uint8Array(3));
    d.put(`${DIR}/zezima.sav.part`, buildSave());
    d.dirs.add(`${DIR}/folder.sav`);
    d.put(`${DIR}/huge.sav`, new Uint8Array(SAVE_BYTES_MAX + 1));
    assert.deepEqual(
        d.characters.list().map(c => [c.name, c.problem]),
        [
            ['huge', 'not-a-save'],
            ['zezima', null]
        ]
    );
});

test('list is empty while the folder does not exist', () => {
    assert.deepEqual(setup().characters.list(), []);
});

test('path takes only a name toSafeName leaves alone', () => {
    const { characters } = setup();
    assert.equal(characters.path('zezima'), `${DIR}/zezima.sav`);
    for (const bad of ['', 'Zezima', '../x', 'a b', '_bob', 'x'.repeat(13)]) {
        assert.throws(() => characters.path(bad), /not a safe character name/, bad);
    }
});

test('pick reads the file and offers its own name', () => {
    const d = setup();
    d.put('/downloads/Zezima.sav', fixtureSave());
    assert.deepEqual(d.characters.pick('/downloads/Zezima.sav'), { ok: true, token: 'token-1', suggestedName: 'zezima', summary: FIXTURE_SUMMARY });
});

test('pick names what is wrong with a file that is not a save, and keeps nothing for it', async () => {
    const d = setup();
    d.put('/downloads/notes.sav', new TextEncoder().encode('hello, world'));
    d.put('/downloads/cut.sav', fixtureSave().slice(0, 100));
    d.put('/downloads/newer.sav', buildSave({ version: 8 }));
    d.put('/downloads/big.sav', new Uint8Array(SAVE_BYTES_MAX + 1));
    assert.deepEqual(d.characters.pick('/downloads/notes.sav'), { ok: false, problem: 'not-a-save' });
    assert.deepEqual(d.characters.pick('/downloads/cut.sav'), { ok: false, problem: 'corrupt' });
    assert.deepEqual(d.characters.pick('/downloads/newer.sav'), { ok: false, problem: 'too-new' });
    assert.deepEqual(d.characters.pick('/downloads/big.sav'), { ok: false, problem: 'not-a-save' });
    assert.deepEqual(d.characters.pick('/downloads/missing.sav'), { ok: false, problem: 'unreadable' });
    assert.equal((await d.characters.importAs('token-1', 'bob', answering(true))).kind, 'refused', 'no token was issued');
    assert.deepEqual(d.calls, []);
});

test('suggestName is the file name as the engine would file it, or nothing', () => {
    assert.equal(suggestName('/a/b/Zezima.sav'), 'zezima');
    assert.equal(suggestName('C:\\Users\\x\\My Save (1).SAV'), 'my_save__1');
    assert.equal(suggestName('/a/!!!.sav'), '');
    assert.equal(suggestName('/a/con.sav'), '');
    assert.equal(suggestName(`/a/${'x'.repeat(60)}.sav`), 'xxxxxxxxxxxx');
    assert.equal(suggestName('/a/noext'), 'noext');
});

test('an import writes through a part file, asks nothing when the name is free and the world stopped, and uses its token once', async () => {
    const d = setup();
    d.put('/downloads/Zezima.sav', fixtureSave());
    const token = pickOk(d.characters, '/downloads/Zezima.sav');
    const ctx = answering(false);
    assert.deepEqual(await d.characters.importAs(token, 'Zezima', ctx), { kind: 'done', name: 'zezima' });
    assert.deepEqual(ctx.asked, []);
    assert.deepEqual(d.calls, [`write ${DIR}/zezima.sav.part`, `rename ${DIR}/zezima.sav.part ${DIR}/zezima.sav`]);
    assert.deepEqual(d.files.get(`${DIR}/zezima.sav`)!.bytes, fixtureSave());
    assert.equal(d.files.has('/downloads/Zezima.sav'), true, 'the picked file stays where it was');
    assert.equal((await d.characters.importAs(token, 'again', ctx)).kind, 'refused');
});

test('an import onto a character asks; a no leaves both files and the pick waiting, a yes trashes the old one', async () => {
    const d = setup();
    save(d, 'zezima');
    d.put('/downloads/x.sav', fixtureSave());
    const token = pickOk(d.characters, '/downloads/x.sav');
    const no = answering(false);
    assert.deepEqual(await d.characters.importAs(token, 'Zezima', no), { kind: 'cancelled' });
    assert.equal(no.asked[0]!.message, 'Replace Zezima with the imported save?');
    assert.equal(no.asked[0]!.destructive, true);
    assert.deepEqual(d.calls, []);
    assert.deepEqual(await d.characters.importAs(token, 'Zezima', answering(true)), { kind: 'done', name: 'zezima' });
    assert.deepEqual(d.trashed, [`${DIR}/zezima.sav`]);
    assert.deepEqual(d.files.get(`${DIR}/zezima.sav`)!.bytes, fixtureSave());
});

test('when the old character cannot go to the trash, nothing is replaced and no part file is left', async () => {
    const d = setup();
    const old = buildSave({ playtime: 5 });
    save(d, 'zezima', old);
    d.put('/downloads/x.sav', fixtureSave());
    d.trashFails.value = true;
    const outcome = await d.characters.importAs(pickOk(d.characters, '/downloads/x.sav'), 'zezima', answering(true));
    assert.deepEqual(outcome, { kind: 'refused', message: "Couldn't move the old Zezima to the trash, so nothing was replaced." });
    assert.equal(d.files.get(`${DIR}/zezima.sav`)!.bytes, old);
    assert.equal(d.files.has(`${DIR}/zezima.sav.part`), false);
});

test('while the world runs, even a free name asks, and says why', async () => {
    const d = setup();
    d.put('/downloads/x.sav', fixtureSave());
    const ctx = answering(true, true);
    await d.characters.importAs(pickOk(d.characters, '/downloads/x.sav'), 'Zezima', ctx);
    assert.equal(ctx.asked[0]!.message, 'Import this save as Zezima?');
    assert.match(ctx.asked[0]!.detail, /playing right now.*logging out will write over the import/);
    assert.equal(ctx.asked[0]!.destructive, false);
});

test('an import reads the file again, and refuses one that has stopped being a save', async () => {
    const d = setup();
    d.put('/downloads/x.sav', fixtureSave());
    const token = pickOk(d.characters, '/downloads/x.sav');
    d.put('/downloads/x.sav', new TextEncoder().encode('overwritten'));
    assert.deepEqual(await d.characters.importAs(token, 'Zezima', answering(true)), { kind: 'refused', message: "That file isn't a character save." });
    assert.equal(d.files.has(`${DIR}/zezima.sav`), false);
});

test('an import refuses a name that cannot be a character, writes nothing, and shortens a long one', async () => {
    const d = setup();
    d.put('/downloads/x.sav', fixtureSave());
    const token = pickOk(d.characters, '/downloads/x.sav');
    for (const typed of ['!!!', '', 'invalid name', 'CON']) {
        assert.equal((await d.characters.importAs(token, typed, answering(true))).kind, 'refused', typed);
    }
    assert.deepEqual(d.calls, []);
    assert.deepEqual(await d.characters.importAs(token, 'x'.repeat(20), answering(true)), { kind: 'done', name: 'xxxxxxxxxxxx' });
});

test('only the eight newest picks wait for a name', async () => {
    const d = setup();
    d.put('/downloads/x.sav', fixtureSave());
    const tokens = Array.from({ length: 9 }, () => pickOk(d.characters, '/downloads/x.sav'));
    assert.equal((await d.characters.importAs(tokens[0]!, 'first', answering(true))).kind, 'refused');
    assert.equal((await d.characters.importAs(tokens[1]!, 'second', answering(true))).kind, 'done');
});

test('rename moves the file, asking nothing when the name is free and the world stopped', async () => {
    const d = setup();
    save(d, 'zezima');
    const ctx = answering(false);
    assert.deepEqual(await d.characters.rename('zezima', 'Bob Smith', ctx), { kind: 'done', name: 'bob_smith' });
    assert.deepEqual(ctx.asked, []);
    assert.deepEqual(d.calls, [`rename ${DIR}/zezima.sav ${DIR}/bob_smith.sav`]);
});

test('rename refuses the name it has, a character that is gone, and a bad name', async () => {
    const d = setup();
    save(d, 'zezima');
    const ctx = answering(true);
    assert.deepEqual(await d.characters.rename('zezima', ' ZEZIMA ', ctx), { kind: 'refused', message: 'Zezima already has that name.' });
    assert.deepEqual(await d.characters.rename('nobody', 'bob', ctx), { kind: 'refused', message: 'That character is not in the saves folder any more.' });
    assert.deepEqual(await d.characters.rename('../zezima', 'bob', ctx), { kind: 'refused', message: 'That character is not in the saves folder any more.' });
    assert.equal((await d.characters.rename('zezima', '???', ctx)).kind, 'refused');
    assert.deepEqual(d.calls, []);
});

test('rename onto a character asks, trashes that one, then moves', async () => {
    const d = setup();
    save(d, 'zezima');
    save(d, 'bob');
    const ctx = answering(true, true);
    assert.deepEqual(await d.characters.rename('zezima', 'bob', ctx), { kind: 'done', name: 'bob' });
    assert.equal(ctx.asked[0]!.message, 'Rename Zezima to Bob, replacing the Bob you have?');
    assert.match(ctx.asked[0]!.detail, /Bob you have now goes to the trash.*logged in as Zezima.*under the old name/);
    assert.deepEqual(d.calls, [`trash ${DIR}/bob.sav`, `rename ${DIR}/zezima.sav ${DIR}/bob.sav`]);
});

test('duplicate copies through a part file, leaves the original, and needs a name of its own', async () => {
    const d = setup();
    save(d, 'zezima', fixtureSave());
    assert.deepEqual(await d.characters.duplicate('zezima', 'Zezima 2', answering(false)), { kind: 'done', name: 'zezima_2' });
    assert.deepEqual(d.files.get(`${DIR}/zezima_2.sav`)!.bytes, fixtureSave());
    assert.equal(d.files.has(`${DIR}/zezima.sav`), true);
    assert.deepEqual(await d.characters.duplicate('zezima', 'zezima', answering(true)), { kind: 'refused', message: 'A copy needs a name of its own.' });
});

test('delete always asks, with Cancel as the default, and sends the save to the trash', async () => {
    const d = setup();
    save(d, 'zezima');
    const no = answering(false);
    assert.deepEqual(await d.characters.remove('zezima', no), { kind: 'cancelled' });
    assert.deepEqual(no.asked[0], { message: 'Move Zezima to the trash?', detail: 'You can put the save back from there.', button: 'Move to Trash', destructive: true });
    assert.deepEqual(d.trashed, []);
    assert.deepEqual(await d.characters.remove('zezima', answering(true)), { kind: 'done', name: 'zezima' });
    assert.deepEqual(d.trashed, [`${DIR}/zezima.sav`]);
});

test('a delete the trash refuses leaves the save in place', async () => {
    const d = setup();
    save(d, 'zezima');
    d.trashFails.value = true;
    assert.deepEqual(await d.characters.remove('zezima', answering(true)), { kind: 'refused', message: "Couldn't move Zezima to the trash, so it was not deleted." });
    assert.equal(d.files.has(`${DIR}/zezima.sav`), true);
});

test('export copies the save where asked without a question; has() says which names are characters', () => {
    const d = setup();
    save(d, 'zezima', fixtureSave());
    assert.deepEqual(d.characters.exportTo('zezima', '/documents/zezima.sav'), { kind: 'done', name: 'zezima' });
    assert.deepEqual(d.files.get('/documents/zezima.sav')!.bytes, fixtureSave());
    assert.equal(d.characters.exportTo('nobody', '/documents/x.sav').kind, 'refused');
    assert.equal(d.characters.has('zezima'), true);
    assert.equal(d.characters.has('nobody'), false);
    assert.equal(d.characters.has('../zezima'), false);
});

test('whatever is typed, every file written, moved or trashed is a safe name in the saves folder', async () => {
    const d = setup();
    save(d, 'zezima');
    d.put('/downloads/x.sav', fixtureSave());
    const hostile = ['../../etc/passwd', 'a/b', '..\\..\\windows', 'C:\\temp\\x', '/abs', 'zezima.sav', `${String.fromCharCode(0)}x`, 'x'.repeat(20), ' .. ', 'é'];
    for (const typed of hostile) {
        await d.characters.importAs(pickOk(d.characters, '/downloads/x.sav'), typed, answering(true));
        await d.characters.duplicate('zezima', typed, answering(true));
        // A fresh character each time, so a rename that goes through never takes zezima from the next round.
        save(d, 'victim');
        await d.characters.rename('victim', typed, answering(true));
    }
    const safe = /^\/home\/data\/players\/main\/[a-z0-9_]{1,12}\.sav(\.part)?$/;
    const touched = d.calls.flatMap(call => call.split(' ').slice(1));
    assert.ok(touched.length > 0);
    for (const path of touched) assert.match(path, safe);
});

test('a rename into place that fails after the old save went to the trash says where the old one went, and leaves no part file', async () => {
    const d = setup();
    save(d, 'zezima');
    d.put('/downloads/x.sav', fixtureSave());
    const token = pickOk(d.characters, '/downloads/x.sav');
    d.renameFails.value = true;
    assert.deepEqual(await d.characters.importAs(token, 'zezima', answering(true)), { kind: 'refused', message: "The save couldn't be written. The old Zezima is in the trash." });
    assert.deepEqual(d.trashed, [`${DIR}/zezima.sav`]);
    assert.equal(d.files.has(`${DIR}/zezima.sav.part`), false);
});

test('a failed write to a free name says only that it failed', async () => {
    const d = setup();
    d.put('/downloads/x.sav', fixtureSave());
    const token = pickOk(d.characters, '/downloads/x.sav');
    d.renameFails.value = true;
    assert.deepEqual(await d.characters.importAs(token, 'zezima', answering(true)), { kind: 'refused', message: "The save couldn't be written." });
    assert.equal(d.files.has(`${DIR}/zezima.sav.part`), false);
});

test('a part file that cannot be written leaves nothing behind and trashes nothing', async () => {
    const d = setup();
    save(d, 'zezima');
    d.put('/downloads/x.sav', fixtureSave());
    const token = pickOk(d.characters, '/downloads/x.sav');
    d.writeFails.value = true;
    assert.deepEqual(await d.characters.importAs(token, 'zezima', answering(true)), { kind: 'refused', message: "The save couldn't be written." });
    assert.deepEqual(d.trashed, []);
    assert.equal(d.files.has(`${DIR}/zezima.sav`), true);
});

test('a rename whose target cannot go to the trash changes nothing', async () => {
    const d = setup();
    save(d, 'zezima');
    save(d, 'bob');
    d.trashFails.value = true;
    assert.deepEqual(await d.characters.rename('zezima', 'bob', answering(true)), { kind: 'refused', message: "Couldn't move the old Bob to the trash, so nothing was renamed." });
    assert.equal(d.files.has(`${DIR}/zezima.sav`), true);
    assert.equal(d.files.has(`${DIR}/bob.sav`), true);
});

test('a rename that fails after its target went to the trash says where the old one went', async () => {
    const d = setup();
    save(d, 'zezima');
    save(d, 'bob');
    d.renameFails.value = true;
    assert.deepEqual(await d.characters.rename('zezima', 'bob', answering(true)), { kind: 'refused', message: "The save couldn't be renamed. The old Bob is in the trash." });
    assert.equal(d.files.has(`${DIR}/zezima.sav`), true);
});

test('a character that vanishes while its question is open is not renamed, copied or deleted, and nothing is trashed', async () => {
    const d = setup();
    save(d, 'bob');
    const vanishing = (): ChangeContext => ({
        running: true,
        confirm: async () => {
            d.files.delete(`${DIR}/zezima.sav`);
            return true;
        }
    });
    save(d, 'zezima');
    assert.deepEqual(await d.characters.rename('zezima', 'bob', vanishing()), { kind: 'refused', message: GONE });
    save(d, 'zezima');
    assert.deepEqual(await d.characters.duplicate('zezima', 'bob', vanishing()), { kind: 'refused', message: GONE });
    save(d, 'zezima');
    assert.deepEqual(await d.characters.remove('zezima', vanishing()), { kind: 'refused', message: GONE });
    assert.deepEqual(d.trashed, []);
    assert.equal(d.files.has(`${DIR}/bob.sav`), true);
});

test('two imports of one pick answered together import it once', async () => {
    const d = setup();
    d.put('/downloads/x.sav', fixtureSave());
    const token = pickOk(d.characters, '/downloads/x.sav');
    let answer!: () => void;
    const answered = new Promise<void>(resolve => {
        answer = resolve;
    });
    const held: ChangeContext = {
        running: true,
        confirm: async () => {
            await answered;
            return true;
        }
    };
    const both = Promise.all([d.characters.importAs(token, 'zezima', held), d.characters.importAs(token, 'zezima', held)]);
    answer();
    const outcomes = await both;
    assert.deepEqual(outcomes.map(o => o.kind).sort(), ['done', 'refused']);
    assert.equal(d.calls.filter(call => call.startsWith('write ')).length, 1);
    assert.deepEqual(d.trashed, []);
    assert.equal(d.files.has(`${DIR}/zezima.sav`), true);
});

test('two changes to one name answered together run one after the other, and the first save goes to the trash', async () => {
    const d = setup();
    const older = buildSave({ playtime: 1 });
    const newer = buildSave({ playtime: 2 });
    d.put('/downloads/a.sav', older);
    d.put('/downloads/b.sav', newer);
    const first = pickOk(d.characters, '/downloads/a.sav');
    const second = pickOk(d.characters, '/downloads/b.sav');
    let answer!: () => void;
    const answered = new Promise<void>(resolve => {
        answer = resolve;
    });
    const held: ChangeContext = {
        running: true,
        confirm: async () => {
            await answered;
            return true;
        }
    };
    const both = Promise.all([d.characters.importAs(first, 'zezima', held), d.characters.importAs(second, 'zezima', held)]);
    answer();
    assert.deepEqual(await both, [
        { kind: 'done', name: 'zezima' },
        { kind: 'done', name: 'zezima' }
    ]);
    assert.equal(d.files.get(`${DIR}/zezima.sav`)!.bytes, newer);
    assert.deepEqual(d.trashed, [`${DIR}/zezima.sav`]);
    assert.equal(d.files.has(`${DIR}/zezima.sav.part`), false);
});

test('a directory named like a save is not a character', async () => {
    const d = setup();
    d.dirs.add(`${DIR}/folder.sav`);
    assert.equal(d.characters.has('folder'), false);
    assert.deepEqual(await d.characters.remove('folder', answering(true)), { kind: 'refused', message: GONE });
    assert.deepEqual(d.trashed, []);
});
