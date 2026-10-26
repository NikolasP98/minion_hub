import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const execute = vi.fn();
const withOrgCore = vi.fn(
  async (_ctx: unknown, operation: (tx: { execute: typeof execute }) => Promise<unknown>) =>
    operation({ execute }),
);
const generateObject = vi.fn();

vi.mock('$server/db/with-org-core', () => ({ withOrgCore }));
vi.mock('ai', () => ({ generateObject }));
vi.mock('$server/llm', () => ({ getOpenRouterModel: (id: string) => ({ modelId: id }) }));

const { draftFaqsFromConversations, scrubPii, FAQ_MAX_DRAFTS } =
  await import('./doors-faq-draft.service');

const ctx = { tenantId: 'org-1' } as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('scrubPii', () => {
  it('removes emails, handles and phone numbers but keeps short numbers', () => {
    const out = scrubPii(
      'Soy ana.p@mail.com, @ana_p, llámame al +51 987 654 321 o 987-654-321. Cuesta S/ 150 a las 10:00 - 13:00',
    );
    expect(out).not.toMatch(/@/);
    expect(out).not.toMatch(/\d[\s().-]*\d[\s().-]*\d[\s().-]*\d[\s().-]*\d[\s().-]*\d[\s().-]*\d/);
    expect(out).toContain('[email]');
    expect(out).toContain('[tel]');
    expect(out).toContain('S/ 150');
    expect(out).toContain('10:00 - 13:00');
  });
});

describe('draftFaqsFromConversations', () => {
  it('samples org-scoped inbound 1:1 messages with the next reply within 24 h', async () => {
    execute.mockResolvedValue([]);
    await draftFaqsFromConversations(ctx);
    expect(withOrgCore).toHaveBeenCalledWith(ctx, expect.any(Function));
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    expect(query.params).toContain('org-1');
    for (const part of [
      'q.org_id = $1',
      "q.direction = 'inbound'",
      'coalesce(q.is_group, false) = false',
      'q.is_bot is not true',
      "interval '90 days'",
      'between 8 and 500',
      'left join lateral',
      "o.direction = 'outbound'",
      "interval '24 hours'",
      'limit 400',
    ])
      expect(query.sql).toContain(part);
  });

  it('0 messages ⇒ no drafts and no model call', async () => {
    execute.mockResolvedValue([]);
    expect(await draftFaqsFromConversations(ctx)).toEqual({ drafts: [] });
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('sends a PII-free prompt in ONE call and returns at most 10 clean drafts', async () => {
    execute.mockResolvedValue([
      {
        question: '¿Atienden sábados? mi cel es 987654321',
        reply: 'Sí, escríbenos a citas@clinica.pe',
      },
      { question: 'Precio del botox? soy @juanito', reply: null },
    ]);
    generateObject.mockResolvedValue({
      object: {
        drafts: Array.from({ length: 14 }, (_, i) => ({
          q: i === 0 ? '   ' : ` ¿P${i}? `,
          a: 'R',
          count: 2.6,
        })),
      },
    });
    const { drafts } = await draftFaqsFromConversations(ctx);
    expect(generateObject).toHaveBeenCalledOnce();
    const { prompt } = generateObject.mock.calls[0][0] as { prompt: string };
    expect(prompt).not.toMatch(/\d{7,}/);
    expect(prompt).not.toContain('@');
    expect(prompt).toContain('¿Atienden sábados?');
    expect(drafts).toHaveLength(FAQ_MAX_DRAFTS);
    expect(drafts[0]).toEqual({ q: '¿P1?', a: 'R', count: 3 });
  });
});
