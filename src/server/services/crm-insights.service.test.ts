import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  generateObject: vi.fn(),
  withOrgCore: vi.fn(),
}));

vi.mock('$env/dynamic/private', () => ({
  env: { OPENROUTER_API_KEY: 'test-key' },
}));
vi.mock('ai', () => ({ generateObject: mocks.generateObject }));
vi.mock('$server/db/with-org-core', () => ({ withOrgCore: mocks.withOrgCore }));
vi.mock('$server/llm', () => ({ getOpenRouterModel: () => 'test-model' }));
vi.mock('@minion-stack/cache', () => ({
  cached: vi.fn(),
  keys: { hub: vi.fn() },
  tags: { tenantDomain: vi.fn(() => []) },
}));

import { scoreSentimentBatch } from './crm-insights.service';

describe('scoreSentimentBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withOrgCore.mockImplementation(
      (_ctx: unknown, work: (tx: { execute: typeof mocks.execute }) => Promise<unknown>) =>
        work({ execute: mocks.execute }),
    );
  });

  it('fans chat-day scores out to messages and returns the affected day bounds', async () => {
    mocks.execute
      .mockResolvedValueOnce([
        {
          id: '11111111-1111-4111-8111-111111111111',
          chat_id: 'chat-a',
          day: '2026-08-22',
          content: 'Todo excelente',
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          chat_id: 'chat-a',
          day: '2026-08-22',
          content: 'Muchas gracias',
        },
        {
          id: '33333333-3333-4333-8333-333333333333',
          chat_id: 'chat-a',
          day: '2026-08-20',
          content: 'Sigo esperando respuesta',
        },
      ])
      .mockResolvedValueOnce(undefined);
    mocks.generateObject.mockResolvedValue({
      object: [
        { i: 1, score: 0.8 },
        { i: 2, score: -0.4 },
      ],
    });

    const result = await scoreSentimentBatch({ tenantId: 'org-a' } as never, { cap: 10 });

    expect(result).toEqual({
      scored: 3,
      fromDay: '2026-08-20',
      toDay: '2026-08-22',
    });
    expect(mocks.withOrgCore).toHaveBeenCalledTimes(2);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });
});
