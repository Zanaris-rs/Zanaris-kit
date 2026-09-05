/**
 * Concurrent instances of one server are numbered from 1. The number picks the
 * storage partition, so two accounts on one server never share cookies or
 * client prefs, and it is reused once a window closes so partitions (and their
 * asset caches) are not created without bound.
 */
export class SlotAllocator {
    private readonly used = new Map<string, Set<number>>();

    acquire(serverId: string): number {
        const set = this.used.get(serverId) ?? new Set<number>();
        let slot = 1;
        while (set.has(slot)) slot += 1;
        set.add(slot);
        this.used.set(serverId, set);
        return slot;
    }

    release(serverId: string, slot: number): void {
        const set = this.used.get(serverId);
        if (!set) return;
        set.delete(slot);
        if (set.size === 0) this.used.delete(serverId);
    }

    count(serverId: string): number {
        return this.used.get(serverId)?.size ?? 0;
    }
}

/** Slot 1 keeps the name the launcher-only build used, so existing caches carry over. */
export function partitionFor(serverId: string, slot: number): string {
    const safe = serverId.replace(/[^a-z0-9._-]+/gi, '-');
    return slot === 1 ? `persist:server:${safe}` : `persist:server:${safe}:${slot}`;
}

export function windowTitle(name: string, slot: number): string {
    return slot === 1 ? name : `${name} (${slot})`;
}
