import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_ID, APP_NAME, REPO_URL, aboutOptions, devBranding } from './branding.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('an unpackaged run wears the About panel and the dock icon from the repository', () => {
    const b = devBranding({ packaged: false, root: '/repo', version: '0.1.0' });
    assert.equal(b?.dockIcon, '/repo/build/icon.png');
    assert.deepEqual(b?.about, {
        applicationName: APP_NAME,
        applicationVersion: '0.1.0',
        copyright: 'Zanaris Kit contributors',
        website: REPO_URL,
        iconPath: '/repo/build/icon.png'
    });
});

test('a packaged run applies nothing: the bundle already carries all of it', () => {
    assert.equal(devBranding({ packaged: true, root: '/Applications/Zanaris Kit.app/Contents/Resources/app.asar', version: '0.1.0' }), null);
});

test('the name matches what electron-builder packs, so dev and packaged runs read the same', () => {
    const yml = readFileSync(join(import.meta.dirname, '../../electron-builder.yml'), 'utf8');
    assert.match(yml, new RegExp(`^productName: ${APP_NAME}$`, 'm'));
    assert.match(yml, new RegExp(`^appId: ${APP_ID.replace(/\./g, '\\.')}$`, 'm'));
    assert.match(yml, /^copyright: Zanaris Kit contributors$/m);
});

test('every run gets an About panel with the version, and a packaged one no icon path it does not ship', () => {
    assert.deepEqual(aboutOptions('0.2.0'), { applicationName: APP_NAME, applicationVersion: '0.2.0', copyright: 'Zanaris Kit contributors', website: REPO_URL });
});
