import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, statSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  enforceSecurePermissions,
  secureCreateDir,
  enforceProfilePermissions,
  buildRemotePermissionCommand,
} from './secure-permissions';

const TEST_DIR = join(tmpdir(), `secure-perms-test-${process.pid}`);

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true, mode: 0o755 });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('enforceSecurePermissions', () => {
  it('sets directory to 0700', () => {
    const dir = join(TEST_DIR, 'subdir');
    mkdirSync(dir, { mode: 0o755 });

    enforceSecurePermissions(dir);

    const mode = statSync(dir).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it('sets files to 0600', () => {
    const file = join(TEST_DIR, 'secret.json');
    writeFileSync(file, '{}', { mode: 0o644 });

    enforceSecurePermissions(TEST_DIR);

    const mode = statSync(file).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('recursively secures nested directories and files', () => {
    const nested = join(TEST_DIR, 'a', 'b');
    mkdirSync(nested, { recursive: true, mode: 0o755 });
    writeFileSync(join(nested, 'cred.key'), 'secret', { mode: 0o644 });
    writeFileSync(join(TEST_DIR, 'a', 'config.json'), '{}', { mode: 0o644 });

    enforceSecurePermissions(TEST_DIR);

    expect(statSync(join(TEST_DIR, 'a')).mode & 0o777).toBe(0o700);
    expect(statSync(nested).mode & 0o777).toBe(0o700);
    expect(statSync(join(nested, 'cred.key')).mode & 0o777).toBe(0o600);
    expect(statSync(join(TEST_DIR, 'a', 'config.json')).mode & 0o777).toBe(0o600);
  });

  it('is a no-op for non-existent paths', () => {
    expect(() => enforceSecurePermissions('/tmp/does-not-exist-xyz')).not.toThrow();
  });
});

describe('secureCreateDir', () => {
  it('creates directory with 0700 permissions', () => {
    const dir = join(TEST_DIR, 'new-dir');
    secureCreateDir(dir);

    expect(existsSync(dir)).toBe(true);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it('fixes permissions on existing directory', () => {
    const dir = join(TEST_DIR, 'existing');
    mkdirSync(dir, { mode: 0o755 });

    secureCreateDir(dir);

    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });
});

describe('enforceProfilePermissions', () => {
  it('secures all files and directories in profile root', () => {
    const agentsDir = join(TEST_DIR, 'agents');
    mkdirSync(agentsDir, { mode: 0o755 });
    writeFileSync(join(TEST_DIR, 'minion.json'), '{}', { mode: 0o644 });
    writeFileSync(join(agentsDir, 'config.json'), '{}', { mode: 0o644 });

    enforceProfilePermissions(TEST_DIR);

    expect(statSync(TEST_DIR).mode & 0o777).toBe(0o700);
    expect(statSync(agentsDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(TEST_DIR, 'minion.json')).mode & 0o777).toBe(0o600);
    expect(statSync(join(agentsDir, 'config.json')).mode & 0o777).toBe(0o600);
  });

  it('is a no-op for non-existent paths', () => {
    expect(() => enforceProfilePermissions('/tmp/does-not-exist-xyz')).not.toThrow();
  });
});

describe('buildRemotePermissionCommand', () => {
  it('generates find+chmod commands for the correct user home', () => {
    const cmd = buildRemotePermissionCommand('minion');
    expect(cmd).toContain('/home/minion/.minion');
    expect(cmd).toContain('chmod 700');
    expect(cmd).toContain('chmod 600');
    expect(cmd).toContain('-type d');
    expect(cmd).toContain('-type f');
  });

  it('uses correct path for custom user names', () => {
    const cmd = buildRemotePermissionCommand('minion-my-agent');
    expect(cmd).toContain('/home/minion-my-agent/.minion');
  });
});
