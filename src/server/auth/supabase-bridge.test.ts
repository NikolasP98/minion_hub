import { describe, it, expect } from 'vitest';
import { mapProfileToUser, type ProfileRow } from './supabase-bridge.js';

const base: ProfileRow = {
  id: 'supa-uuid-1',
  email: 'nik@example.com',
  display_name: 'Nik P',
  role: 'admin',
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
      username: null,
    });
  });

  it('id == supabaseId (GoTrue principal id is the profile uuid)', () => {
    const u = mapProfileToUser(base, 'supa-uuid-1');
    expect(u.id).toBe('supa-uuid-1');
    expect(u.supabaseId).toBe('supa-uuid-1');
  });

  it('defaults role to user when null', () => {
    const u = mapProfileToUser({ ...base, role: null }, 'supa-uuid-1');
    expect(u.role).toBe('user');
  });

});
