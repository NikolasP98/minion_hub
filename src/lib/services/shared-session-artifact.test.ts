import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { GatewayClient, GatewayError, canRetry } from '@minion-stack/shared/gateway';

// Bun's file lock records a path, not content integrity. Check the vendored bytes
// and consumed runtime/declarations so CI cannot qualify a stale local install.
describe('reviewed shared Gateway artifact', () => {
  const receipt = JSON.parse(readFileSync('deps/shared-error-provenance.json', 'utf8'));
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const artifact = 'deps/' + receipt.artifact;
  it('pins the reviewed content and package path', () => {
    expect(createHash('sha256').update(readFileSync(artifact)).digest('hex')).toBe(receipt.sha256);
    expect(receipt.sha256).toBe('994ac7f5d0b655e8b4eba7c89c86354e7f4c399ba5ed46987f71ab853dd74ef2');
    expect(manifest.dependencies['@minion-stack/shared']).toBe('file:' + artifact);
  });
  it('uses the installed public error model for request recovery', async () => {
    const client = new GatewayClient({
      url: 'ws://fixture.invalid',
      onChallenge: async () => ({}),
    });
    const error = await client.request('write').catch((value: unknown) => value);
    expect(error).toBeInstanceOf(GatewayError);
    expect(error).toMatchObject({ source: 'client', code: 'NOT_CONNECTED', dispatch: 'not-sent' });
    expect(
      canRetry(GatewayError.client('SEND_FAILED', 'opaque failure'), { idempotent: false }),
    ).toBe(false);
    expect(
      GatewayError.fromServer({ code: 'CONFLICT', message: 'opaque server text' }),
    ).toMatchObject({ source: 'server', code: 'CONFLICT', dispatch: 'responded' });
  });
  it('consumes the exact verified runtime and declaration bytes', () => {
    for (const name of [
      'package.json',
      'dist/gateway/client.js',
      'dist/gateway/client.d.ts',
      'dist/gateway/protocol.js',
      'dist/gateway/protocol.d.ts',
      'dist/gateway/errors.js',
      'dist/gateway/errors.d.ts',
      'dist/gateway/index.js',
      'dist/gateway/index.d.ts',
    ]) {
      const packed = execFileSync('tar', ['-xOzf', artifact, 'package/' + name]);
      const installed = readFileSync('node_modules/@minion-stack/shared/' + name);
      expect(installed.equals(packed), name).toBe(true);
    }
  });
});
