import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('backup scheduler lifecycle', () => {
  it('does not start a process timer from the SvelteKit request module', () => {
    const hooks = readFileSync('src/hooks.server.ts', 'utf8');
    const scheduler = readFileSync('src/server/services/backup-scheduler.ts', 'utf8');

    expect(hooks).not.toContain('startBackupScheduler');
    expect(scheduler).toContain('export function startBackupScheduler()');
  });
});
