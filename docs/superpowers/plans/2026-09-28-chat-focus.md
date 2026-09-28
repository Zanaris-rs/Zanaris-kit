# Chat Focus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the chat pane's log the room it is losing to chrome, and make its commands findable from the box.

**Architecture:** The rules go in pure modules `node --test` reaches: the command table and menu logic in `shared/chatInput.ts`, the fold in a new `shared/chatLog.ts`, and presence marks and the New divider's line in `main/chat/client.ts`. The renderer (`tools/Chat.tsx` and its neighbours) only draws what they decide.

**Tech Stack:** TypeScript, React 19, Tailwind 4 over the kit's `--color-*` tokens, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-28-chat-focus-design.md`

## Global Constraints

- Every colour is a `--color-*` token (`text-gold`, `text-cream`, `text-dim`, `text-faint`, `border-edge-dark`…). No literal colour anywhere under `src/renderer`; `themes.test.ts` fails on one.
- Nothing the shell draws may leave the pane's box: native views sit above the shell.
- `.btn`, `.sunk`, `.tab` and the base `button` rule are unlayered CSS: a font size or padding that has to beat them goes inline.
- Tests import with the `.ts` extension (`from './chatInput.ts'`).
- A comment that describes behaviour the code does not have is a defect: re-read the comments around every change.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: The command table, the menu's rules, and `/help` from the table

**Files:**
- Modify: `src/shared/chatInput.ts:9-37` (replace `COMMANDS`)
- Modify: `src/main/chat/client.ts:134-152` (`HELP`)
- Test: `src/shared/chatInput.test.ts`, `src/main/chat/protocol.test.ts`, `src/main/chat/client.test.ts:1100-1108`

**Interfaces:**
- Produces: `CommandHelp`, `COMMAND_HELP`, `COMMANDS: readonly string[]`, `CommandMenu`, `commandMenu(text, caret): CommandMenu | null`, `commandHint(text): CommandHelp | null`, `menuEnter(menu): 'send' | 'take'`, `takeCommand(text, command): { text: string; caret: number }`.

- [ ] **Step 1: Write the failing tests** in `chatInput.test.ts`

```ts
import { COMMAND_HELP, commandHint, commandMenu, menuEnter, takeCommand } from './chatInput.ts';

const names = (text: string, caret = text.length): string[] | undefined => commandMenu(text, caret)?.matches.map(c => c.name);

test('a slash alone offers every command, and letters narrow it by name or alias', () => {
    assert.equal(commandMenu('/', 1)?.matches.length, COMMAND_HELP.length);
    assert.deepEqual(names('/jo'), ['join']);
    assert.deepEqual(names('/wi'), ['whois'], 'by alias');
    assert.deepEqual(names('/b'), ['away'], '/back is away with no reason');
    assert.deepEqual(names('/DE'), ['deop', 'devoice'], 'in the table order, whatever the case');
});

test('the menu is closed wherever a command is not being typed', () => {
    assert.equal(commandMenu('', 0), null);
    assert.equal(commandMenu('hello', 5), null);
    assert.equal(commandMenu('//me', 4), null, 'a doubled slash is a message');
    assert.equal(commandMenu('/join ', 6), null, 'the space ends the word');
    assert.equal(commandMenu('/join #x', 8), null);
    assert.equal(commandMenu('/joi', 2), null, 'the caret inside the word');
    assert.equal(commandMenu('/zz', 3), null, 'nothing it could be');
    assert.equal(commandMenu('/12', 3), null);
});

test('the usage line follows a command the kit reads, once its space is typed', () => {
    assert.equal(commandHint('/join'), null);
    assert.equal(commandHint('/join ')?.name, 'join');
    assert.equal(commandHint('/j #LostHQ')?.name, 'join');
    assert.equal(commandHint('/mode #x +m'), null, "the server's own commands have none");
    assert.equal(commandHint('hi /join '), null);
});

test('Enter sends a whole command that runs alone, and takes the highlighted one otherwise', () => {
    assert.equal(menuEnter(commandMenu('/clear', 6)!), 'send');
    assert.equal(menuEnter(commandMenu('/back', 5)!), 'send', 'an alias counts');
    assert.equal(menuEnter(commandMenu('/cl', 3)!), 'take');
    assert.equal(menuEnter(commandMenu('/join', 5)!), 'take', 'it needs a channel');
});

test('taking a command writes its name and a space, and keeps the rest of the line', () => {
    const join = COMMAND_HELP.find(c => c.name === 'join')!;
    assert.deepEqual(takeCommand('/jo', join), { text: '/join ', caret: 6 });
    assert.deepEqual(takeCommand('/j #LostHQ', join), { text: '/join #LostHQ', caret: 6 });
});
```

In `protocol.test.ts` (import `COMMAND_HELP` beside `COMMANDS`):

```ts
test('a command runs typed alone exactly when the table says so, and an alias reads as its command', () => {
    for (const command of COMMAND_HELP) {
        assert.equal(parseInput(`/${command.name}`) !== null, command.bare, `/${command.name} alone`);
        const named = parseInput(`/${command.name} bob #LostHQ some words`);
        for (const alias of command.aliases) assert.equal(parseInput(`/${alias} bob #LostHQ some words`)?.kind, named?.kind, `/${alias}`);
    }
});
```

In `client.test.ts`, the `/help` test's last assertions become:

```ts
    f.client.input('/help');
    const help = f.lines().map(l => l.text);
    for (const command of COMMAND_HELP) assert.ok(help.some(t => t.startsWith(`/${command.name} `)), `/help names /${command.name}`);
    assert.deepEqual(f.sent, []);
```

- [ ] **Step 2: Run to see them fail** — `npm test` → fails importing `COMMAND_HELP`.

- [ ] **Step 3: Implement** in `chatInput.ts`

```ts
/** A command the kit reads itself, as the menu and /help describe it. */
export interface CommandHelp {
    name: string;
    /** What follows the name, written for a person: "#channel", "nick [reason]". Empty when nothing does. */
    args: string;
    /** What it does, in a few words. */
    about: string;
    /** Whether it does something typed alone. A test in main's protocol.test.ts holds this to `parseInput`. */
    bare: boolean;
    /** Shorter names `parseInput` reads as this one. */
    aliases: readonly string[];
}

export const COMMAND_HELP: readonly CommandHelp[] = [
    { name: 'away', args: '[reason]', about: 'mark yourself away; with no reason, back', bare: true, aliases: ['back'] },
    { name: 'clear', args: '', about: 'empty this tab', bare: true, aliases: [] },
    { name: 'close', args: '', about: 'leave this channel, or end this conversation', bare: true, aliases: [] },
    { name: 'deop', args: 'nick', about: "take away someone's operator rank", bare: false, aliases: [] },
    { name: 'devoice', args: 'nick', about: "take away someone's voice", bare: false, aliases: [] },
    { name: 'help', args: '', about: 'list these commands', bare: true, aliases: [] },
    { name: 'ignore', args: '[nick]', about: "hide someone's messages; with no nick, list who is hidden", bare: true, aliases: [] },
    { name: 'invite', args: 'nick [#channel]', about: 'invite someone to this channel', bare: false, aliases: [] },
    { name: 'join', args: '#channel', about: 'join a channel', bare: false, aliases: ['j'] },
    { name: 'kick', args: 'nick [reason]', about: 'remove someone from this channel', bare: false, aliases: [] },
    { name: 'me', args: 'text', about: 'say what you are doing', bare: false, aliases: [] },
    { name: 'msg', args: 'nick text', about: 'send someone a private message', bare: false, aliases: [] },
    { name: 'nick', args: 'name', about: 'change your name for this session', bare: false, aliases: [] },
    { name: 'notice', args: 'nick text', about: 'send a notice', bare: false, aliases: [] },
    { name: 'op', args: 'nick', about: 'make someone a channel operator', bare: false, aliases: [] },
    { name: 'part', args: '[#channel]', about: 'leave this channel', bare: true, aliases: [] },
    { name: 'query', args: 'nick [text]', about: 'talk to someone privately', bare: false, aliases: ['q'] },
    { name: 'quit', args: '[reason]', about: 'disconnect', bare: true, aliases: [] },
    { name: 'topic', args: '[text]', about: "show or set this channel's topic", bare: true, aliases: [] },
    { name: 'unignore', args: 'nick', about: "stop hiding someone's messages", bare: false, aliases: [] },
    { name: 'voice', args: 'nick', about: 'give someone a voice', bare: false, aliases: [] },
    { name: 'whois', args: 'nick', about: 'look someone up', bare: false, aliases: ['wi'] }
];

/** Every command the kit reads itself, offered when one is being typed. Kept in step with `parseInput` by a test there. */
export const COMMANDS: readonly string[] = COMMAND_HELP.map(c => c.name);

/** The command being typed, without its slash, and every command it could be. */
export interface CommandMenu {
    typed: string;
    matches: readonly CommandHelp[];
}

/** A command word at the start of the box: a slash and letters, ending at a space or the end. */
const COMMAND_WORD = /^\/([A-Za-z]*)(?=\s|$)/;

export function commandMenu(text: string, caret: number): CommandMenu | null {
    const word = COMMAND_WORD.exec(text);
    if (word === null || caret !== word[0].length) return null;
    const typed = word[1]!.toLowerCase();
    const matches = COMMAND_HELP.filter(c => c.name.startsWith(typed) || c.aliases.some(a => a.startsWith(typed)));
    return matches.length === 0 ? null : { typed, matches };
}

function commandNamed(typed: string): CommandHelp | null {
    const name = typed.toLowerCase();
    return COMMAND_HELP.find(c => c.name === name || c.aliases.includes(name)) ?? null;
}

export function commandHint(text: string): CommandHelp | null {
    const word = /^\/([A-Za-z]+)\s/.exec(text);
    return word === null ? null : commandNamed(word[1]!);
}

export function menuEnter(menu: CommandMenu): 'send' | 'take' {
    return commandNamed(menu.typed)?.bare === true ? 'send' : 'take';
}

export function takeCommand(text: string, command: CommandHelp): { text: string; caret: number } {
    const head = `/${command.name} `;
    return { text: `${head}${text.replace(/^\/[A-Za-z]*\s*/, '')}`, caret: head.length };
}
```

(Each exported function carries a doc comment in the file's voice.)

In `client.ts`, import `COMMAND_HELP` from `../../shared/chatInput.ts` and:

```ts
/** /help's answer: the table the message box's menu reads, one command a line. */
const HELP = [...COMMAND_HELP.map(c => `/${c.name}${c.args === '' ? '' : ` ${c.args}`} — ${c.about}`), 'Anything else goes to the server as you typed it.'];
```

- [ ] **Step 4: Run** `npm test` and `npm run typecheck` → pass.
- [ ] **Step 5: Commit** `feat: one command table, for /help and a menu to read`

---

### Task 2: Presence marks, the New divider's line, and a left tab's mentions

**Files:**
- Modify: `src/shared/chat.ts` (`ChatLine.presence`, `ChatView.newFrom`)
- Modify: `src/main/chat/client.ts` (`Chan`, `chan()`, `push`, `joined`, `parted`, `userQuit`, `renamed`, `select`, `snapshot`)
- Modify: `src/main/chat/service.ts:120` (`offlineChat`)
- Test: `src/main/chat/client.test.ts`

**Interfaces:**
- Produces: `type Presence = 'join' | 'part' | 'quit' | 'nick'`; `ChatLine.presence?: Presence`; `ChatView.newFrom: number | null`.

- [ ] **Step 1: Write the failing tests**

```ts
test('churn in a channel is marked as presence, and a kick or a private quit is not', () => {
    const f = online();
    f.client.receive(':irc.libera.chat 353 mage = #04scape :mage bob carl');
    f.client.receive(':irc.libera.chat 366 mage #04scape :End of /NAMES list');
    f.client.receive(':alice!a@h JOIN #04scape');
    f.client.receive(':alice!a@h NICK alicia');
    f.client.receive(':alicia!a@h PART #04scape :bye');
    f.client.receive(':bob!b@h QUIT :Ping timeout');
    f.client.receive(':zed!z@h KICK #04scape carl :spam');
    assert.deepEqual(f.lines().map(l => l.presence), ['join', 'nick', 'part', 'quit', undefined]);
    assert.ok(!('presence' in f.lines().at(-1)!), 'absent, not undefined');

    f.client.receive(':dave!d@h PRIVMSG mage :hi');
    f.client.select('dave');
    f.client.receive(':dave!d@h QUIT :gone');
    assert.equal(f.lines().at(-1)?.text, 'dave quit (gone)');
    assert.ok(!('presence' in f.lines().at(-1)!), 'the one person you are talking to leaving is news');
});

test('coming back to a tab marks where what arrived while it was left begins', () => {
    const f = online({ channels: ['#04scape', '#other'] });
    f.client.receive(':bob!b@h PRIVMSG #04scape :before');
    f.client.select('#other');
    assert.equal(f.client.snapshot().newFrom, null, 'nothing unread in #other');
    f.client.receive(':bob!b@h JOIN #04scape');
    f.client.select('#04scape');
    assert.equal(f.client.snapshot().newFrom, null, 'churn alone draws no divider');

    f.client.select('#other');
    f.client.receive(':carl!c@h JOIN #04scape');
    f.client.receive(':bob!b@h PRIVMSG #04scape :while you were away');
    f.client.select('#04scape');
    const joined = f.lines().at(-2)!;
    assert.equal(joined.text, 'carl joined');
    assert.equal(f.client.snapshot().newFrom, joined.id, 'above the first line of any kind since the tab was left');

    f.client.receive(':bob!b@h PRIVMSG #04scape :and now');
    f.client.select('#04scape');
    assert.equal(f.client.snapshot().newFrom, joined.id, 'it stays while you stay, reselecting included');

    f.client.select('#other');
    f.client.select('#04scape');
    assert.equal(f.client.snapshot().newFrom, null, 'leaving clears it, and nothing arrived since');
});

test('a tab closed while open hands over to Status with no divider', () => {
    const f = online({ channels: ['#04scape', '#other'] });
    f.client.receive(':bob!b@h PRIVMSG #other :hi');
    f.client.select('#other');
    assert.notEqual(f.client.snapshot().newFrom, null);
    f.client.close('#other');
    assert.equal(f.client.snapshot().active, SERVER_LOG);
    assert.equal(f.client.snapshot().newFrom, null);
});

test('a mention seen while its tab was open does not colour the tab once it is left', () => {
    const f = online({ channels: ['#04scape', '#other'] });
    f.client.receive(':bob!b@h PRIVMSG #04scape :mage: look');
    f.client.select('#other');
    f.client.receive(':bob!b@h PRIVMSG #04scape :plain');
    assert.equal(f.channel('#04scape').unread, 1);
    assert.equal(f.channel('#04scape').highlights, 0);
});
```

- [ ] **Step 2: Run** → the presence, `newFrom` and highlight assertions fail.

- [ ] **Step 3: Implement.** In `chat.ts`:

```ts
/** Someone else joining, leaving, quitting or changing name in a channel. */
export type Presence = 'join' | 'part' | 'quit' | 'nick';
```

`ChatLine` gains `presence?: Presence` (documented: churn, which the log folds when it comes in a run; absent on every other line). `ChatView` gains `newFrom: number | null` (documented as in the spec).

In `client.ts`: `Chan` gains `seen: number` (the latest line id when the tab was last left) and `newFrom: number | null`; `chan()` starts them at `0` and `null`. `push` takes a last optional `presence?: Presence` and spreads `...(presence === undefined ? {} : { presence })` into the line. `joined`, `parted`, the channel branch of `userQuit` and the channel loop of `renamed` pass `'join'`, `'part'`, `'quit'`, `'nick'` (with `highlight` `false`). `select`:

```ts
    select(channel: string): void {
        const chan = this.chan(channel);
        const left = this.chans.get(key(this.activeName));
        if (left !== chan) {
            if (left !== undefined) {
                left.seen = this.lastId;
                left.newFrom = null;
                left.highlights = 0;
            }
            chan.newFrom = chan.unread > 0 ? (chan.lines.find(l => l.id > chan.seen)?.id ?? null) : null;
        }
        this.activeName = chan.name;
        chan.unread = 0;
        chan.highlights = 0;
    }
```

`snapshot` adds `newFrom: active?.newFrom ?? null`. `offlineChat` adds `newFrom: null`.

- [ ] **Step 4: Run** `npm test`, `npm run typecheck` → pass.
- [ ] **Step 5: Commit** `feat: churn is marked, and a tab remembers where you left it`

---

### Task 3: `foldLog`

**Files:**
- Create: `src/shared/chatLog.ts`, `src/shared/chatLog.test.ts`

**Interfaces:**
- Consumes: `ChatLine`, `Presence` (Task 2).
- Produces: `type LogItem = { kind: 'line'; line: ChatLine } | { kind: 'fold'; key: number; lines: ChatLine[]; summary: string }`; `foldLog(lines: readonly ChatLine[], newFrom: number | null): LogItem[]`.

- [ ] **Step 1: Write the failing tests**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatLine, Presence } from './chat.ts';
import { foldLog } from './chatLog.ts';

let id = 0;
function churn(text: string, presence: Presence): ChatLine {
    return { id: ++id, channel: '#04scape', kind: 'system', nick: null, text, at: 0, highlight: false, presence };
}
function say(text: string): ChatLine {
    return { id: ++id, channel: '#04scape', kind: 'say', nick: 'bob', text, at: 0, highlight: false };
}

test('a run of churn folds into one item that counts it, keyed by its first line', () => {
    const lines = [say('hi'), churn('a joined', 'join'), churn('b joined', 'join'), churn('c left', 'part'), churn('d quit', 'quit'), churn('e is now known as f', 'nick'), say('bye')];
    const items = foldLog(lines, null);
    assert.deepEqual(items.map(i => i.kind), ['line', 'fold', 'line']);
    const fold = items[1]!;
    assert.ok(fold.kind === 'fold');
    assert.equal(fold.summary, '2 joined, 2 left, 1 renamed');
    assert.equal(fold.key, lines[1]!.id);
    assert.deepEqual(fold.lines, lines.slice(1, 6));
});

test('churn alone stays a line, and what is not churn never folds', () => {
    const lines = [churn('a joined', 'join'), say('hi'), { ...say('x was kicked by y'), kind: 'system' as const, nick: null }, say('bye')];
    assert.deepEqual(foldLog(lines, null).map(i => i.kind), ['line', 'line', 'line', 'line']);
});

test('a run breaks where the new lines begin', () => {
    const lines = [churn('a joined', 'join'), churn('b joined', 'join'), churn('c joined', 'join')];
    assert.deepEqual(foldLog(lines, lines[2]!.id).map(i => i.kind), ['fold', 'line']);
    assert.deepEqual(foldLog(lines, lines[1]!.id).map(i => i.kind), ['line', 'fold']);
});

test('what did not happen is left out of the summary, and a part and a quit are both leaving', () => {
    const fold = foldLog([churn('a left', 'part'), churn('b quit', 'quit'), churn('c quit', 'quit')], null)[0]!;
    assert.ok(fold.kind === 'fold');
    assert.equal(fold.summary, '3 left');
});
```

- [ ] **Step 2: Run** → fails, no module.
- [ ] **Step 3: Implement** `chatLog.ts`:

```ts
import type { ChatLine, Presence } from './chat.ts';

export type LogItem = { kind: 'line'; line: ChatLine } | { kind: 'fold'; key: number; lines: ChatLine[]; summary: string };

export function foldLog(lines: readonly ChatLine[], newFrom: number | null): LogItem[] {
    const items: LogItem[] = [];
    let run: ChatLine[] = [];
    const flush = (): void => {
        if (run.length === 1) items.push({ kind: 'line', line: run[0]! });
        if (run.length > 1) items.push({ kind: 'fold', key: run[0]!.id, lines: run, summary: summary(run) });
        run = [];
    };
    for (const line of lines) {
        if (line.id === newFrom) flush();
        if (line.presence !== undefined) {
            run.push(line);
            continue;
        }
        flush();
        items.push({ kind: 'line', line });
    }
    flush();
    return items;
}

const WORDS: [Presence[], string][] = [
    [['join'], 'joined'],
    [['part', 'quit'], 'left'],
    [['nick'], 'renamed']
];

function summary(run: readonly ChatLine[]): string {
    return WORDS.map(([kinds, word]): [number, string] => [run.filter(l => l.presence !== undefined && kinds.includes(l.presence)).length, word])
        .filter(([n]) => n > 0)
        .map(([n, word]) => `${n} ${word}`)
        .join(', ');
}
```

- [ ] **Step 4: Run** → pass. **Step 5: Commit** `feat: runs of joins and parts fold into one line`

---

### Task 4: The tab row — a gear, mention-coloured counts, People and Info

**Files:**
- Modify: `src/renderer/tab.tsx` (an `icon` prop)
- Modify: `src/renderer/icons.tsx` (`Info`, `People`)
- Modify: `src/renderer/tools/Chat.tsx` (`ChatTabs`, `Chat`)

- [ ] **Step 1: `Tab` takes `icon?: ReactNode`.** With one, the body is the icon instead of the label's `<span>`, the element carries `aria-label={label}` and `title={title ?? label}`, and it is padded 6px a side (`ICON_PADDED`) rather than 10. Document it beside the other props.
- [ ] **Step 2: `Info` and `People` glyphs** in the chrome section of `icons.tsx`: 18×18, `stroke="currentColor"`, `strokeWidth` 1.6, like `Gear`. Info is a ring with an i; People is a head and shoulders with a second behind it.
- [ ] **Step 3: `ChatTabs`.** Settings becomes `<Tab role="button" label="Chat settings" icon={<Gear />} …/>`. A channel's count is `text-gold` when `channel.highlights > 0`, else `text-cream`; its title appends ` — 3 unread` and `, 1 names you`. After the channels, when a channel is open (`!onSettings && isChannel(view.active)`), an `ml-auto` group holds People (the glyph and the count) and Info, each a `.btn` 26px tall with `aria-pressed`, a title and an `aria-label`.
- [ ] **Step 4:** `npm run typecheck`, `npm test`. **Commit** `feat: chat's settings are a gear, and a count says whether it names you`

---

### Task 5: What fills the log's space — info view, list toggles, no topic row

**Files:**
- Modify: `src/renderer/tools/Chat.tsx` (`TopicBar` removed, `ChannelInfo` added, `Conversation` and `Chat` state)
- Modify: `src/renderer/tools/ChatUsers.tsx` (header removed)

- [ ] **Step 1: State in `Chat`:** `swap: 'log' | 'info' | 'users'` and `sidebar: boolean` (true). A layout effect on `view.active` puts `swap` back to `'log'`. People: wide flips `sidebar`, narrow flips `swap` between `'users'` and `'log'`. Info flips `swap` between `'info'` and `'log'`. `Conversation` takes `swap`, `sidebar` and `onSent` (which sets `swap` to `'log'`), in place of its own `usersOpen`.
- [ ] **Step 2: `ChannelInfo`**, a `sunk` well scrolling on its own: a "Topic" label in `text-dim`, the topic through `Words`, "Set by X on <date>" in `text-dim` when known; then the count, the modes (not a bare "+"), and "Created <date>" with the full time in its title. No topic, no topic section.
- [ ] **Step 3: `ChatUsers`** loses its header; its section's label is "18 people in #LostHQ" (1 person). `createdOn` and `RANK_NAME`'s use stay where they are needed; `createdOn` moves to `ChannelInfo` if nothing else uses it.
- [ ] **Step 4:** `TopicBar` and its comment go. The `Conversation` comment says what fills the space now.
- [ ] **Step 5:** typecheck, test. **Commit** `feat: channel info is a view, and the log gets the topic's row back`

---

### Task 6: The command menu, the usage line, placeholders and drafts

**Files:**
- Modify: `src/renderer/tools/Chat.tsx` (`Conversation`, new `CommandList`)

- [ ] **Step 1: Drafts.** Module-level `const drafts = new Map<string, string>()` beside `sentLines`, keyed by `foldName(channel)`. A `write(next)` helper sets state and the map; `onChange`, `mention`, Tab completion, recall and taking a command all go through it. A layout effect on `view.active` loads the draft and drops `completion`, `recalled` and the menu's highlight. `send` deletes the entry.
- [ ] **Step 2: Menu state.** `const [caret, setCaret] = useState(0)`, updated from the box's `onSelect` and `onChange`; `menu = dismissed === typedWord ? null : commandMenu(draft, caret)`; `pick` (the highlight, reset to 0 when `menu.typed` changes). `onKey` first: when `menu` is open, ArrowDown/ArrowUp move `pick` (wrapping), Tab and Shift-Tab take `menu.matches[pick]`, Enter takes it unless `menuEnter(menu) === 'send'`, Escape sets `dismissed`. Taking writes `takeCommand(draft, command)` and places the caret.
- [ ] **Step 3: `CommandList`**: `absolute inset-x-0 bottom-0 max-h-full overflow-y-auto` inside the log's container (which becomes `relative`), a raised panel on the stone's tokens, `role="listbox"`, one `role="option"` row per match with `aria-selected`, `/name` in cream, args and about in dim. `onMouseDown` prevents default (the box keeps focus) and takes the row. The highlighted row scrolls into view. The box is `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-autocomplete="list"`, `aria-activedescendant`.
- [ ] **Step 4: Usage line.** `commandHint(draft)`, when not null and the menu is closed, is one 12px line above the form: `/name args` in cream, ` — about` in dim.
- [ ] **Step 5: Placeholders**: `Message #x, or / for commands`; Status `Type / for commands`.
- [ ] **Step 6:** typecheck, test. **Commit** `feat: typing a slash lists the commands, and each channel keeps its draft`

---

### Task 7: The log draws folds and the New divider

**Files:**
- Modify: `src/renderer/tools/Chat.tsx` (the log's body)

- [ ] **Step 1:** The log renders `foldLog(view.lines, view.newFrom)`. A `line` item is `<Line>`; a `fold` is a row with the first line's time and a `button` (`aria-expanded`, faint, hover cream) reading the summary, with its lines as `<Line>`s under it when open. `open: Set<number>` of fold keys is `Conversation` state, cleared when `view.active` changes.
- [ ] **Step 2:** Before the item holding `view.newFrom` (a line with that id, or a fold whose first line has it), unless it is the first item, a divider: a gold rule with "New" in gold 12px text, `role="separator"`, `aria-label="New since you were last here"`.
- [ ] **Step 3:** typecheck, test. **Commit** `feat: the log folds churn and marks what is new`

---

### Task 8: Settings' intro, and the docs

**Files:**
- Modify: `src/renderer/tools/ChatSettings.tsx:158-163`
- Modify: `README.md` (the Chat section), `CLAUDE.md` (Typed commands)

- [ ] **Step 1:** Remove the `needsNick` paragraph. Fix the comment in `Chat.tsx`'s `Status` if it leaned on it.
- [ ] **Step 2:** README: the topic now lives in the info view, the list's header facts too, the People and ⓘ buttons, the gear, the command menu, drafts per channel, the New divider, mention-gold counts and the fold. CLAUDE.md's Typed commands: `COMMAND_HELP` is the table `/help` and the menu read, and `bare` is held to `parseInput` by a test.
- [ ] **Step 3: Commit** `docs: chat's room, its menu and its folds`

---

### Task 9: Verify

- [ ] `npm test`, `npm run typecheck`.
- [ ] Render the conversation against a stubbed `ChatView` (a throwaway page in the scratchpad, never committed): wide and narrow, info view, list hidden, the menu open on `/`, the usage line, a fold open and closed, the divider, gold and cream counts. Open every screenshot.
- [ ] `caffeinate -d npm run capture`; open the chat Settings shots.
- [ ] An independent review of the branch's diff against the spec.
