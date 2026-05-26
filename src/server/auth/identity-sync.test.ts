import { describe, it, expect, vi } from 'vitest';
import { syncGoogleLogin } from './identity-sync.js';

function fakeAdmin() {
  const calls: Record<string, unknown[]> = { profiles: [], user_identities: [] };
  return {
    calls,
    from(table: string) {
      return {
        upsert: (row: unknown, _opts?: unknown) => {
          calls[table].push(row);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

describe('syncGoogleLogin', () => {
  it('upserts a profile and a sealed google identity', async () => {
    const admin = fakeAdmin();
    const seal = vi.fn(() => ({ ciphertext: 'cafe', iv: 'beef' }));
    await syncGoogleLogin(admin as never, seal, {
      user: { id: '11111111-1111-1111-1111-111111111111', email: 'nik@example.com', user_metadata: { full_name: 'Nik P' }, app_metadata: { provider: 'google' } },
      providerRefreshToken: 'rt-123',
      providerScope: 'email profile',
    });
    expect(admin.calls.profiles[0]).toMatchObject({ id: '11111111-1111-1111-1111-111111111111', email: 'nik@example.com', display_name: 'Nik P' });
    expect(seal).toHaveBeenCalledWith(expect.stringContaining('rt-123'));
    expect(admin.calls.user_identities[0]).toMatchObject({ user_id: '11111111-1111-1111-1111-111111111111', provider: 'google', kind: 'oauth', external_id: 'nik@example.com', secret_ciphertext: 'cafe', secret_iv: 'beef' });
  });

  it('skips sealing when no refresh token', async () => {
    const admin = fakeAdmin();
    const seal = vi.fn(() => ({ ciphertext: 'x', iv: 'y' }));
    await syncGoogleLogin(admin as never, seal, {
      user: { id: 'u2', email: 'a@b.com', user_metadata: {}, app_metadata: { provider: 'google' } },
      providerRefreshToken: null, providerScope: null,
    });
    expect(seal).not.toHaveBeenCalled();
    expect(admin.calls.user_identities[0]).toMatchObject({ secret_ciphertext: null, secret_iv: null });
  });
});
