import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportUrl } from './report.ts';

const ENV = { version: '0.1.0', electron: '44.1.1', platform: 'darwin', arch: 'arm64', osVersion: '26.0.1' };

test('a report opens a new issue on the kit\'s own repository', () => {
    const url = new URL(reportUrl(ENV));
    assert.equal(url.origin, 'https://github.com');
    assert.equal(url.pathname, '/Zanaris-rs/Zanaris-kit/issues/new');
});

test('its body asks three questions and says which kit and system it came from', () => {
    const body = new URL(reportUrl(ENV)).searchParams.get('body') ?? '';
    assert.match(body, /\*\*What happened\*\*/);
    assert.match(body, /\*\*What you expected\*\*/);
    assert.match(body, /\*\*Steps to get there\*\*/);
    assert.match(body, /Zanaris Kit 0\.1\.0 · Electron 44\.1\.1 · macOS 26\.0\.1 \(arm64\)$/);
});

test('each OS is named as its users know it, and an unknown one as Node does', () => {
    const line = (platform: string): string => (new URL(reportUrl({ ...ENV, platform })).searchParams.get('body') ?? '').split('\n').at(-1)!;
    assert.match(line('win32'), / Windows 26\.0\.1 /);
    assert.match(line('linux'), / Linux 26\.0\.1 /);
    assert.match(line('freebsd'), / freebsd 26\.0\.1 /);
});
