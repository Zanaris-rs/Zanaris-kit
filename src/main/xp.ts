import { SKILLS } from '../shared/proto/rev289.gen';
import type { SkillRow } from '../shared/ipc';

/**
 * XP gained per skill this session.
 *
 * The server sends UPDATE_STAT for every skill at login, which sets the
 * baseline; everything after that is a gain. Deliberately no rates and no
 * timing — just totals.
 */
export class XpTracker {
    private readonly baseline = new Map<number, number>();
    private readonly current = new Map<number, { xp: number; level: number }>();

    update(skill: number, xp: number, level: number): void {
        if (!this.baseline.has(skill)) this.baseline.set(skill, xp);
        this.current.set(skill, { xp, level });
    }

    reset(): void {
        this.baseline.clear();
        this.current.clear();
    }

    rows(): SkillRow[] {
        const rows: SkillRow[] = [];
        for (let id = 0; id < SKILLS.length; id++) {
            const name = SKILLS[id]!;
            if (name === '-unused-') continue;
            const now = this.current.get(id);
            rows.push({
                id,
                name,
                xp: now?.xp ?? 0,
                level: now?.level ?? 0,
                gained: now ? now.xp - (this.baseline.get(id) ?? now.xp) : 0,
                seen: now !== undefined
            });
        }
        return rows;
    }

    totalGained(): number {
        let total = 0;
        for (const [id, base] of this.baseline) {
            total += (this.current.get(id)?.xp ?? base) - base;
        }
        return total;
    }
}
