import { describe, it, expect } from 'vitest';
import { mapProfileToUser, type ProfileRow } from './supabase-bridge.js';

const base: ProfileRow = {
  id: 'supa-uuid-1',
  email: 'nik@example.com',
  display_name: 'Nik P',
  role: 'admin',
  legacy_user_id: 'better-auth-id-1',
};

describe('mapProfileToUser', () => {
  it('uses legacy_user_id as the hub user id (so Turso loads match)', () => {
    const u = mapProfileToUser(base, 'supa-uuid-1');
    expect(u).toEqual({
      id: 'better-auth-id-1',
      email: 'nik@example.com',
      displayName: 'Nik P',
      role: 'admin',
      supabaseId: 'supa-uuid-1',
    });
  });

  it('falls back to the supabase id when no legacy id (native signup)', () => {
    const u = mapProfileToUser({ ...base, legacy_user_id: null }, 'supa-uuid-1');
    expect(u.id).toBe('supa-uuid-1');
    expect(u.supabaseId).toBe('supa-uuid-1');
  });

  it('defaults role to user when null', () => {
    const u = mapProfileToUser({ ...base, role: null }, 'supa-uuid-1');
    expect(u.role).toBe('user');
  });

  it('maps super_admin role through', () => {
    const u = mapProfileToUser({ ...base, role: 'super_admin' }, 'supa-uuid-1');
    expect(u.role).toBe('super_admin');
  });
});
