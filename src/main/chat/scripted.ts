import { foldName, parseLine } from './protocol.ts';
import type { ChatIo, ChatSocket, SocketHandlers } from './service.ts';

/**
 * A chat server that is a script, for capture.
 *
 * Capture shoots chat with rooms in it, and must never open a socket to a
 * real network to do so: a capture would otherwise join strangers' channels
 * under a nick nobody chose. In capture mode `ChatService` is handed
 * this server's `connect` in place of `tlsConnect`. It answers just enough
 * for the client to register, join and hear: `CAP REQ` with a NAK, `USER`
 * with a welcome to the nick `NICK` gave, each `JOIN` with the join, the
 * topic, the names and their end, and then the room's lines from their
 * nicks, and `PING` with a `PONG`, so the service's silence watch is
 * answered as a real server answers it. Everything else is ignored, which
 * leaves the client's own echo of what it said, and no server reply to it.
 *
 * Every reply goes through `defer`, as bytes off a socket arrive on a later
 * turn: one written back from inside `send` would reach the client while it
 * is still in the middle of sending.
 */

/** One room the server knows: what a join is answered with, and what is said in it once joined. */
export interface ScriptedRoom {
    name: string;
    /** Empty for a room with no topic, which a join answers with 331. */
    topic: string;
    /** As a NAMES reply lists them, rank symbols in front: `@Bronze_Hal`. */
    users: string[];
    lines: { nick: string; text: string }[];
}

export interface ScriptedChat {
    /** `ChatIo.connect`, for a service to be built with. Host and port are not looked at. */
    connect: ChatIo['connect'];
    /**
     * A line from `nick` in `room`, relayed to the connection that is open,
     * as a server relays what someone else says. False, and nothing sent,
     * while no connection is registered and open.
     */
    say(room: string, nick: string, text: string): boolean;
    /** Every channel a JOIN has asked for, on any connection, as the client wrote it. */
    joins(): string[];
}

/** Where every server line comes from. `.invalid` is reserved, so the name cannot be anyone's. */
const SERVER = 'scripted.invalid';

export function scriptedChat(opts: { rooms: ScriptedRoom[]; defer: (fn: () => void) => void }): ScriptedChat {
    const joins: string[] = [];
    /** How to write to the connection that can be spoken to: registered and not closed. */
    let live: ((...lines: string[]) => void) | null = null;
    const room = (name: string): ScriptedRoom | undefined => opts.rooms.find(r => foldName(r.name) === foldName(name));
    const from = (nick: string): string => `${nick}!${nick}@${SERVER}`;

    const connect = (_host: string, _port: number, handlers: SocketHandlers): ChatSocket => {
        let open = true;
        /**
         * What the 001 welcomes and every reply is addressed to. Set by NICK
         * before registration only: after it, a rename would need the
         * server's NICK back, which this does not send.
         */
        let nick = '*';
        let registered = false;
        /** Each line its own deferred delivery, as a server's replies need not share a packet. */
        const reply = (...lines: string[]): void => {
            for (const line of lines) {
                opts.defer(() => {
                    if (open) handlers.data(`${line}\r\n`);
                });
            }
        };
        opts.defer(() => {
            if (open) handlers.opened();
        });

        const joined = (asked: string): void => {
            joins.push(asked);
            const known = room(asked);
            const name = known?.name ?? asked;
            const users = [...(known?.users ?? []), nick].join(' ');
            reply(
                `:${from(nick)} JOIN ${name}`,
                known !== undefined && known.topic !== '' ? `:${SERVER} 332 ${nick} ${name} :${known.topic}` : `:${SERVER} 331 ${nick} ${name} :No topic is set.`,
                `:${SERVER} 353 ${nick} = ${name} :${users}`,
                `:${SERVER} 366 ${nick} ${name} :End of /NAMES list.`,
                ...(known?.lines ?? []).map(line => `:${from(line.nick)} PRIVMSG ${name} :${line.text}`)
            );
        };

        return {
            send: line => {
                if (!open) return;
                const msg = parseLine(line);
                if (msg === null) return;
                const p = msg.params;
                switch (msg.command) {
                    case 'CAP':
                        if (p[0] === 'REQ') reply(`:${SERVER} CAP * NAK :${p[1] ?? ''}`);
                        return;
                    case 'NICK':
                        if (!registered && p[0] !== undefined && p[0] !== '') nick = p[0];
                        return;
                    case 'USER':
                        reply(`:${SERVER} 001 ${nick} :Welcome to capture's scripted chat server, ${nick}. Nothing here leaves this machine.`);
                        registered = true;
                        live = reply;
                        return;
                    case 'JOIN':
                        for (const asked of (p[0] ?? '').split(',')) if (asked !== '') joined(asked);
                        return;
                    case 'PING':
                        reply(`:${SERVER} PONG ${SERVER} :${p[0] ?? ''}`);
                        return;
                    default:
                        return;
                }
            },
            close: () => {
                if (!open) return;
                open = false;
                if (live === reply) live = null;
                opts.defer(() => handlers.closed('the connection closed'));
            }
        };
    };

    return {
        connect,
        say: (name, nick, text) => {
            if (live === null) return false;
            live(`:${from(nick)} PRIVMSG ${room(name)?.name ?? name} :${text}`);
            return true;
        },
        joins: () => [...joins]
    };
}
