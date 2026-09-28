import type { ChatLine, Presence } from './chat.ts';

/**
 * The log as the chat pane draws it. Pure, so the folding is tested here and
 * the shell only draws the items it is given.
 */

/** One thing the log draws: a line, or a run of churn folded into one. */
export type LogItem =
    | { kind: 'line'; line: ChatLine }
    | {
          kind: 'fold';
          /** The run's first line's id, which stays put as the run grows, so a fold opened stays open. */
          key: number;
          lines: ChatLine[];
          /** What the run was, counted: "3 joined, 2 left". */
          summary: string;
      };

/**
 * Every run of two or more churn lines folded into one item. A busy channel
 * is mostly people coming and going, and a log of that is a log in which the
 * talk is hard to find. A single one stays a line, since folding it would say
 * the same thing less plainly. A run breaks at `newFrom`, so the New divider
 * always has a boundary between two items to sit on.
 */
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

/** How a fold counts, in order. A part and a quit are both someone gone, and which it was is in the lines. */
const COUNTED: [readonly Presence[], string][] = [
    [['join'], 'joined'],
    [['part', 'quit'], 'left'],
    [['nick'], 'renamed']
];

function summary(run: readonly ChatLine[]): string {
    return COUNTED.map(([kinds, word]): [number, string] => [run.filter(l => l.presence !== undefined && kinds.includes(l.presence)).length, word])
        .filter(([n]) => n > 0)
        .map(([n, word]) => `${n} ${word}`)
        .join(', ');
}
