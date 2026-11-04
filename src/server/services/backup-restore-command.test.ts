import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { buildRestoreCommand, type RestoreCommandInput } from './backup-restore-command';

const base = '/mnt/agent-data/backups';
const input: RestoreCommandInput = {
  minionUser: 'minion-clinic',
  backupUser: 'backup',
  backupHost: 'backup.example.com',
  backupPort: 2222,
  basePath: base,
  snapshotPath: `${base}/clinic gateway/2026-11-04T07-00-00-000Z`,
};

/** Runs the command under sh with stub binaries that record their argv, one arg per line. */
function runWithStubs(command: string) {
  const dir = mkdtempSync(join(tmpdir(), 'restore-cmd-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const log = join(dir, 'calls.log');
  for (const name of ['rsync', 'find', 'sudo', 'id']) {
    writeFileSync(
      join(bin, name),
      `#!/bin/sh\nprintf '%s\\n' "${name}" >> "${log}"\nfor a in "$@"; do printf '  arg:%s\\n' "$a" >> "${log}"; done\n`,
    );
    chmodSync(join(bin, name), 0o755);
  }
  const res = spawnSync('sh', ['-c', command], {
    env: { PATH: `${bin}:/usr/bin:/bin` },
    encoding: 'utf8',
  });
  return { status: res.status, calls: existsSync(log) ? readFileSync(log, 'utf8') : '' };
}

describe('buildRestoreCommand', () => {
  it('passes the snapshot path to rsync as one intact argument', () => {
    const { status, calls } = runWithStubs(buildRestoreCommand(input));
    expect(status).toBe(0);
    expect(calls).toContain('arg:-s');
    expect(calls).toContain(`arg:backup@backup.example.com:${input.snapshotPath}/`);
    expect(calls).toContain('arg:ssh -p 2222');
    expect(calls).toContain('arg:/home/minion-clinic/.minion/');
  });

  it.each([
    ['command substitution', `${base}/x/$(touch PWNED)`],
    ['semicolon chain', `${base}/x; touch PWNED`],
    ['quote breakout', `${base}/x' ; touch PWNED ; '`],
    ['newline', `${base}/x\ntouch PWNED`],
    ['traversal', `${base}/../../etc`],
    ['outside base', '/etc'],
  ])('refuses a hostile snapshot path (%s) before building any command', (_l, snapshotPath) => {
    expect(() => buildRestoreCommand({ ...input, snapshotPath })).toThrow();
  });

  it.each([
    ['minionUser', { minionUser: 'x"; touch PWNED; "' }],
    ['backupUser', { backupUser: 'a b' }],
    ['backupHost', { backupHost: '-oProxyCommand=touch PWNED' }],
    ['backupPort', { backupPort: Number.NaN }],
  ])('refuses a hostile %s', (_l, patch) => {
    expect(() => buildRestoreCommand({ ...input, ...patch })).toThrow();
  });
});
