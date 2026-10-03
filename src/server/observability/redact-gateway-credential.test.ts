import { describe, expect, it } from 'vitest';
import { redactGatewayCredential } from './redact-gateway-credential';

describe('forwarded user JWT observability boundary', () => {
  it.each(['x-minion-user-jwt', 'X-Minion-User-JWT'])(
    'removes %s from errors and transactions without mutating their input',
    (header) => {
      const event = {
        request: { headers: { [header]: 'private-token', accept: 'application/json' } },
        message: 'unavailable',
      };
      const result = redactGatewayCredential(event);
      expect(result.request.headers).toEqual({ accept: 'application/json' });
      expect(JSON.stringify(result)).not.toContain('private-token');
      expect(event.request.headers[header]).toBe('private-token');
    },
  );
  it('retains non-request diagnostics', () => {
    const event = { message: 'startup' };
    expect(
      redactGatewayCredential(
        event as typeof event & { request?: { headers?: Record<string, string> } },
      ),
    ).toBe(event);
  });
});
