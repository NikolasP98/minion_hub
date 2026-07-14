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

function event(
  body: Record<string, unknown>,
  options: { user?: boolean; identity?: boolean; orgId?: string | null } = {},
) {
  const url = new URL('https://hub.example.test/api/workforce/factory-intake');
  const user = options.user === false ? null : { id: 'user-1', email: 'n@example.test' };
  const identity =
    options.identity === false
      ? undefined
      : {
          token: 'signed-token',
          companyId: 'org-1',
          userId: 'user-1',
          roleKeys: ['maintainer'],
          roleAuthority: 'signed',
        };
  return {
    request: new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    url,
    params: {},
    locals: {
      user,
      workforceIdentity: identity,
      orgId: options.orgId === undefined ? 'org-1' : options.orgId,
      tenantCtx: options.orgId === null ? null : { tenantId: 'fallback-org' },
    },
  } as never;
}

describe('POST /api/workforce/factory-intake', () => {
  beforeEach(() => {
    mockWorkforceRawFetch.mockReset();
    mockWorkforceRawFetch.mockResolvedValue({
      intake: { id: 'issue-1', identifier: 'MIN-1400', state: 'scouting' },
      rootIssue: { id: 'issue-1', title: 'Build it' },
    });
  });

  it('derives company and exact-user routing server-side', async () => {
    const response = await POST(
      event({
        request: 'Build a durable factory intake.',
        companyId: 'attacker-company',
        userId: 'attacker-user',
        routingTarget: { type: 'role', roleKeys: ['owner'] },
        source: {
          route: '/workforce/projects',
          selectedAgentId: '11111111-1111-4111-8111-111111111111',
        },
        idempotencyKey: 'assistant:12345678',
      }),
    );

    expect(response.status).toBe(202);
    const [, path, init] = mockWorkforceRawFetch.mock.calls[0] as [unknown, string, RequestInit];
    expect(path).toBe('/api/companies/org-1/factory-intakes');
    expect(init.headers).toMatchObject({
      origin: 'https://hub.example.test',
      'x-forwarded-host': 'hub.example.test',
      'x-forwarded-proto': 'https',
    });
    expect(JSON.parse(String(init.body))).toEqual({
      request: 'Build a durable factory intake.',
      source: {
        kind: 'hub_assistant',
        route: '/workforce/projects',
        selectedAgentId: '11111111-1111-4111-8111-111111111111',
      },
      idempotencyKey: 'assistant:12345678',
      routingTarget: { type: 'user' },
    });
  });

  it('omits a non-UUID gateway agent id instead of making the backend reject the intake', async () => {
    await POST(
      event({
        request: 'Build a durable factory intake.',
        source: { route: '/agents', selectedAgentId: 'personal-nikolas' },
      }),
    );
    const init = mockWorkforceRawFetch.mock.calls[0]?.[2] as RequestInit;
    expect(JSON.parse(String(init.body)).source).toEqual({
      kind: 'hub_assistant',
      route: '/agents',
    });
  });

  it('rejects unauthenticated callers before forwarding', async () => {
    await expect(POST(event({ request: 'Build it' }, { user: false }))).rejects.toMatchObject({
      status: 401,
    });
    expect(mockWorkforceRawFetch).not.toHaveBeenCalled();
  });

  it('returns a graceful 503 when signed Workforce identity is absent', async () => {
    const response = await POST(event({ request: 'Build it' }, { identity: false }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'workforce_unavailable' });
    expect(mockWorkforceRawFetch).not.toHaveBeenCalled();
  });

  it('returns a graceful 502 when the control plane is offline', async () => {
    mockWorkforceRawFetch.mockRejectedValueOnce(new TypeError('fetch failed'));
    const response = await POST(event({ request: 'Build it' }));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: 'workforce_unavailable' });
  });
});
