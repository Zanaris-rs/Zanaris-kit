import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * The shell's CSP refuses an image it does not allow with nothing on screen to
 * say so. The stone's grain, since removed, was two `data:` SVGs, and every
 * surface drew as its flat base for as long as they were: no test failed and
 * nothing looked broken.
 * These hold the images the renderer names to what the page will draw.
 */

const renderer = fileURLToPath(new URL('../renderer/', import.meta.url));

/** The sources `index.html`'s CSP allows images from: `img-src`, or `default-src` where there is none. */
function imageSources(): string[] {
    const html = readFileSync(join(renderer, 'index.html'), 'utf8');
    const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html)?.[1];
    assert.ok(csp, 'index.html carries a CSP');
    const directives = new Map(
        csp.split(';').map(directive => {
            const [name = '', ...sources] = directive.trim().split(/\s+/);
            return [name, sources] as const;
        })
    );
    return [...(directives.get('img-src') ?? directives.get('default-src') ?? [])];
}

const refusesData = !imageSources().includes('data:');

test("the renderer names no data: image while the page's CSP refuses them", { skip: !refusesData }, () => {
    const found: string[] = [];
    for (const entry of readdirSync(renderer, { recursive: true })) {
        const file = String(entry);
        if (!/\.(tsx?|css|html)$/.test(file)) continue;
        // A comment explaining why there are none is not one.
        const text = readFileSync(join(renderer, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        for (const url of text.match(/data:[a-z]+\/[\w.+-]+[;,]/gi) ?? []) found.push(`${file}: ${url}`);
    }
    assert.deepEqual(found, []);
});

test('the build inlines no asset as data:, since the CSP would refuse it', { skip: !refusesData }, () => {
    // Vite's default inlines anything under 4 KB, which is every sprite.
    const config = readFileSync(new URL('../../electron.vite.config.ts', import.meta.url), 'utf8');
    assert.match(config, /renderer:[^\n]*assetsInlineLimit: 0\b/);
});

test('every url() in styles.css names a file that is there', () => {
    const path = join(renderer, 'styles.css');
    const css = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const urls = [...css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map(m => m[1] ?? '');
    assert.ok(urls.length > 0);
    for (const url of urls) assert.ok(existsSync(join(dirname(path), url)), url);
});
