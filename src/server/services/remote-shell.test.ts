import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  assertPort,
  assertSnapshotPath,
  assertSshHost,
  assertUnixUser,
  shQuote,
} from './remote-shell';

describe('shQuote', () => {
  it('round-trips hostile strings through a real shell as one literal word', () => {
    const hostile = [
      `a b`,
      `'; touch /tmp/pwned; '`,
      '$(touch /tmp/pwned)',
      '`touch /tmp/pwned`',
      `x' && echo injected && echo '`,
      'new\nline',
      '',
    ];
    for (const value of hostile) {
      const out = spawnSync('sh', ['-c', `printf %s ${shQuote(value)}`], { encoding: 'utf8' });
      expect(out.stdout).toBe(value);
    }
  });

  it('refuses NUL', () => {
    expect(() => shQuote('a\0b')).toThrow();
  });
});

describe('assertSnapshotPath', () => {
  const base = '/mnt/agent-data/backups';
  const ok = `${base}/clinic-gateway/2026-11-04T07-00-00-000Z`;

  it('accepts a recorded-shape path, including spaces and non-ASCII names', () => {
    expect(assertSnapshotPath(ok, base)).toBe(ok);
    expect(assertSnapshotPath(`${base}/José Gateway/2026-11-04`, `${base}/`)).toContain('José');
  });

  it.each([
    ['command substitution', `${base}/x/$(id)`],
    ['backticks', `${base}/x/\`id\``],
    ['semicolon', `${base}/x; id`],
    ['quote', `${base}/x'y`],
    ['double quote', `${base}/x"y`],
    ['newline', `${base}/x\nid`],
    ['pipe', `${base}/x|id`],
    ['glob', `${base}/*`],
    ['parent traversal', `${base}/../../etc`],
    ['outside base', '/etc/passwd'],
    ['prefix-only match', `${base}-evil/x`],
    ['relative', 'backups/x'],
    ['empty', ''],
  ])('rejects %s', (_label, path) => {
    expect(() => assertSnapshotPath(path, base)).toThrow();
  });
});

describe('ssh target validators', () => {
  it('accepts normal values and rejects option/shell injection', () => {
    expect(assertUnixUser('minion-clinic')).toBe('minion-clinic');
    expect(assertSshHost('backup.example.com')).toBe('backup.example.com');
    expect(assertPort(2222)).toBe(2222);

    expect(() => assertUnixUser('x"; id; "')).toThrow();
    expect(() => assertUnixUser('')).toThrow();
    expect(() => assertSshHost('-oProxyCommand=id')).toThrow();
    expect(() => assertSshHost('host;id')).toThrow();
    expect(() => assertPort(0)).toThrow();
    expect(() => assertPort(22.5)).toThrow();
    expect(() => assertPort(70000)).toThrow();
  });
});
