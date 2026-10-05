import { describe, test, expect, vi, beforeEach } from 'vitest';

interface CallState {
  inserted?: { status: string; user_id: string; organization_id: string; message?: string };
  row?: {
    status: string;
    user_id: string;
    email: string;
    display_name: string;
    organization_id: string;
  };
  updated?: Record<string, unknown>;
  membership?: boolean;
}
let calls: CallState = {};
const notifications = vi.hoisted(() => ({
  admit: vi.fn(),
  readOwn: vi.fn(),
  readTarget: vi.fn(),
  prepare: vi.fn(),
  recheck: vi.fn(),
  send: vi.fn(),
}));
vi.mock('./pending.repository', () => ({
  admitPendingRequest: notifications.admit,
  readOwnPendingRequests: notifications.readOwn,
  readOwnPendingRequestForOrganization: notifications.readTarget,
}));
vi.mock('$server/supabase', () => ({
  supabaseAdmin: () => ({
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: async () => ({
              data: calls.row ?? null,
              error: calls.row ? null : { message: 'not found' },
            }),
          }),
          single: async () => ({
            data: calls.row ?? null,
            error: calls.row ? null : { message: 'not found' },
          }),
          order: () => ({/* listPending unused here */}),
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: () => {
          calls.updated = patch;
          return Promise.resolve({ error: null });
        },
      }),
    }),
  }),
}));
vi.mock('$server/db/client', () => ({ getDb: () => ({}) }));
vi.mock('./membership', () => ({
  createMembership: vi.fn(async () => {
    calls.membership = true;
  }),
}));
vi.mock('./notification-audience', () => ({
  prepareJoinReviewRecipients: notifications.prepare,
  recheckJoinReviewRecipient: notifications.recheck,
}));
vi.mock('$server/services/email.service', () => ({ sendJoinRequestEmail: notifications.send }));

beforeEach(() => {
  calls = {};
  notifications.admit.mockReset().mockImplementation(async (who, organizationId, message) => {
    calls.inserted = {
      status: 'pending',
      user_id: who.id,
      organization_id: organizationId,
      message,
    };
    return { request: { id: 'r1', status: 'pending' }, created: true };
  });
  notifications.prepare
    .mockReset()
    .mockResolvedValue([{ profileId: 'manager-1', email: 'manager@example.test' }]);
  notifications.recheck.mockReset().mockResolvedValue(true);
  notifications.send.mockReset().mockResolvedValue({ accepted: true });
});

describe('requests.service', () => {
  test('createRequest commits then sends only to freshly rechecked target-org recipients', async () => {
    const { createRequest } = await import('./requests.service');
    const r = await createRequest(
      { id: 'u1', supabaseId: 's1', email: 'a@b.c', displayName: 'A' },
      'org1',
      'hello',
    );
    expect(calls.inserted?.status).toBe('pending');
    expect(notifications.prepare).toHaveBeenCalledWith('org1');
    expect(notifications.recheck).toHaveBeenCalledWith('org1', {
      profileId: 'manager-1',
      email: 'manager@example.test',
    });
    expect(notifications.send).toHaveBeenCalledWith({ to: 'manager@example.test' });
    expect(JSON.stringify(notifications.send.mock.calls)).not.toContain('a@b.c');
    expect(JSON.stringify(notifications.send.mock.calls)).not.toContain('hello');
    expect(r.id).toBe('r1');
  });

  test('preserves the committed request when audience preparation fails and logs no PII', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    notifications.prepare.mockRejectedValueOnce(
      Object.assign(new Error('applicant a@b.c private message'), {
        code: 'candidate_limit_exceeded',
      }),
    );
    const { createRequest } = await import('./requests.service');
    await expect(
      createRequest(
        { id: 'u1', supabaseId: 's1', email: 'a@b.c', displayName: 'Applicant Name' },
        'org1',
        'private message',
      ),
    ).resolves.toMatchObject({ id: 'r1', status: 'pending' });
    expect(calls.inserted).toBeDefined();
    expect(notifications.send).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('[join-request-notification]', {
      errorClass: 'candidate_limit_exceeded',
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('a@b.c');
    expect(JSON.stringify(log.mock.calls)).not.toContain('private message');
    log.mockRestore();
  });

  test('suppresses a recipient whose membership, capability, org, or destination changed', async () => {
    notifications.recheck.mockResolvedValueOnce(false);
    const { createRequest } = await import('./requests.service');
    await createRequest({ id: 'u1', supabaseId: 's1', email: 'a@b.c', displayName: 'A' }, 'org1');
    expect(notifications.send).not.toHaveBeenCalled();
  });

  test('keeps creation successful when the provider rejects the generic review alert', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    notifications.send.mockResolvedValueOnce({
      accepted: false,
      errorClass: 'provider_rejected',
    });
    const { createRequest } = await import('./requests.service');
    await expect(
      createRequest({ id: 'u1', supabaseId: 's1', email: 'a@b.c', displayName: 'A' }, 'org1'),
    ).resolves.toMatchObject({ id: 'r1', status: 'pending' });
    expect(log).toHaveBeenCalledWith('[join-request-notification]', {
      errorClass: 'provider_rejected',
    });
    log.mockRestore();
  });

  test('an exact-target duplicate returns its receipt without another notification', async () => {
    notifications.admit.mockResolvedValueOnce({
      request: { id: 'existing-b', status: 'pending' },
      created: false,
    });
    const { createRequest } = await import('./requests.service');
    const who = { id: 'u1', supabaseId: 's1', email: 'a@b.c', displayName: 'A' };
    await expect(createRequest(who, 'org-b', 'retry')).resolves.toEqual({
      id: 'existing-b',
      status: 'pending',
    });
    expect(notifications.admit).toHaveBeenCalledWith(who, 'org-b', 'retry');
    expect(notifications.prepare).not.toHaveBeenCalled();
    expect(notifications.send).not.toHaveBeenCalled();
  });

  test('approve creates membership + marks approved', async () => {
    const { approveRequest } = await import('./requests.service');
    calls.row = {
      status: 'pending',
      user_id: 'u1',
      email: 'a@b.c',
      display_name: 'A',
      organization_id: 'org1',
    };
    await approveRequest('r1', { reviewerId: 'admin1', role: 'user', organizationId: 'org1' });
    expect(calls.membership).toBe(true);
    expect(calls.updated?.status).toBe('approved');
  });

  test('approve is a no-op when request is not pending', async () => {
    const { approveRequest } = await import('./requests.service');
    calls.row = {
      status: 'approved',
      user_id: 'u1',
      email: 'a@b.c',
      display_name: 'A',
      organization_id: 'org1',
    };
    await approveRequest('r1', { reviewerId: 'admin1', role: 'user', organizationId: 'org1' });
    expect(calls.membership).toBeUndefined();
    expect(calls.updated).toBeUndefined();
  });
});
