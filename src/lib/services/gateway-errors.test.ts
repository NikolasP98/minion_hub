import { describe, it, expect } from 'vitest';
import { describeGatewayError } from './gateway-errors';

describe('describeGatewayError', () => {
  it('explains jwt_required as a shared-token failure (not a literal JWT problem)', () => {
    const info = describeGatewayError('jwt_required');
    expect(info.title).toMatch(/token/i);
    expect(info.hint).toMatch(/Hosts/);
    expect(info.cta).toBe('hosts-edit');
    expect(info.raw).toBe('jwt_required');
  });

  it('maps JWT validation failures to the identity-token case (retry, self-heals)', () => {
    // Real gateway JWT close reasons always contain "jwt" (isJwtAuthClose = /jwt/i).
    for (const reason of ['jwt_validation_failed', 'jwt expired', 'jwt invalid issuer', 'JWT rejected']) {
      const info = describeGatewayError(reason);
      expect(info.title).toMatch(/identity token/i);
      expect(info.cta).toBe('retry');
    }
  });

  it('maps revoked tokens to a rotate-token action', () => {
    const info = describeGatewayError('token revoked');
    expect(info.title).toMatch(/revoked/i);
    expect(info.cta).toBe('hosts-edit');
  });

  it('maps pairing/not-paired closes to a token-rotation hint', () => {
    for (const reason of ['not paired', 'device identity required', 'pairing required']) {
      const info = describeGatewayError(reason);
      expect(info.cta).toBe('hosts-edit');
      expect(info.hint).toMatch(/token/i);
    }
  });

  it('maps connection limit', () => {
    const info = describeGatewayError('connection_limit_exceeded');
    expect(info.title).toMatch(/limit/i);
    expect(info.cta).toBe('retry');
  });

  it('maps network/empty closes to an unreachable-gateway message', () => {
    for (const reason of ['', 'ECONNREFUSED', 'timeout', 'WebSocket closed before open']) {
      const info = describeGatewayError(reason);
      expect(info.title).toMatch(/reach/i);
      expect(info.cta).toBe('retry');
      expect(info.raw).not.toBe('');
    }
  });

  it('falls back to a generic message that still shows the raw reason', () => {
    const info = describeGatewayError('some_unmapped_reason_xyz');
    expect(info.title).toMatch(/failed/i);
    expect(info.hint).toContain('some_unmapped_reason_xyz');
    expect(info.raw).toBe('some_unmapped_reason_xyz');
  });

  it('handles null/undefined input (treated as an empty network close)', () => {
    const info = describeGatewayError(null);
    expect(info.title).toMatch(/reach/i);
    expect(info.raw).toBe('connection closed');
    expect(describeGatewayError(undefined).title).toBeTruthy();
  });
});
