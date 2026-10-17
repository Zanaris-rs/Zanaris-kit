import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scriptedChat, type ScriptedRoom } from './scripted.ts';
import { ChatService, type ChatIo, type ChatStart } from './service.ts';

const ROOMS: ScriptedRoom[] = [
    { name: '#a', topic: 'Room A, for testing', users: ['@alice', '+bob'], lines: [{ nick: 'alice', text: 'hello from a' }, { nick: 'bob', text: 'and again' }] },
    { name: '#b', topic: '', users: ['carol'], lines: [{ nick: 'carol', text: 'hello from b' }] }
];

const START: ChatStart = { nick: 'capture', server: 'irc.example.invalid', port: 6697, autoJoin: ['#a', '#b'], autoConnect: true, ignore: [], notify: true, password: null, canSavePassword: false };

/**
 * A service on the scripted server, with whatever the server defers run
 * when `flush` is called, as a turn of the event loop would run it. Run at
 * once instead, `opened` would reach the service before `connect` had
 * handed it the socket, and registration would go nowhere. No timer ever
 * fires: the service's own watch would otherwise call the server dead
 * before it had opened, and reconnect, and call it dead again, forever.
 */
function served(rooms: ScriptedRoom[] = ROOMS): { service: ChatService; server: ReturnType<typeof scriptedChat>; flush: () => void } {
    const queue: (() => void)[] = [];
    const server = scriptedChat({ rooms, defer: fn => queue.push(fn) });
    const io: ChatIo = { connect: server.connect, now: () => 1_700_000_000_000, setTimer: () => () => {} };
    const service = new ChatService(START, io);
    const flush = (): void => {
        for (let i = 0; queue.length > 0; i++) {
            assert.ok(i < 10_000, 'the scripted server never went quiet');
            queue.shift()!();
        }
    };
    return { service, server, flush };
}

test('a service on the scripted server joins and hears the rooms', () => {
    const { service, flush } = served();
    flush();

    const view = service.view();
    assert.equal(view.status, 'online');
    assert.equal(view.nick, 'capture');
    const a = view.channels.find(c => c.name === '#a');
    assert.ok(a, '#a was joined');
    assert.deepEqual(new Set(a.users.map(u => u.nick)), new Set(['alice', 'bob', 'capture']), 'the scripted users, and us, as a server names us too');
    assert.equal(a.users.find(u => u.nick === 'alice')?.prefixes, '@');
    assert.equal(a.topic?.text, 'Room A, for testing');
    assert.deepEqual(
        service.log('#a').lines.filter(l => l.kind === 'say').map(l => `${l.nick}: ${l.text}`),
        ['alice: hello from a', 'bob: and again']
    );
    assert.deepEqual(
        service.log('#b').lines.filter(l => l.kind === 'say').map(l => l.text),
        ['hello from b']
    );
    assert.equal(view.channels.find(c => c.name === '#b')?.topic, null, 'a room scripted with no topic has none');
});

test('a line said on the scripted server after the joins arrives, and one naming us is a ping', () => {
    const { service, server, flush } = served();
    flush();

    assert.equal(server.say('#a', 'dave', 'capture, look at this'), true);
    flush();
    const line = service.log('#a').lines.at(-1);
    assert.equal(line?.text, 'capture, look at this');
    assert.equal(line?.highlight, true);
    assert.equal(service.view().ping?.line.text, 'capture, look at this', 'nothing is on screen, so nothing has seen it');
});

test('the scripted server keeps every room it was asked to join, and says nothing with no connection', () => {
    const queue: (() => void)[] = [];
    const server = scriptedChat({ rooms: ROOMS, defer: fn => queue.push(fn) });
    assert.equal(server.say('#a', 'dave', 'anyone?'), false, 'nobody is connected to hear it');

    const { service, server: live, flush } = served();
    flush();
    assert.deepEqual(live.joins(), ['#a', '#b']);
    service.send('/join #elsewhere', '#a');
    flush();
    assert.deepEqual(live.joins(), ['#a', '#b', '#elsewhere']);
    assert.ok(service.view().channels.some(c => c.name === '#elsewhere'), 'a room it has no script for is joined, empty');
});

test('a service that hangs up hears nothing more, and a PING is answered', () => {
    const { service, server, flush } = served();
    flush();
    service.disconnect();
    flush();
    assert.equal(service.view().status, 'offline');
    assert.equal(server.say('#a', 'dave', 'capture?'), false, 'the connection closed with the hang-up');
    assert.equal(service.log('#a').lines.some(l => l.text === 'capture?'), false);

    // Connected again, the server answers a PING as a real one would, so the
    // service's silence watch is satisfied rather than reconnecting.
    const sent: string[] = [];
    const queue: (() => void)[] = [];
    const answering = scriptedChat({ rooms: ROOMS, defer: fn => queue.push(fn) });
    const socket = answering.connect('irc.example.invalid', 6697, { opened: () => {}, data: chunk => sent.push(chunk), closed: () => {} });
    socket.send('PING zanaris');
    while (queue.length > 0) queue.shift()!();
    assert.deepEqual(sent, [':scripted.invalid PONG scripted.invalid :zanaris\r\n']);
});
