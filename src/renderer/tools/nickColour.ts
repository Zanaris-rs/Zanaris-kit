/**
 * Nick colours, so a conversation can be followed by shape instead of by
 * reading every name. The palette is the era's chat set — pale blue, pink,
 * tan, green, purple, cyan — and a nick is hashed into it rather than dealt
 * one on arrival, so a person keeps their colour across restarts, looks the
 * same in every window, and is the same colour in the user list as in the log.
 * Your own nick is gold instead: the one voice you always want to find.
 */
const NICK_COLOURS = ['#9db8c3', '#faa8aa', '#c8a86a', '#90c040', '#c503fd', '#6fc9d8'];

export function nickColour(nick: string, self: string | null): string {
    /* IRC nicks are case-insensitive, so Kev and kev are one person and one colour. */
    const name = nick.toLowerCase();
    if (self !== null && name === self.toLowerCase()) return 'var(--color-gold)';
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return NICK_COLOURS[hash % NICK_COLOURS.length] ?? '#9db8c3';
}
