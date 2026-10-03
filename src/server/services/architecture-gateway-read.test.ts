import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const mocks = vi.hoisted(() => ({ begin: vi.fn(), transaction: vi.fn(), unsafe: vi.fn() }));

vi.mock('$server/db/pg-pool', () => ({ getPgClient: () => ({ begin: mocks.begin }) }));

import { ARCHITECTURE_GATEWAY_QUERY, listArchitectureGateways } from './architecture-gateway-read';

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks.transaction, { unsafe: mocks.unsafe });
  mocks.begin.mockImplementation(async (mode: string, work: (tx: unknown) => unknown) => {
    expect(mode).toBe('read only');
    return work(mocks.transaction);
  });
});

describe('bounded architecture gateway projection', () => {
  it('reads the legacy heartbeat bridge and connection time under a statement budget', async () => {
    mocks.transaction.mockResolvedValueOnce([]);
    mocks.unsafe.mockResolvedValueOnce([
      {
        id: 'gateway-id',
        name: 'gateway-default',
        url: 'wss://gateway.test',
        legacyServerId: 'legacy-id',
        lastConnectedAt: new Date('2026-10-03T10:00:00Z'),
        fieldOverflow: false,
      },
    ]);

    await expect(
      listArchitectureGateways(
        '00000000-0000-0000-0000-000000000001',
        new AbortController().signal,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'gateway-id',
        legacyServerId: 'legacy-id',
        lastConnectedAt: new Date('2026-10-03T10:00:00Z'),
      }),
    ]);

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.unsafe).toHaveBeenCalledOnce();
    expect(String(mocks.transaction.mock.calls[0]?.[0])).toContain('statement_timeout');
    expect(mocks.unsafe).toHaveBeenCalledWith(ARCHITECTURE_GATEWAY_QUERY, [
      '00000000-0000-0000-0000-000000000001',
    ]);
  });

  it('does not open a database snapshot after owner cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      listArchitectureGateways('00000000-0000-0000-0000-000000000001', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.begin).not.toHaveBeenCalled();
  });

  it('rejects a field that SQL marked oversized before mapping it', async () => {
    mocks.transaction.mockResolvedValueOnce([]);
    mocks.unsafe.mockResolvedValueOnce([
      {
        id: 'gateway-id',
        name: null,
        url: 'wss://gateway.test',
        legacyServerId: null,
        lastConnectedAt: null,
        fieldOverflow: true,
      },
    ]);
    await expect(
      listArchitectureGateways(
        '00000000-0000-0000-0000-000000000001',
        new AbortController().signal,
      ),
    ).rejects.toThrow(/exceeds/);
  });

  it('uses SQL-side octet bounds so a large text field is never projected', async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        create table public.gateway (
          id uuid primary key,
          org_id uuid not null,
          name text not null,
          url text not null,
          legacy_server_id text,
          last_connected_at timestamptz,
          created_at timestamptz not null default now()
        );
      `);
      const orgId = '00000000-0000-0000-0000-000000000001';
      await db.query(
        `insert into public.gateway(id,org_id,name,url,legacy_server_id)
         values($1,$2,$3,$4,$5)`,
        [
          '00000000-0000-0000-0000-000000000002',
          orgId,
          'x'.repeat(20_000),
          'wss://gateway.test',
          'legacy',
        ],
      );

      const result = await db.query<{
        name: string | null;
        fieldOverflow: boolean;
      }>(ARCHITECTURE_GATEWAY_QUERY, [orgId]);
      expect(result.rows).toEqual([expect.objectContaining({ name: null, fieldOverflow: true })]);
      expect(JSON.stringify(result.rows)).not.toContain('x'.repeat(513));
    } finally {
      await db.close();
    }
  });
});
