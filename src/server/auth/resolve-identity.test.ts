import { describe, expect, it } from 'vitest';
import {
  clearRejectedSupabaseSession,
  matchesServerIdHint,
  resolveIdentity,
} from './resolve-identity';

describe('matchesServerIdHint', () => {
  const row = { id: 'gateway-uuid', legacyServerId: 'legacy-server-id' };

  it('preserves legacy first-match behavior when no hint is supplied', () => {
    expect(matchesServerIdHint(row)).toBe(true);
  });

  it('accepts either the gateway UUID or its legacy server ID', () => {
    expect(matchesServerIdHint(row, 'gateway-uuid')).toBe(true);
    expect(matchesServerIdHint(row, 'legacy-server-id')).toBe(true);
  });

  it('rejects a different gateway identity even when its token may match', () => {
    expect(matchesServerIdHint(row, 'another-gateway')).toBe(false);
  });
});

describe('clearRejectedSupabaseSession', () => {
  it('expires every chunk of the rejected Supabase session and leaves unrelated cookies alone', () => {
    const deleted: Array<{ name: string; path: string | undefined }> = [];
    const cookies = {
      getAll: () => [
        { name: 'paraglide_lang', value: 'en' },
        { name: 'sb-project-auth-token.0', value: 'first' },
        { name: 'sb-project-auth-token.1', value: 'second' },
        { name: 'minion-build-channel', value: 'prd' },
      ],
      delete: (name: string, options: { path?: string }) =>
        deleted.push({ name, path: options.path }),
    };

    expect(clearRejectedSupabaseSession(cookies)).toBe(2);
    expect(deleted).toEqual([
      { name: 'sb-project-auth-token.0', path: '/' },
      { name: 'sb-project-auth-token.1', path: '/' },
    ]);
  });

  it('also clears an unchunked auth cookie and de-duplicates names defensively', () => {
    const deleted: string[] = [];
    const cookies = {
      getAll: () => [
        { name: 'sb-project-auth-token', value: 'session' },
        { name: 'sb-project-auth-token', value: 'duplicate' },
        { name: 'sb-project-auth-token-code-verifier', value: 'oauth' },
      ],
      delete: (name: string) => deleted.push(name),
    };

    expect(clearRejectedSupabaseSession(cookies)).toBe(1);
    expect(deleted).toEqual(['sb-project-auth-token']);
  });
});

describe('independently authenticated workshop authority route', () => {
  it('does not substitute cookie or cached metric-token identity for its dual credentials', async () => {
    const event = {
      url: new URL('https://hub.test/api/internal/workshop/saves/old%2Fsave/authority'),
    } as Parameters<typeof resolveIdentity>[0];
    await expect(resolveIdentity(event)).resolves.toEqual({ locals: {}, bypassGate: true });
  });
});
