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
  it('uses the canonical supabase uuid as the hub user id (legacy bridge retired)', () => {
    const u = mapProfileToUser(base, 'supa-uuid-1');
    expect(u).toEqual({
      id: 'supa-uuid-1',
      email: 'nik@example.com',
      displayName: 'Nik P',
      avatarUrl: null,
      role: 'admin',
      supabaseId: 'supa-uuid-1',
      createdAt: null,
    });
  });

  it('id == supabaseId regardless of legacy_user_id presence', () => {
    const u = mapProfileToUser({ ...base, legacy_user_id: null }, 'supa-uuid-1');
    expect(u.id).toBe('supa-uuid-1');
    expect(u.supabaseId).toBe('supa-uuid-1');
  });

  it('defaults role to user when null', () => {
    const u = mapProfileToUser({ ...base, role: null }, 'supa-uuid-1');
    expect(u.role).toBe('user');
  });

});
