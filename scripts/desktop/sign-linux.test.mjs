import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('real detached signatures verify; tampered payload and wrong key identity fail', () => {
  const root = mkdtempSync(join(tmpdir(), 'desktop-signing-'));
  const keyring = join(root, 'keyring');
  const out = join(root, 'release');
  mkdirSync(keyring, { mode: 0o700 });
  mkdirSync(out);
  const env = { ...process.env, GNUPGHOME: keyring };
  const gpg = (...args) => {
    const result = spawnSync('gpg', args, { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  try {
    gpg(
      '--batch',
      '--pinentry-mode',
      'loopback',
      '--passphrase',
      'fixture-only',
      '--quick-generate-key',
      'Release Fixture <fixture@example.invalid>',
      'ed25519',
      'sign',
      '1d',
    );
    const fingerprint = gpg('--with-colons', '--list-secret-keys')
      .split('\n')
      .find((line) => line.startsWith('fpr:'))
      .split(':')[9];
    const key = gpg(
      '--batch',
      '--pinentry-mode',
      'loopback',
      '--passphrase',
      'fixture-only',
      '--armor',
      '--export-secret-keys',
      fingerprint,
    );
    const sum = createHash('sha256').update('test payload').digest('hex');
    for (const name of ['test.deb', 'test.AppImage'])
      writeFileSync(join(out, name), 'test payload');
    writeFileSync(join(out, 'SHA256SUMS'), `${sum}  test.deb\n${sum}  test.AppImage\n`);
    const signingEnv = {
      ...process.env,
      DESKTOP_OUTPUT: out,
      DESKTOP_GPG_PRIVATE_KEY: key,
      DESKTOP_GPG_PASSPHRASE: 'fixture-only',
      DESKTOP_GPG_FINGERPRINT: fingerprint,
    };
    const result = spawnSync('bash', ['scripts/desktop/sign-linux.sh'], {
      env: signingEnv,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    gpg('--verify', join(out, 'test.deb.asc'), join(out, 'test.deb'));
    writeFileSync(join(out, 'test.deb'), 'tampered');
    assert.notEqual(
      spawnSync('gpg', ['--verify', join(out, 'test.deb.asc'), join(out, 'test.deb')], { env })
        .status,
      0,
    );
    const wrongKey = spawnSync('bash', ['scripts/desktop/sign-linux.sh'], {
      env: { ...signingEnv, DESKTOP_GPG_FINGERPRINT: 'A'.repeat(40) },
      encoding: 'utf8',
    });
    assert.notEqual(wrongKey.status, 0);
    assert.match(wrongKey.stdout, /Unexpected release signing key/);
  } finally {
    spawnSync('gpgconf', ['--kill', 'gpg-agent'], { env });
    rmSync(root, { recursive: true, force: true });
  }
});
