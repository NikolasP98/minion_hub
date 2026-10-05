import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// Bun's file lock records a path, not content integrity. Check the vendored bytes
// and consumed runtime/declarations so CI cannot qualify a stale local install.
describe('reviewed shared-session artifact', () => {
  const baselineReceipt = JSON.parse(readFileSync('deps/shared-session-provenance.json', 'utf8'));
  const receiptBytes = readFileSync('deps/shared-error-provenance.json');
  const receipt = JSON.parse(receiptBytes.toString('utf8'));
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const lock = readFileSync('bun.lock', 'utf8');
  const artifact = 'deps/' + receipt.artifact;
  const archiveEntries = new Set(
    execFileSync('tar', ['-tzf', artifact], { encoding: 'utf8' }).trim().split('\n'),
  );

  function packedBytes(name: string): Buffer {
    return execFileSync('tar', ['-xOzf', artifact, 'package/' + name]);
  }

  function installedMatches(
    name: string,
    bytes = readFileSync('node_modules/@minion-stack/shared/' + name),
  ) {
    return bytes.equals(packedBytes(name));
  }

  it('pins the reviewed content and package path', () => {
    expect(createHash('sha256').update(receiptBytes).digest('hex')).toBe(
      '7c7e8117068786af51e3e39cae4c9ea99a89d40748b0661bb90c7ff531b623de',
    );
    expect(createHash('sha256').update(readFileSync(artifact)).digest('hex')).toBe(receipt.sha256);
    expect(receipt.sha256).toBe('994ac7f5d0b655e8b4eba7c89c86354e7f4c399ba5ed46987f71ab853dd74ef2');
    expect(receipt.baselineSha256).toBe(baselineReceipt.sha256);
    expect(
      createHash('sha256')
        .update(readFileSync('deps/' + baselineReceipt.artifact))
        .digest('hex'),
    ).toBe(receipt.baselineSha256);
    expect(manifest.dependencies['@minion-stack/shared']).toBe('file:' + artifact);
    expect(lock).toContain(`"@minion-stack/shared": "file:${artifact}"`);
    expect(lock).toContain(`"@minion-stack/shared@${artifact}"`);
    expect(lock).not.toContain(
      '@minion-stack/shared@deps/minion-stack-shared-0.9.1-readiness.1.tgz',
    );
  });

  it('consumes the exact verified runtime and declaration bytes', () => {
    for (const name of receipt.overlayFiles as string[]) {
      expect(installedMatches(name), name).toBe(true);
    }
    for (const name of receipt.removedFiles as string[]) {
      expect(archiveEntries.has('package/' + name), name).toBe(false);
      expect(() => readFileSync('node_modules/@minion-stack/shared/' + name), name).toThrow();
    }
  });

  it('detects a one-byte mutation of an installed reviewed file', () => {
    const name = 'dist/gateway/client.js';
    const mutated = Buffer.from(readFileSync('node_modules/@minion-stack/shared/' + name));
    mutated[Math.floor(mutated.length / 2)] ^= 1;
    expect(installedMatches(name)).toBe(true);
    expect(installedMatches(name, mutated)).toBe(false);
  });
});
