import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// Bun's file lock records a path, not content integrity. Check the vendored bytes
// and consumed runtime/declarations so CI cannot qualify a stale local install.
describe('reviewed shared-session artifact', () => {
  const receipt = JSON.parse(readFileSync('deps/shared-session-provenance.json', 'utf8'));
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const artifact = 'deps/' + receipt.artifact;
  it('pins the reviewed content and package path', () => {
    expect(createHash('sha256').update(readFileSync(artifact)).digest('hex')).toBe(receipt.sha256);
    expect(receipt.sha256).toBe('caf243eafb15942a32be62652d12e0fc1a1fb2cc3141cdd7bd7075f60bd19fdc');
    expect(manifest.dependencies['@minion-stack/shared']).toBe('file:' + artifact);
  });
  it('consumes the exact verified runtime and declaration bytes', () => {
    for (const name of ['package.json', 'dist/gateway/client.js', 'dist/gateway/client.d.ts']) {
      const packed = execFileSync('tar', ['-xOzf', artifact, 'package/' + name]);
      const installed = readFileSync('node_modules/@minion-stack/shared/' + name);
      expect(installed.equals(packed), name).toBe(true);
    }
  });
});
