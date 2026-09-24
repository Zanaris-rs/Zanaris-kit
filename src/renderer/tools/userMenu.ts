import type { MouseEvent } from 'react';

/**
 * Opens the menu for someone's name. main draws it, natively, since anything
 * the shell drew could land under the game beside the pane; a mention comes
 * back to be put in the message box, which only the shell has.
 *
 * A click opens it at the pointer. A key press has no pointer, so it opens
 * under the name instead.
 */
export function openUserMenu(nick: string, event: MouseEvent<HTMLElement>, mention: (nick: string) => void): void {
    const box = event.currentTarget.getBoundingClientRect();
    const byKey = event.detail === 0;
    void window.zanaris.chat.userMenu(nick, byKey ? box.left : event.clientX, byKey ? box.bottom : event.clientY).then(choice => {
        if (choice === 'mention') mention(nick);
    });
}
