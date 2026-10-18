import type { MouseEvent } from 'react';

/**
 * Opens the menu for someone's name. main draws it, natively, since anything
 * the shell drew could land under the game beside the pane; a mention comes
 * back to be put in the message box, which only the shell has. What main
 * does itself — a whois, a conversation — it does as though typed in the
 * pane the menu was raised from, so a whois answer lands in that pane's room.
 *
 * A click opens it at the pointer. A key press has no pointer, so it opens
 * under the name instead.
 */
export function openUserMenu(paneId: string, nick: string, event: MouseEvent<HTMLElement>, mention: (nick: string) => void): void {
    const box = event.currentTarget.getBoundingClientRect();
    const byKey = event.detail === 0;
    void window.zanaris.chat.userMenu(paneId, nick, byKey ? box.left : event.clientX, byKey ? box.bottom : event.clientY).then(choice => {
        if (choice === 'mention') mention(nick);
    });
}
