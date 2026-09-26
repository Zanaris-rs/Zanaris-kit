import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * CLAUDE.md's Identity section: nothing pushed may carry the owner's real
 * name. An absolute path to a home directory carries its owner's user name,
 * and three plans once named the repository that way. A doc names a path from
 * the repository root, and a test gives a home a placeholder.
 */

const root = fileURLToPath(new URL('../../', import.meta.url));
const DIRS = ['docs', 'src', 'scripts'];
const FILES = ['README.md', 'CLAUDE.md'];
const TEXT = /\.(md|[cm]?[jt]sx?|json|css|html|txt|ya?ml)$/;

/** A home directory and the name after it, written so that this file holds none. */
const HOME = /\/(?:Users|home)\/([\w.-]+)/g;

/**
 * The homes that name nobody: the tests' placeholder homes, and what sits
 * under `/home` where a test stands it in for a world's working directory.
 */
const PLACEHOLDERS = new Set(['me', 'p', 'data', 'public', 'view', 'engine.stamp', 'world.log']);

function scanned(): string[] {
    const inDirs = DIRS.flatMap(dir => readdirSync(join(root, dir), { recursive: true }).map(entry => join(dir, String(entry))));
    return [...inDirs, ...FILES].filter(file => TEXT.test(file));
}

test('no doc, source or script names a home directory', () => {
    const found: string[] = [];
    for (const file of scanned()) {
        for (const match of readFileSync(join(root, file), 'utf8').matchAll(HOME)) {
            if (!PLACEHOLDERS.has(match[1] ?? '')) found.push(`${file}: ${match[0]}`);
        }
    }
    assert.deepEqual(found, []);
});

test('the scan reaches the plans, and would see a home in one', () => {
    assert.ok(scanned().some(file => file.startsWith(join('docs', 'superpowers', 'plans'))));
    const home = ['', 'Users', 'someone', 'repo'].join('/');
    assert.deepEqual([...`Run everything from \`${home}\`.`.matchAll(HOME)].map(m => m[1]), ['someone']);
});
