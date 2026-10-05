import { beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  principal: vi.fn(),
  fresh: vi.fn(),
  from: vi.fn(),
  send: vi.fn(),
  eq: vi.fn(),
  single: vi.fn(),
}));
vi.mock('$server/auth/assistant-principal', () => ({
  resolveAssistantPrincipal: boundary.principal,
}));
vi.mock('$server/services/fresh-org-authority', () => ({
  resolveFreshOrgMemberWithCapability: boundary.fresh,
}));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: vi.fn() }));
vi.mock('$server/supabase', () => ({ supabaseAdmin: () => ({ from: boundary.from }) }));
vi.mock('$lib/server/gateway-rpc', () => ({ gatewayCallAsUser: boundary.send }));
vi.mock('@sentry/sveltekit', () => ({ captureException: vi.fn() }));
import { POST } from './+server';

const org = '11111111-1111-4111-8111-111111111111';
const actor = '22222222-2222-4222-8222-222222222222';
const recipient = '33333333-3333-4333-8333-333333333333';
const event = (confirm = false) =>
  ({
    locals: { user: { role: 'admin' } },
    url: new URL(
      'http://localhost/api/gateway/actions/notify-user?agentId=personal-test&orgId=untrusted-request',
    ),
    request: new Request('http://localhost/api/gateway/actions/notify-user', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm, recipientProfileId: recipient, body: 'Synthetic notice' }),
    }),
  }) as Parameters<typeof POST>[0];

beforeEach(() => {
  vi.resetAllMocks();
  boundary.principal.mockResolvedValue({
    principalId: actor,
    orgId: org,
    capabilities: { can: () => true },
    role: 'ADMIN',
  });
  boundary.fresh.mockResolvedValue({ profileId: actor, verifiedEmail: null });
  const query = { select: vi.fn().mockReturnThis(), eq: boundary.eq, maybeSingle: boundary.single };
  boundary.eq.mockReturnValue(query);
  boundary.from.mockReturnValue(query);
  boundary.single.mockResolvedValue({ data: { profile_id: recipient }, error: null });
});

describe('actual delegated notification route authority', () => {
  it.each([false, true])(
    'denies confirm=%s before recipient lookup or send when fresh create is absent',
    async (confirm) => {
      boundary.fresh.mockResolvedValue(null);
      await expect(POST(event(confirm))).rejects.toMatchObject({ status: 403 });
      expect(boundary.fresh).toHaveBeenCalledExactlyOnceWith(org, actor, 'comms', 'create');
      expect(boundary.from).not.toHaveBeenCalled();
      expect(boundary.send).not.toHaveBeenCalled();
    },
  );

  it('uses the resolved actor and organization for preview and never sends', async () => {
    const response = await POST(event());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      preview: {
        action: 'notify-user',
        recipientProfileId: recipient,
        subject: null,
        body: 'Synthetic notice',
      },
    });
    expect(boundary.eq.mock.calls).toEqual([
      ['organization_id', org],
      ['profile_id', recipient],
    ]);
    expect(boundary.fresh).toHaveBeenCalledExactlyOnceWith(org, actor, 'comms', 'create');
    expect(boundary.from).toHaveBeenCalledExactlyOnceWith('organization_members');
    expect(boundary.send).not.toHaveBeenCalled();
  });

  it('contains authority lookup failure before any recipient data or delivery effect', async () => {
    boundary.fresh.mockRejectedValue(new Error('private provider detail'));
    await expect(POST(event(true))).rejects.toMatchObject({
      status: 503,
      body: { message: 'Notification permissions are temporarily unavailable.' },
    });
    expect(boundary.from).not.toHaveBeenCalled();
    expect(boundary.send).not.toHaveBeenCalled();
  });

  it('does not reuse a successful preview as permission after revocation', async () => {
    await POST(event());
    boundary.fresh.mockResolvedValue(null);
    boundary.from.mockClear();
    await expect(POST(event(true))).rejects.toMatchObject({ status: 403 });
    expect(boundary.fresh).toHaveBeenCalledTimes(2);
    expect(boundary.from).not.toHaveBeenCalled();
    expect(boundary.send).not.toHaveBeenCalled();
  });
});
