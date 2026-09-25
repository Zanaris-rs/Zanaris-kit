#!/usr/bin/env node
// node scripts/sample-floors.mjs [content-dir]: the floors each theme in
// src/shared/themes.ts was sampled from. It reads the content checkout the
// stage script makes (.engine-work/content, after `npm run stage:engine --
// lostcity-274`) and, for each region, tallies the floor under every ground
// tile of its map squares and prints each floor's colour.
//
// Two rankings, because the plain count says little: nearly every mainland
// region is mostly grass. `lift` is how many times more of a region a floor
// covers than of the whole map, which is what sets the region apart. A
// theme's ground and trim are chosen from the top of that list, and its
// comment in themes.ts names the floors and the counts printed here.
//
// Never run in CI: the content checkout is not in the repository.
// Spec: docs/superpowers/specs/2026-09-25-themes-design.md.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const content = resolve(process.argv[2] ?? join(root, '.engine-work', 'content'));

/**
 * Where each theme's place is, as map squares ([x, z], each 64 tiles). The
 * labelled ones are the squares around `maps/labels.txt`'s marker; Zanaris
 * has no label, and is the two squares its fairies stand in (npcs 57, 498,
 * 565, 567, 653 and 654) — the Lost City quest teleports into the second.
 */
const REGIONS = {
    zanaris: [
        [49, 149],
        [50, 149]
    ],
    // The band the wilderness covers, 2944–3391 by 3520–3967.
    wilderness: range([46, 52], [55, 61]),
    // Around "Al Kharid" (3297,3150), stopping short of Lumbridge's square to the west.
    alkharid: range([51, 52], [48, 50]),
    // Around "Canifis" (3491,3487) and "Mort Myre Swamp" (3439,3383).
    morytania: range([53, 55], [52, 54]),
    // The square "Lumbridge" (3239,3233) is in: the castle and the town.
    lumbridge: [[50, 50]]
};

/** Floors a player never sees: the client draws nothing for them. */
const UNSEEN = new Set(['invisible', 'invisible_occ']);

function range([x0, x1], [z0, z1]) {
    const squares = [];
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) squares.push([x, z]);
    return squares;
}

/** `flo.pack`: `id=name`, the ids the packed map uses. */
function readPack() {
    const names = new Map();
    for (const line of readFileSync(join(content, 'pack', 'flo.pack'), 'utf8').split('\n')) {
        const m = /^(\d+)=(\S+)$/.exec(line.trim());
        if (m) names.set(Number(m[1]), m[2]);
    }
    return names;
}

/** Both `.flo` files: each floor's colour, or the texture it is painted with. */
function readFloors() {
    const floors = new Map();
    for (const file of ['underlay.flo', 'overlay.flo']) {
        let current = null;
        for (const raw of readFileSync(join(content, 'scripts', 'floors', file), 'utf8').split('\n')) {
            const line = raw.trim();
            const section = /^\[(.+)\]$/.exec(line);
            if (section) {
                current = { colour: null, texture: null };
                floors.set(section[1], current);
                continue;
            }
            const [key, value] = line.split('=');
            if (!current || value === undefined) continue;
            if (key === 'colour') current.colour = Number(value);
            if (key === 'texture') current.texture = value;
        }
    }
    return floors;
}

/** The mean colour of a texture's opaque pixels. Every texture is an 8-bit RGBA PNG, and nothing else is read. */
function textureMean(name) {
    const png = readFileSync(join(content, 'textures', `${name}.png`));
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    if (png[24] !== 8 || png[25] !== 6 || png[28] !== 0) throw new Error(`${name}.png is not 8-bit RGBA, non-interlaced`);
    const chunks = [];
    for (let at = 8; at < png.length; ) {
        const length = png.readUInt32BE(at);
        const type = png.toString('ascii', at + 4, at + 8);
        if (type === 'IDAT') chunks.push(png.subarray(at + 8, at + 8 + length));
        at += 12 + length;
    }
    const raw = inflateSync(Buffer.concat(chunks));
    const stride = width * 4;
    const pixels = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        for (let x = 0; x < stride; x++) {
            const byte = raw[y * (stride + 1) + 1 + x];
            const a = x >= 4 ? pixels[y * stride + x - 4] : 0;
            const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
            const c = x >= 4 && y > 0 ? pixels[(y - 1) * stride + x - 4] : 0;
            let predicted = 0;
            if (filter === 1) predicted = a;
            else if (filter === 2) predicted = b;
            else if (filter === 3) predicted = (a + b) >> 1;
            else if (filter === 4) {
                const p = a + b - c;
                const pa = Math.abs(p - a);
                const pb = Math.abs(p - b);
                const pc = Math.abs(p - c);
                predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            }
            pixels[y * stride + x] = (byte + predicted) & 0xff;
        }
    }
    let r = 0;
    let g = 0;
    let bl = 0;
    let n = 0;
    for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] < 128) continue;
        r += pixels[i];
        g += pixels[i + 1];
        bl += pixels[i + 2];
        n++;
    }
    return n === 0 ? 0 : (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(bl / n);
}

/**
 * The floor a player sees on each ground-level tile of one square: its
 * overlay where it has one, else its underlay. The map numbers both from 1,
 * as the client does (`FloType.instances[id - 1]`), so `u48` is pack id 47.
 */
function tallySquare(file, names, tally) {
    const text = readFileSync(file, 'utf8');
    const map = text.slice(text.indexOf('==== MAP ===='), text.indexOf('==== LOC ===='));
    for (const line of map.split('\n')) {
        const m = /^0 \d+ \d+:(.*)$/.exec(line);
        if (!m) continue;
        const overlay = /\bo(\d+)/.exec(m[1]);
        const underlay = /\bu(\d+)/.exec(m[1]);
        const id = overlay ? Number(overlay[1]) : underlay ? Number(underlay[1]) : 0;
        if (id === 0) continue;
        const name = names.get(id - 1);
        if (!name || UNSEEN.has(name)) continue;
        tally.set(name, (tally.get(name) ?? 0) + 1);
    }
}

const hex = colour => `#${colour.toString(16).padStart(6, '0')}`;

const names = readPack();
const floors = readFloors();
const colourOf = name => {
    const floor = floors.get(name);
    if (!floor) return '?';
    return floor.texture ? `${hex(textureMean(floor.texture))} (${floor.texture})` : hex(floor.colour ?? 0);
};

const world = new Map();
for (const file of readdirSync(join(content, 'maps'))) {
    if (/^m\d+_\d+\.jm2$/.test(file)) tallySquare(join(content, 'maps', file), names, world);
}
const worldTotal = [...world.values()].reduce((sum, n) => sum + n, 0);

for (const [region, squares] of Object.entries(REGIONS)) {
    const tally = new Map();
    const found = [];
    for (const [x, z] of squares) {
        const file = join(content, 'maps', `m${x}_${z}.jm2`);
        try {
            tallySquare(file, names, tally);
            found.push(`m${x}_${z}`);
        } catch {
            // A square this revision has no map for: open sea, or not built yet.
        }
    }
    const total = [...tally.values()].reduce((sum, n) => sum + n, 0);
    const rows = [...tally.entries()].map(([name, n]) => ({
        name,
        n,
        share: n / total,
        lift: n / total / ((world.get(name) ?? n) / worldTotal)
    }));
    console.log(`\n${region}: ${found.length} squares (${found.join(' ')}), ${total} tiles`);
    const print = row =>
        console.log(`  ${row.name.padEnd(24)} ${String(row.n).padStart(6)}  ${(row.share * 100).toFixed(1).padStart(5)}%  lift ${row.lift.toFixed(1).padStart(6)}  ${colourOf(row.name)}`);
    console.log(' by tiles:');
    rows.sort((a, b) => b.n - a.n).slice(0, 8).forEach(print);
    // A floor under 1% of the region is a doorway or a rug, however rare it is elsewhere.
    console.log(' by lift (at least 1% of the region):');
    rows.filter(row => row.share >= 0.01).sort((a, b) => b.lift - a.lift).slice(0, 8).forEach(print);
}
