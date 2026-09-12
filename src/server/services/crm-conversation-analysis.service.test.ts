import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));

// conversationThemes/pendingAnalysisCount never touch generateText/embeddings —
// mock the rest of the module's import graph away so it never loads.
vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('ai', () => ({ generateText: vi.fn() }));
vi.mock('$server/llm', () => ({ getOpenRouterModel: () => 'test-model' }));
vi.mock('./crm-conversation-vectors.service', () => ({
  chunkConversation: vi.fn(),
  convoKeyOf: vi.fn(),
  loadRowsForConvos: vi.fn(),
  syncConversationIndex: vi.fn(),
}));
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (_ctx: unknown, fn: (tx: unknown) => unknown) => fn({ execute: mocks.execute }),
}));

import { conversationThemes, pendingAnalysisCount } from './crm-conversation-analysis.service';
import type { CoreCtx } from '$server/auth/core-ctx';

const ctx = { tenantId: 'org-1' } as unknown as CoreCtx;
const dialect = new PgDialect();
function sqlOf(q: SQL) {
  return dialect.sqlToQuery(q);
}

describe('conversationThemes: owner scope', () => {
  beforeEach(() => {
    mocks.execute.mockReset();
    mocks.execute.mockResolvedValue([]);
  });

  it('joins crm_contacts on owner_id when ownerId is passed', async () => {
    await conversationThemes(ctx, { ownerId: 'owner-1' });
    const { sql, params } = sqlOf(mocks.execute.mock.calls[0][0]);
    expect(sql).toContain('owner_id');
    expect(params).toContain('owner-1');
  });

  it('has no owner_id predicate without an ownerId', async () => {
    await conversationThemes(ctx, {});
    const { sql } = sqlOf(mocks.execute.mock.calls[0][0]);
    expect(sql).not.toContain('owner_id');
  });
});

describe('pendingAnalysisCount: owner scope', () => {
  beforeEach(() => {
    mocks.execute.mockReset();
    mocks.execute.mockResolvedValue([{ n: 0 }]);
  });

  it('joins crm_contacts on owner_id when ownerId is passed', async () => {
    await pendingAnalysisCount(ctx, 'owner-1');
    const { sql, params } = sqlOf(mocks.execute.mock.calls[0][0]);
    expect(sql).toContain('owner_id');
    expect(params).toContain('owner-1');
  });

  it('has no owner_id predicate without an ownerId', async () => {
    await pendingAnalysisCount(ctx);
    const { sql } = sqlOf(mocks.execute.mock.calls[0][0]);
    expect(sql).not.toContain('owner_id');
  });
});
