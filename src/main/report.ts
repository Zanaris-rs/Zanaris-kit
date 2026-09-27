import { REPO_URL } from './branding.ts';

/** What a report says about where it came from. Nothing about the player: the kit's version, Electron's, and the OS. */
export interface ReportEnv {
    version: string;
    electron: string;
    platform: string;
    arch: string;
    /** `process.getSystemVersion()`: 26.0.1 on macOS, 10.0.26100 on Windows, the kernel on Linux. */
    osVersion: string;
}

const OS_NAMES: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };

/**
 * Help > Report a Problem…: a new issue on the kit's repository, its body
 * started with three headings to answer and, under a rule, the version and
 * system it came from. The line under the rule is the half a report is most
 * often missing and the half the player least often knows, which is why the
 * kit writes it rather than asking.
 *
 * Nothing of the player's goes in it — no server, no nick, no path — and it
 * goes nowhere until they press Submit on GitHub, in their own browser.
 */
export function reportUrl(env: ReportEnv): string {
    const os = `${OS_NAMES[env.platform] ?? env.platform} ${env.osVersion}`.trim();
    const body = [
        '**What happened**',
        '',
        '',
        '**What you expected**',
        '',
        '',
        '**Steps to get there**',
        '',
        '',
        '---',
        `Zanaris Kit ${env.version} · Electron ${env.electron} · ${os} (${env.arch})`
    ].join('\n');
    return `${REPO_URL}/issues/new?body=${encodeURIComponent(body)}`;
}
