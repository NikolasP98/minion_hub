import { describe, test, expect, vi, beforeEach } from 'vitest';

const calls: any = {};
const notifications = vi.hoisted(() => ({
  prepare: vi.fn(),
  recheck: vi.fn(),
  send: vi.fn(),
}));
vi.mock('$server/supabase', () => ({
  supabaseAdmin: () => ({
    from: (_table: string) => ({
      insert: (row: any) => ({
        select: () => ({
          single: async () => ((calls.inserted = row), { data: { id: 'r1', ...row }, error: null }),
        }),
      }),
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: calls.pending ?? null, error: null }),
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
        in: () => ({ data: calls.admins ?? [], error: null }),
      }),
      update: (patch: any) => ({
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
  for (const k of Object.keys(calls)) delete calls[k];
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
    expect(calls.inserted.status).toBe('pending');
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
    expect(calls.updated.status).toBe('approved');
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
