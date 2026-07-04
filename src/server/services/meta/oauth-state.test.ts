import { describe, it, expect, beforeEach } from 'vitest';
import { signOAuthState, verifyOAuthState, OAUTH_STATE_TTL_MS } from './oauth-state';

beforeEach(() => {
  process.env.META_APP_SECRET = 'test-app-secret';
});

describe('signOAuthState / verifyOAuthState', () => {
  it('round-trips: sign then verify against the same cookie value succeeds', () => {
    const state = signOAuthState({ org: 'org-1', userId: 'user-1' });
    const result = verifyOAuthState(state, state);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.org).toBe('org-1');
      expect(result.payload.userId).toBe('user-1');
    }
  });

  it('two signs for the same org/user produce different tokens (nonce)', () => {
    const a = signOAuthState({ org: 'org-1', userId: 'user-1' });
    const b = signOAuthState({ org: 'org-1', userId: 'user-1' });
    expect(a).not.toBe(b);
  });

  it('rejects when state param does not match the cookie (mismatch / replay-without-cookie)', () => {
    const state = signOAuthState({ org: 'org-1', userId: 'user-1' });
    const other = signOAuthState({ org: 'org-1', userId: 'user-1' });
    const result = verifyOAuthState(state, other);
    expect(result).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects a replay once the cookie has been cleared (single-use)', () => {
    const state = signOAuthState({ org: 'org-1', userId: 'user-1' });
    expect(verifyOAuthState(state, state).ok).toBe(true);
    // Route clears the cookie after first use — a second attempt with the
    // same URL/state param but no cookie must fail.
    const replay = verifyOAuthState(state, undefined);
    expect(replay).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects a tampered payload (signature check)', () => {
    const state = signOAuthState({ org: 'org-1', userId: 'user-1' });
    const [body] = state.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({ org: 'org-evil', userId: 'user-1', nonce: 'x', ts: Date.now() })).toString(
      'base64url',
    );
    const [, sig] = state.split('.');
    const tampered = `${tamperedPayload}.${sig}`;
    expect(tampered).not.toBe(state);
    const result = verifyOAuthState(tampered, tampered);
    expect(result).toEqual({ ok: false, reason: 'signature' });
    void body;
  });

  it('rejects an expired token', () => {
    const original = Date.now;
    try {
      Date.now = () => original() - (OAUTH_STATE_TTL_MS + 1000);
      const state = signOAuthState({ org: 'org-1', userId: 'user-1' });
      Date.now = original;
      const result = verifyOAuthState(state, state);
      expect(result).toEqual({ ok: false, reason: 'expired' });
    } finally {
      Date.now = original;
    }
  });

  it('rejects malformed tokens', () => {
    expect(verifyOAuthState('not-a-real-token', 'not-a-real-token')).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyOAuthState(null, null)).toEqual({ ok: false, reason: 'mismatch' });
  });
});
