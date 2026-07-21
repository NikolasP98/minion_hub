import { describe, expect, it } from 'vitest';
import { matchesServerIdHint } from './resolve-identity';

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
