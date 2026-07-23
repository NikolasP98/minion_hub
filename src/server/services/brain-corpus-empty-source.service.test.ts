import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const execute = vi.fn();
const withOrgCore = vi.fn(
  async (_ctx: unknown, operation: (tx: { execute: typeof execute }) => Promise<unknown>) =>
    operation({ execute }),
);

vi.mock('$server/db/with-org-core', () => ({ withOrgCore }));

const { eligibleWhatsAppMessagePredicate, markVerifiedEmptyWhatsAppSourcesReady } =
  await import('./brain-corpus.service');

beforeEach(() => {
  vi.clearAllMocks();
  execute.mockResolvedValue([{ id: 'source-1' }]);
});

describe('verified-empty WhatsApp source reconciliation', () => {
  it('records a successful empty sync without overwriting real failure states', async () => {
    await expect(
      markVerifiedEmptyWhatsAppSourcesReady({ tenantId: 'org-1' } as never),
    ).resolves.toBe(1);

    expect(withOrgCore).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    expect(query.sql).toContain("set status = 'ready', last_synced_at = now()");
    expect(query.sql).toContain('source.status = any');
    expect(query.sql).toContain('not exists');
    expect(query.sql).toContain("document.status <> 'deleted'");
    expect(query.params).toEqual(expect.arrayContaining(['whatsapp', 'discovered', 'queued']));
    for (const preserved of ['processing', 'degraded', 'failed']) {
      expect(query.params).not.toContain(preserved);
    }
  });

  it('shares one eligibility predicate across discovery and empty-source verification', () => {
    const query = new PgDialect().sqlToQuery(eligibleWhatsAppMessagePredicate('message'));
    expect(query.sql).toContain('nullif(trim("message".chat_id), \'\') is not null');
    expect(query.sql).toContain('coalesce("message".is_group, false) = false');
    expect(query.sql).toContain('"message".is_bot is not true');
    expect(query.sql).toContain('nullif(trim("message".content), \'\') is not null');
  });
});
