import type { TabKind } from '../shared/layout.ts';

export interface Tab {
    id: string;
    kind: TabKind;
    title: string;
    url: string;
}

export const GAME_TAB_ID = 'game';

/**
 * The tab strip's model. The game tab is created with the window, sits first,
 * and cannot be closed or moved. Page tabs come after it. Closing the active
 * tab activates the one to its left, which is always there because the game
 * tab is.
 */
export class TabModel {
    private readonly tabs: Tab[];
    private activeId: string = GAME_TAB_ID;
    private nextPage = 1;

    constructor(game: { title: string; url: string }) {
        this.tabs = [{ id: GAME_TAB_ID, kind: 'game', title: game.title, url: game.url }];
    }

    list(): Tab[] {
        return this.tabs.map(t => ({ ...t }));
    }

    get active(): Tab {
        const tab = this.tabs.find(t => t.id === this.activeId) ?? this.tabs[0]!;
        return { ...tab };
    }

    open(page: { title: string; url: string }): Tab {
        const tab: Tab = { id: `page-${this.nextPage++}`, kind: 'page', title: page.title, url: page.url };
        this.tabs.push(tab);
        this.activeId = tab.id;
        return { ...tab };
    }

    activate(id: string): boolean {
        if (!this.tabs.some(t => t.id === id)) return false;
        this.activeId = id;
        return true;
    }

    close(id: string): 'closed' | 'pinned' | 'unknown' {
        if (id === GAME_TAB_ID) return 'pinned';
        const index = this.tabs.findIndex(t => t.id === id);
        if (index < 0) return 'unknown';
        this.tabs.splice(index, 1);
        if (this.activeId === id) this.activeId = this.tabs[index - 1]!.id;
        return 'closed';
    }

    setTitle(id: string, title: string): boolean {
        const tab = this.tabs.find(t => t.id === id);
        if (!tab) return false;
        tab.title = title;
        return true;
    }
}
