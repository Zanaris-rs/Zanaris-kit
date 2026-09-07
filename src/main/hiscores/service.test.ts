import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HiscoresService, type HiscoresIo } from './service.ts';
import type { HiscoresDef } from '../../shared/hiscores.ts';

const LOSTCITY: HiscoresDef = {
    source: { kind: 'lostcity', url: 'https://2004.lostcity.rs/api/hiscores/player/{name}' },
    site: 'https://2004.lostcity.rs/hiscores'
};

// Lost City's own shape (type/level/value/rank, value = xp * 10). The exact
// numbers only matter in that BOB and BOB_FRESH/BOB_STALE are each
// distinguishable from one another, so a test can tell which reply actually
// landed.
const BOB_JSON = [
    { type: 0, level: 90, value: 500_000, rank: 100 },
    { type: 1, level: 60, value: 200_000, rank: 200 }
];
const ALICE_JSON = [{ type: 0, level: 40, value: 80_000, rank: 5_000 }];
const BOB_FRESH_JSON = [{ type: 0, level: 91, value: 510_000, rank: 90 }];
const BOB_STALE_JSON = [{ type: 0, level: 10, value: 1_000, rank: 999_999 }];

type Response = { status: number; json: unknown };

interface Deferred {
    promise: Promise<Response>;
    resolve: (value: Response) => void;
    reject: (err: unknown) => void;
}

function deferred(): Deferred {
    let resolve!: Deferred['resolve'];
    let reject!: Deferred['reject'];
    const promise = new Promise<Response>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

interface Fake {
    io: HiscoresIo;
    fetches: string[];
    // One deferred per call to io.fetch, in call order, so a test can settle
    // any of them by hand and in whatever order it wants to exercise.
    queue: Deferred[];
}

function fake(): Fake {
    const fetches: string[] = [];
    const queue: Deferred[] = [];
    const io: HiscoresIo = {
        fetch: async url => {
            fetches.push(url);
            const d = deferred();
            queue.push(d);
            return d.promise;
        },
        now: () => 1_000_000
    };
    return { io, fetches, queue };
}

test('idle before anything is looked up', () => {
    const f = fake();
    const service = new HiscoresService(LOSTCITY, f.io);
    const view = service.view();
    assert.equal(view.status, 'idle');
    assert.deepEqual(view.skills, []);
    assert.equal(view.shown, null);
    assert.equal(view.error, null);
    assert.equal(view.site, LOSTCITY.site, 'site comes straight from the def');
});

test('a successful lookup moves idle -> loading -> ready and emits on each change', async () => {
    const f = fake();
    const service = new HiscoresService(LOSTCITY, f.io);
    const seen: string[] = [];
    service.subscribe(v => seen.push(v.status));

    assert.equal(service.view().status, 'idle');
    const p = service.lookup('bob');
    assert.equal(service.view().status, 'loading', 'loading is visible synchronously, before the fetch settles');

    f.queue[0]!.resolve({ status: 200, json: BOB_JSON });
    const view = await p;

    assert.equal(view.status, 'ready');
    assert.equal(view.shown, 'bob');
    assert.equal(view.skills.length, 2);
    assert.equal(view.error, null);
    assert.deepEqual(seen, ['loading', 'ready'], 'a mutation dropping either emit call must fail this line');
});

test('during loading, the previous player\'s rows and name are still in view()', async () => {
    const f = fake();
    const service = new HiscoresService(LOSTCITY, f.io);

    const first = service.lookup('bob');
    f.queue[0]!.resolve({ status: 200, json: BOB_JSON });
    await first;
    const bobSkills = service.view().skills;
    assert.ok(bobSkills.length > 0);

    service.lookup('alice');
    const mid = service.view();
    // A mutation that clears skills/shown as soon as a new lookup starts
    // (rather than only once it resolves) would blink the panel empty
    // between every lookup, which is exactly what this guards against.
    assert.equal(mid.status, 'loading');
    assert.deepEqual(mid.skills, bobSkills, 'bob\'s rows are still on screen while alice loads');
    assert.equal(mid.shown, 'bob', 'shown still names whose rows these are');
});

test('not found sets the status and message, and clears the previous rows', async () => {
    const f = fake();
    const service = new HiscoresService(LOSTCITY, f.io);

    const first = service.lookup('bob');
    f.queue[0]!.resolve({ status: 200, json: BOB_JSON });
    await first;
    assert.ok(service.view().skills.length > 0);

    const second = service.lookup('nobody');
    // Lost City has no not-found status of its own: a missing player is a
    // 200 with an empty list.
    f.queue[1]!.resolve({ status: 200, json: [] });
    const view = await second;

    assert.equal(view.status, 'notFound');
    assert.equal(view.error, 'No hiscores entry for that name.');
    // The judgement call: a firm not-found is new information, not a
    // hiccup, so bob's leftover rows would misread as belonging to
    // "nobody". A mutation that left them in place must fail these two.
    assert.deepEqual(view.skills, []);
    assert.equal(view.shown, null);
});

test('an error keeps the previous rows and sets the message beside them', async () => {
    const f = fake();
    const service = new HiscoresService(LOSTCITY, f.io);

    const first = service.lookup('bob');
    f.queue[0]!.resolve({ status: 200, json: BOB_JSON });
    await first;
    const bobSkills = service.view().skills;

    const second = service.lookup('alice');
    f.queue[1]!.resolve({ status: 500, json: {} });
    const view = await second;

    assert.equal(view.status, 'error');
    assert.deepEqual(view.skills, bobSkills, 'a mutation that clears rows on error must fail this line');
    assert.equal(view.shown, 'bob', 'shown still names whose rows are on screen, not the failed alice');
    assert.equal(view.error, 'The hiscores server is having a problem. Try again shortly.');
});

test('429 produces the rate-limit message specifically, not the generic one', async () => {
    const f = fake();
    const service = new HiscoresService(LOSTCITY, f.io);
    const p = service.lookup('bob');
    f.queue[0]!.resolve({ status: 429, json: {} });
    const view = await p;
    assert.equal(view.status, 'error');
    assert.equal(view.error, 'The server is rate-limiting lookups. Try again in a minute.');
});

test('a malformed body produces a plain "could not be read" message', async () => {
    const f = fake();
    const service = new HiscoresService(LOSTCITY, f.io);
    const p = service.lookup('bob');
    // 200 but not the list Lost City promises: parsePlayer throws.
    f.queue[0]!.resolve({ status: 200, json: { not: 'a list' } });
    const view = await p;
    assert.equal(view.status, 'error');
    assert.equal(view.error, 'The server sent back an answer that could not be read.');
});

test('a transport rejection produces a plain message and does not leak the raw error text', async () => {
    const f = fake();
    const service = new HiscoresService(LOSTCITY, f.io);
    const p = service.lookup('bob');
    f.queue[0]!.reject(new Error('getaddrinfo ENOTFOUND 2004.lostcity.rs'));
    const view = await p;
    assert.equal(view.status, 'error');
    assert.ok(view.error !== null);
    // What must be absent matters as much as what is present: a raw Node
    // error string in the panel is exactly what this message exists to avoid.
    assert.doesNotMatch(view.error!, /ENOTFOUND/);
    assert.doesNotMatch(view.error!, /getaddrinfo/);
});

test('supersession: a newer lookup for a different name wins even if the older reply arrives later', async () => {
    const f = fake();
    const service = new HiscoresService(LOSTCITY, f.io);

    const bob = service.lookup('bob');
    const alice = service.lookup('alice');
    assert.equal(f.fetches.length, 2, 'two different names never share a request');

    // Settle the newer one first and let it fully land...
    f.queue[1]!.resolve({ status: 200, json: ALICE_JSON });
    await alice;
    assert.equal(service.view().shown, 'alice');

    // ...then the older one arrives late. A mutation that applies replies in
    // arrival order instead of checking the sequence number must fail this.
    f.queue[0]!.resolve({ status: 200, json: BOB_JSON });
    const bobView = await bob;
    assert.equal(service.view().shown, 'alice', 'the late bob reply must not overwrite the current alice result');
    assert.equal(bobView.shown, 'alice', 'even the superseded call\'s own promise resolves to the current view');
});

test('supersession: the same name looked up twice is still resolved by sequence, not by name', async () => {
    const f = fake();
    const service = new HiscoresService(LOSTCITY, f.io);

    // bob (seq 1), then alice (seq 2, a different key so it is not deduped),
    // then bob again (seq 3, not deduped either since the in-flight key is
    // now 'alice', not 'bob'). Two of these three requests share the exact
    // name "bob" — the case a name check cannot tell apart.
    const bobStale = service.lookup('bob');
    const alice = service.lookup('alice');
    const bobFresh = service.lookup('bob');
    assert.equal(f.fetches.length, 3, 'no accidental dedup between the two non-adjacent bob calls');

    f.queue[2]!.resolve({ status: 200, json: BOB_FRESH_JSON });
    await bobFresh;
    assert.equal(service.view().shown, 'bob');
    assert.deepEqual(service.view().skills, [{ type: 0, rank: 90, level: 91, xp: 51_000 }]);

    // alice's reply lands after being superseded by the second bob request; must be dropped.
    f.queue[1]!.resolve({ status: 200, json: ALICE_JSON });
    await alice;
    assert.equal(service.view().shown, 'bob', 'alice must not land after the second bob request superseded it');

    // The oldest bob reply lands last, carrying the *same name* as the
    // reply already on screen. A check on the name alone would accept it;
    // only the sequence number tells it apart as stale.
    f.queue[0]!.resolve({ status: 200, json: BOB_STALE_JSON });
    await bobStale;
    assert.equal(service.view().shown, 'bob');
    assert.deepEqual(
        service.view().skills,
        [{ type: 0, rank: 90, level: 91, xp: 51_000 }],
        'the stale first bob reply must not stomp the fresh second bob reply'
    );
});

test('concurrent callers of the same in-flight lookup get the same promise', async () => {
    const f = fake();
    const service = new HiscoresService(LOSTCITY, f.io);

    const p1 = service.lookup('bob');
    const p2 = service.lookup('bob');
    const p3 = service.lookup('bob');
    assert.equal(f.fetches.length, 1, 'three overlapping callers of the same name cost one request');
    assert.equal(p1, p2);
    assert.equal(p2, p3);

    f.queue[0]!.resolve({ status: 200, json: BOB_JSON });
    const [v1, v2, v3] = await Promise.all([p1, p2, p3]);
    assert.equal(v1.shown, 'bob');
    assert.deepEqual(v1, v2);
    assert.deepEqual(v2, v3);
});

test('clear() returns to idle and empties the rows, without disturbing name', async () => {
    const f = fake();
    const service = new HiscoresService(LOSTCITY, f.io);
    const p = service.lookup('bob');
    f.queue[0]!.resolve({ status: 200, json: BOB_JSON });
    await p;

    service.clear();
    const view = service.view();
    assert.equal(view.status, 'idle');
    assert.deepEqual(view.skills, []);
    assert.equal(view.shown, null);
    assert.equal(view.error, null);
    assert.equal(view.name, 'bob', 'the box still remembers what was typed');
});

test('clear() during a pending lookup drops that lookup\'s eventual reply', async () => {
    const f = fake();
    const service = new HiscoresService(LOSTCITY, f.io);

    const p = service.lookup('bob');
    service.clear();
    assert.equal(service.view().status, 'idle');

    // The reply for the abandoned lookup lands late; it must not resurrect
    // the rows the clear just emptied.
    f.queue[0]!.resolve({ status: 200, json: BOB_JSON });
    await p;
    assert.equal(service.view().status, 'idle', 'a mutation that skips retiring the in-flight lookup on clear() must fail this line');
    assert.deepEqual(service.view().skills, []);
    assert.equal(service.view().shown, null);

    // A lookup for the same name straight after must not quietly rejoin the
    // orphaned request instead of asking again.
    const p2 = service.lookup('bob');
    assert.equal(f.fetches.length, 2, 'clear() must not leave the next same-name lookup sharing the abandoned promise');
    f.queue[1]!.resolve({ status: 200, json: BOB_JSON });
    const view = await p2;
    assert.equal(view.status, 'ready');
});

test('subscribe returns a working unsubscribe, and a subscriber added mid-flight still sees the completion', async () => {
    const f = fake();
    const service = new HiscoresService(LOSTCITY, f.io);
    const early: string[] = [];
    const off = service.subscribe(v => early.push(v.status));

    const p = service.lookup('bob'); // 'loading' already emitted to `early`

    const late: string[] = [];
    service.subscribe(v => late.push(v.status));

    f.queue[0]!.resolve({ status: 200, json: BOB_JSON });
    await p;

    assert.deepEqual(early, ['loading', 'ready']);
    assert.deepEqual(late, ['ready'], 'a subscriber added mid-flight sees the completion, not the loading it missed');

    off();
    service.clear();
    assert.deepEqual(early, ['loading', 'ready'], 'nothing after unsubscribing');
});
