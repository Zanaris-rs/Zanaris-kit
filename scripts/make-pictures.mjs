// npm run make:pictures [-- content-dir]: the kit's own pictures, made into
// static/pictures/ from the content checkout the stage script makes
// (.engine-work/content, after `npm run stage:engine -- lostcity-274`). What
// it makes is the kit's own list, src/main/presets.ts, so the pictures made
// and the pictures offered cannot disagree; presets.test.ts fails on a file
// the list does not name.
//
// The checkout must be at the 274 recipe's content commit, which is what the
// list says the pictures are made from: the stage script moves the one
// checkout between recipes, and 289's would make other pictures quietly.
//
// Run under Electron rather than Node, for nativeImage: title.jpg is a JPEG,
// and nothing in Node decodes one. Electron's Node strips the list's types on
// import. No top-level await: an ESM entry that awaits app.whenReady() at its
// top level never sees it ready.
//
// Never run in CI: the content checkout is not in the repository. The
// pictures are Jagex's art, from the Lost City content repository's copy,
// kept there for historical preservation, as the launcher's sprites are.
// Spec: docs/superpowers/specs/2026-09-26-kit-pictures-design.md.
import { app, nativeImage } from 'electron';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESETS } from '../src/main/presets.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const content = resolve(process.argv[2] ?? join(root, '.engine-work', 'content'));
const out = join(root, 'static', 'pictures');
const pin = JSON.parse(readFileSync(join(root, 'engines', 'lostcity-274.json'), 'utf8')).content.commit;

/** One pixel from `src` at `from` to `dst` at `to`, both BGRA, as toBitmap gives and createFromBitmap takes. */
function pixel(src, from, dst, to) {
    src.copy(dst, to * 4, from * 4, from * 4 + 4);
}

/** The source beside its own mirror image, as the 274 client lays its title screen: two pillars and the arch between them. */
function mirror(image) {
    const { width, height } = image.getSize();
    const src = image.toBitmap();
    const dst = Buffer.alloc(width * 2 * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            pixel(src, y * width + x, dst, y * width * 2 + x);
            pixel(src, y * width + x, dst, y * width * 2 + (width * 2 - 1 - x));
        }
    }
    return nativeImage.createFromBitmap(dst, { width: width * 2, height }).toJPEG(90);
}

/** Twice the size by nearest neighbour: every pixel a 2x2 block, so the texture keeps its hard edges. */
function double(image) {
    const { width, height } = image.getSize();
    const src = image.toBitmap();
    const dst = Buffer.alloc(width * 2 * height * 2 * 4);
    for (let y = 0; y < height * 2; y++) {
        for (let x = 0; x < width * 2; x++) pixel(src, (y >> 1) * width + (x >> 1), dst, y * width * 2 + x);
    }
    return nativeImage.createFromBitmap(dst, { width: width * 2, height: height * 2 }).toPNG();
}

app.dock?.hide();
app.whenReady().then(() => {
    try {
        const at = execFileSync('git', ['-C', content, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
        if (at !== pin) throw new Error(`${content} is at ${at}, not the 274 content pin ${pin}: npm run stage:engine -- lostcity-274 puts it there`);
        mkdirSync(out, { recursive: true });
        // A preset dropped from the list takes its file with it.
        for (const file of readdirSync(out)) if (!PRESETS.some(p => p.file === file)) rmSync(join(out, file));
        for (const preset of PRESETS) {
            const source = nativeImage.createFromPath(join(content, preset.from));
            if (source.isEmpty()) throw new Error(`${preset.from} could not be read from ${content}`);
            const bytes = preset.make === 'mirror' ? mirror(source) : double(source);
            writeFileSync(join(out, preset.file), bytes);
            const { width, height } = nativeImage.createFromBuffer(bytes).getSize();
            console.log(`${preset.file.padEnd(14)} ${String(width).padStart(4)}x${height}  ${(bytes.length / 1024).toFixed(0).padStart(4)} KB  from ${preset.from}`);
        }
        app.quit();
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        // app.quit() exits 0 whatever happened.
        app.exit(1);
    }
});
