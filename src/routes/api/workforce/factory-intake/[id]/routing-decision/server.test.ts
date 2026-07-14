import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockWorkforceRawFetch = vi.fn();
vi.mock('$lib/server/workforce-fetch', () => ({
  workforceRawFetch: (...args: unknown[]) => mockWorkforceRawFetch(...args),
  trustedWorkforceMutationHeaders: () => ({
    origin: 'https://hub.example.test',
    referer: 'https://hub.example.test/',
    'x-forwarded-host': 'hub.example.test',
    'x-forwarded-proto': 'https',
  }),
}));

import { POST } from './+server';

const ROOT_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';

function event(body: Record<string, unknown>, identity = true) {
  const url = new URL(`https://hub.test/api/workforce/factory-intake/${ROOT_ID}/routing-decision`);
  return {
    request: new Request(url, { method: 'POST', body: JSON.stringify(body) }),
    url,
    params: { id: ROOT_ID },
    locals: {
      user: { id: 'user-1' },
      workforceIdentity: identity ? { token: 'signed', userId: 'user-1' } : undefined,
    },
  } as never;
}

describe('factory routing-decision proxy', () => {
  beforeEach(() => {
    mockWorkforceRawFetch.mockReset();
    mockWorkforceRawFetch.mockResolvedValue({ intake: { id: ROOT_ID, state: 'pipeline_active' } });
  });

  it('forwards a constrained existing-project decision', async () => {
    const response = await POST(
      event({
        decision: { kind: 'existing_project', projectId: PROJECT_ID, userId: 'attacker' },
        note: 'Hub owns this surface.',
        companyId: 'attacker-company',
      }),
    );
    expect(response.status).toBe(200);
    const [, path, init] = mockWorkforceRawFetch.mock.calls[0] as [unknown, string, RequestInit];
    expect(path).toBe(`/api/factory-intakes/${ROOT_ID}/routing-decision`);
    expect(init.headers).toMatchObject({
      origin: 'https://hub.example.test',
      'x-forwarded-host': 'hub.example.test',
    });
    expect(JSON.parse(String(init.body))).toEqual({
      decision: { kind: 'existing_project', projectId: PROJECT_ID },
      note: 'Hub owns this surface.',
    });
  });

  it('sanitizes the governed new-project fields', async () => {
    await POST(
      event({
        decision: {
          kind: 'new_project',
          name: 'Factory UX',
          description: 'A controlled production line.',
          repositoryKey: 'NikolasP98/minion_hub',
          groupKey: 'apps',
          scopes: ['assistant', '', 42, 'workforce'],
        },
      }),
    );
    const init = mockWorkforceRawFetch.mock.calls[0]?.[2] as RequestInit;
    expect(JSON.parse(String(init.body)).decision).toEqual({
      kind: 'new_project',
      name: 'Factory UX',
      description: 'A controlled production line.',
      repositoryKey: 'NikolasP98/minion_hub',
      groupKey: 'apps',
      scopes: ['assistant', 'workforce'],
    });
  });

  it('fails closed without Workforce identity', async () => {
    const response = await POST(event({ decision: { kind: 'reject' } }, false));
    expect(response.status).toBe(503);
    expect(mockWorkforceRawFetch).not.toHaveBeenCalled();
  });
});
