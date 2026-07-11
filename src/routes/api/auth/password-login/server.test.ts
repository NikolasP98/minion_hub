import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMaybeSingle = vi.fn();
const mockSignInWithPassword = vi.fn();

vi.mock('$server/supabase', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: mockMaybeSingle,
        }),
      }),
    }),
  }),
  supabaseServer: () => ({
    auth: { signInWithPassword: mockSignInWithPassword },
  }),
}));

vi.mock('$server/auth/rate-limit', () => ({
  checkRateLimit: () => true,
}));

import { POST } from './+server';

function makeEvent(body: unknown) {
  return {
    request: { json: async () => body },
    url: new URL('http://localhost/api/auth/password-login'),
  } as never;
}

beforeEach(() => vi.clearAllMocks());

describe('POST /api/auth/password-login', () => {
  it('signs in directly when the identifier looks like an email', async () => {
    mockSignInWithPassword.mockResolvedValue({ error: null });
    const res = await POST(makeEvent({ identifier: 'nik@example.com', password: 'hunter2' }));
    expect(res.status).toBe(200);
    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: 'nik@example.com',
      password: 'hunter2',
    });
    expect(mockMaybeSingle).not.toHaveBeenCalled();
  });

  it('resolves a username to an email before signing in', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { email: 'nik@example.com' } });
    mockSignInWithPassword.mockResolvedValue({ error: null });
    const res = await POST(makeEvent({ identifier: 'NikP', password: 'hunter2' }));
    expect(res.status).toBe(200);
    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: 'nik@example.com',
      password: 'hunter2',
    });
  });

  it('returns the SAME generic 401 for an unknown username as for a wrong password', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null });
    const unknownRes = await POST(makeEvent({ identifier: 'ghost', password: 'whatever' }));
    expect(unknownRes.status).toBe(401);
    expect(await unknownRes.json()).toEqual({ error: 'invalid_credentials' });
    expect(mockSignInWithPassword).not.toHaveBeenCalled();

    mockSignInWithPassword.mockResolvedValue({ error: { message: 'bad password' } });
    const wrongPwRes = await POST(makeEvent({ identifier: 'nik@example.com', password: 'wrong' }));
    expect(wrongPwRes.status).toBe(401);
    expect(await wrongPwRes.json()).toEqual({ error: 'invalid_credentials' });
  });

  it('400 when identifier or password is missing', async () => {
    await expect(
      POST(makeEvent({ identifier: 'nik@example.com' })),
    ).rejects.toMatchObject({ status: 400 });
  });
});
