import type { HiscoresDef, HiscoresStatus, HiscoresView, PlayerSkill } from '../../shared/hiscores.ts';
import { normaliseName } from '../../shared/hiscores.ts';
import { lookupUrl, parsePlayer, NOT_FOUND } from './sources.ts';

/** Everything the service needs from outside, so it runs under node --test with fakes. */
export interface HiscoresIo {
    /** Resolves for any status the server returns. Rejects only on a transport failure. */
    fetch(url: string): Promise<{ status: number; json: unknown }>;
    now(): number;
}

const NOT_FOUND_MESSAGE = 'No hiscores entry for that name.';
const RATE_LIMITED_MESSAGE = 'The server is rate-limiting lookups. Try again in a minute.';
const SERVER_PROBLEM_MESSAGE = 'The hiscores server is having a problem. Try again shortly.';
const UNREADABLE_MESSAGE = 'The server sent back an answer that could not be read.';
const UNREACHABLE_MESSAGE = 'Could not reach the hiscores server.';

/**
 * `parsePlayer` throws for two reasons it deliberately does not tell apart —
 * a status carrying no answer at all (429, 5xx, a proxy's HTML page) or a
 * body that does not match the shape it promised — because sorting that out
 * is this file's job, not the parser's. The status code we already hold by
 * the time it throws is enough to give 429 the exact words the plan pins to
 * it and 5xx its own plain message, folding everything else into one honest
 * "could not read it" rather than inventing wording for every odd status a
 * server might someday send.
 */
function messageForStatus(status: number): string {
    if (status === 429) return RATE_LIMITED_MESSAGE;
    if (status >= 500) return SERVER_PROBLEM_MESSAGE;
    return UNREADABLE_MESSAGE;
}

type Outcome = { kind: 'ready'; skills: PlayerSkill[] } | { kind: 'notFound' | 'error'; message: string };

interface Pending {
    key: string;
    seq: number;
    promise: Promise<HiscoresView>;
}

/**
 * One per server id, shared by every window of that server: the last
 * lookup's rows, kept on screen while the next one loads or if it fails, so
 * the panel never blinks empty between lookups or goes blank over a
 * hiccup. Modelled directly on WorldsService — same io injection, same
 * view/subscribe/emit shape, same habit of keeping the last good data on
 * screen rather than clearing it the moment something goes wrong.
 */
export class HiscoresService {
    private readonly def: HiscoresDef;
    private readonly io: HiscoresIo;
    private status: HiscoresStatus = 'idle';
    private name = '';
    private skills: PlayerSkill[] = [];
    private shown: string | null = null;
    private error: string | null = null;
    // Bumped on every genuinely new request, never on a deduped one. A reply
    // is only ever painted onto the view while its own sequence still equals
    // this one — see `run` for why that has to be a counter and not a check
    // against the looked-up name.
    private seq = 0;
    private inFlight: Pending | null = null;
    private readonly subscribers = new Set<(view: HiscoresView) => void>();

    constructor(def: HiscoresDef, io: HiscoresIo) {
        this.def = def;
        this.io = io;
    }

    view(): HiscoresView {
        return {
            status: this.status,
            name: this.name,
            skills: this.skills.map(s => ({ ...s })),
            shown: this.shown,
            error: this.error,
            site: this.def.site
        };
    }

    /**
     * Looks a name up. A caller who asks again for the exact name that is
     * already loading gets the very same promise back instead of a second
     * round trip — an Enter keypress landing right before a click on Look
     * up should not cost a second request against a server that rate-limits
     * after a handful of them in a minute.
     *
     * Anything else — a different name, or this same name once the previous
     * attempt has already finished — starts a fresh request under a new
     * sequence number, which is what makes it a *newer* lookup as far as
     * `run` is concerned, whether or not the text happens to match the one
     * before it.
     */
    lookup(name: string): Promise<HiscoresView> {
        const key = normaliseName(name);
        if (this.inFlight !== null && this.inFlight.key === key) return this.inFlight.promise;

        const seq = ++this.seq;
        this.name = name;
        this.status = 'loading';
        this.emit();

        const promise = this.run(name, seq);
        this.inFlight = { key, seq, promise };
        return promise;
    }

    /**
     * Clears the table and the error, back to idle. Does not forget the name
     * in the box.
     *
     * Also retires whatever lookup is currently in flight: without this, a
     * slow reply landing after the clear would repaint the very rows just
     * cleared, and a same-name lookup started right after would silently
     * rejoin that orphaned request instead of asking again. Bumping the
     * sequence makes the old reply as stale as any superseded lookup's;
     * dropping the bookkeeping entry lets the next lookup start fresh.
     */
    clear(): void {
        this.status = 'idle';
        this.skills = [];
        this.shown = null;
        this.error = null;
        this.seq++;
        this.inFlight = null;
        this.emit();
    }

    subscribe(cb: (view: HiscoresView) => void): () => void {
        this.subscribers.add(cb);
        return () => {
            this.subscribers.delete(cb);
        };
    }

    private async run(name: string, seq: number): Promise<HiscoresView> {
        const outcome = await this.fetchOutcome(name);

        // Between the fetch going out and this line, a later call to
        // `lookup` may have already moved the service on to a different
        // name. Painting this reply now would yank the panel back to a name
        // the player has since moved past — worse, if the two lookups
        // shared a name (looking the same player up twice in a row is a
        // real thing a user does), a check on the *name* would wave this
        // stale reply straight through, since it still matches. Only the
        // sequence number tells the two apart, so this is the one guard
        // that decides whether a reply is still wanted at all.
        if (seq !== this.seq) return this.view();

        if (outcome.kind === 'ready') {
            this.status = 'ready';
            this.skills = outcome.skills;
            this.shown = name;
            this.error = null;
        } else if (outcome.kind === 'notFound') {
            // The server gave a firm answer: nobody by this name. That is
            // new information, not a hiccup, and it means the rows already
            // on screen belong to a different player entirely — leaving
            // them up would read as if that data were the (nonexistent)
            // name's own. Unlike the error branch below, where we still
            // don't know anything about the name just searched, here we do
            // know it is empty, so the table is cleared along with it.
            this.status = 'notFound';
            this.skills = [];
            this.shown = null;
            this.error = outcome.message;
        } else {
            // A failed attempt tells us nothing about whether the name is
            // valid, only that this particular try didn't land — so the
            // last good table is still the best information available and
            // stays up, exactly as WorldsService keeps its last good world
            // list through a failed refresh.
            this.status = 'error';
            this.error = outcome.message;
        }
        this.inFlight = null;
        this.emit();
        return this.view();
    }

    private async fetchOutcome(name: string): Promise<Outcome> {
        let status: number;
        let json: unknown;
        try {
            ({ status, json } = await this.io.fetch(lookupUrl(this.def.source, name)));
        } catch {
            // A transport rejection carries a raw Node error — things like
            // `getaddrinfo ENOTFOUND` — that means nothing to a player and
            // must never reach the panel verbatim; only the plain fact that
            // the server could not be reached is worth saying.
            return { kind: 'error', message: UNREACHABLE_MESSAGE };
        }
        try {
            const result = parsePlayer(this.def.source, status, json);
            return result === NOT_FOUND ? { kind: 'notFound', message: NOT_FOUND_MESSAGE } : { kind: 'ready', skills: result };
        } catch {
            return { kind: 'error', message: messageForStatus(status) };
        }
    }

    private emit(): void {
        const view = this.view();
        for (const cb of this.subscribers) cb(view);
    }
}
