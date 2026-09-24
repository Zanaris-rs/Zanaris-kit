import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkTarget, segments } from './chatText.ts';

test('a line with nothing in it to click is one piece of text', () => {
    assert.deepEqual(segments('hello there'), [{ kind: 'text', text: 'hello there' }]);
    assert.deepEqual(segments(''), []);
});

test('a link is picked out, without the full stop that ends the sentence', () => {
    assert.deepEqual(segments('see https://lostcity.rs/news. ok'), [
        { kind: 'text', text: 'see ' },
        { kind: 'link', text: 'https://lostcity.rs/news', url: 'https://lostcity.rs/news' },
        { kind: 'text', text: '. ok' }
    ]);
});

test('brackets around a link are the sentence\'s, and brackets inside one are its own', () => {
    assert.deepEqual(segments('(https://x.com/a)'), [
        { kind: 'text', text: '(' },
        { kind: 'link', text: 'https://x.com/a', url: 'https://x.com/a' },
        { kind: 'text', text: ')' }
    ]);
    const wiki = 'https://en.wikipedia.org/wiki/Mercury_(planet)';
    assert.deepEqual(segments(wiki), [{ kind: 'link', text: wiki, url: wiki }]);
});

test('www. with no scheme opens on the web', () => {
    assert.deepEqual(segments('www.runescape.wiki'), [{ kind: 'link', text: 'www.runescape.wiki', url: 'https://www.runescape.wiki/' }]);
});

test('a channel name on its own is picked out, but not a hash inside a word or a number', () => {
    assert.deepEqual(segments('come to #LostHQ, now'), [
        { kind: 'text', text: 'come to ' },
        { kind: 'channel', text: '#LostHQ' },
        { kind: 'text', text: ', now' }
    ]);
    assert.deepEqual(segments('(#2004scape)'), [{ kind: 'text', text: '(' }, { kind: 'channel', text: '#2004scape' }, { kind: 'text', text: ')' }]);
    assert.deepEqual(segments('we are #1'), [{ kind: 'text', text: 'we are #1' }]);
    assert.deepEqual(segments('C# and page#top'), [{ kind: 'text', text: 'C# and page#top' }]);
});

test('a link with a fragment is one link, not a link and a channel', () => {
    assert.deepEqual(segments('https://x.com/page#top'), [{ kind: 'link', text: 'https://x.com/page#top', url: 'https://x.com/page#top' }]);
});

test('only the web is ever a link target', () => {
    assert.equal(linkTarget('https://lostcity.rs'), 'https://lostcity.rs/');
    assert.equal(linkTarget('http://lostcity.rs/a?b=c'), 'http://lostcity.rs/a?b=c');
    assert.equal(linkTarget('javascript:alert(1)'), null);
    assert.equal(linkTarget('file:///etc/passwd'), null);
    assert.equal(linkTarget('steam://run/1'), null);
    assert.equal(linkTarget('not a url'), null);
    assert.deepEqual(segments('file:///etc/passwd'), [{ kind: 'text', text: 'file:///etc/passwd' }]);
});
