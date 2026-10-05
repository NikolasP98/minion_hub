import { describe, expect, it, vi } from 'vitest';
import { readCredentialHealthSnapshots } from './reliability-credential-read';
import { readReliabilityInsights } from './reliability-insights-read';
import { RELIABILITY_RESPONSE_MAX_BYTES } from './reliability-read-response';

function txWith(rows: unknown[][]) {
  const execute = vi.fn(async () => ({ rows: rows.shift() ?? [] }));
  return { tx: { execute } as never, execute };
}

const event = {
  event: 'tool.completed',
  category: 'tool',
  severity: 'info',
  message: 'Completed',
  occurredAt: 100,
  agentId: null,
  metadata: null,
};

describe('bounded reliability materialization', () => {
  it('computes every insight projection from three relations in one owned transaction', async () => {
    const { tx, execute } = txWith([
      [{ id: 'legacy', tenantId: 'org' }],
      [event, { ...event, event: 'tool.failed', severity: 'high', message: 'Failed' }],
      [{ ...event, event: 'tool.failed', severity: 'high', message: 'Failed', occurredAt: 50 }],
      [{ ...event, occurredAt: 100 }],
    ]);
    const result = await readReliabilityInsights(tx, 'legacy', { from: 0, to: 100 });
    expect(execute).toHaveBeenCalledTimes(4);
    expect(result.signalToNoise).toEqual({ total: 2, signal: 1, noise: 1, noisePct: 0.5 });
    expect(result.topClusters[0]).toMatchObject({ event: 'tool.failed', n: 1, prevN: 1 });
  });

  it('rejects a cap-plus-one insight relation before aggregate publication', async () => {
    const { tx, execute } = txWith([
      [{ id: 'legacy', tenantId: 'org' }],
      Array.from({ length: 100_001 }, () => event),
    ]);
    await expect(readReliabilityInsights(tx, 'legacy', { from: 0, to: 100 })).rejects.toThrow(
      /cap/,
    );
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('checks credential blob bytes before selecting snapshot contents', async () => {
    const { tx, execute } = txWith([
      [{ id: 'legacy', tenantId: 'org' }],
      [{ id: 1, bytes: RELIABILITY_RESPONSE_MAX_BYTES + 1 }],
    ]);
    await expect(
      readCredentialHealthSnapshots(tx, 'legacy', {
        serverId: 'legacy',
        from: 0,
        to: 100,
        limit: 1,
      }),
    ).rejects.toThrow(/cap/);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('binds selected credential rows to the exact telemetry scope', async () => {
    const { tx, execute } = txWith([
      [{ id: 'legacy', tenantId: 'org' }],
      [{ id: 1, bytes: 10 }],
      [
        {
          id: 1,
          serverId: 'legacy',
          snapshotJson: '{"providers":[]}',
          capturedAt: 100,
          createdAt: 101,
        },
      ],
    ]);
    await expect(
      readCredentialHealthSnapshots(tx, 'legacy', {
        serverId: 'legacy',
        from: 0,
        to: 100,
        limit: 1,
      }),
    ).resolves.toEqual([
      {
        id: 1,
        tenantId: 'org',
        serverId: 'legacy',
        snapshotJson: '{"providers":[]}',
        capturedAt: 100,
        createdAt: 101,
      },
    ]);
    expect(execute).toHaveBeenCalledTimes(3);
  });
});
