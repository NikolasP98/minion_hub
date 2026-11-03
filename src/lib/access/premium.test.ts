import { describe, expect, it } from 'vitest';
import { ApiError } from '$lib/api/fetch-json';
import { isPremiumRequired, isPremiumResponse } from './premium';

describe('premium_required detection (spec 043)', () => {
  it('matches a gateway FORBIDDEN with details.reason and a fetchJson ApiError body', () => {
    expect(isPremiumRequired({ code: 'FORBIDDEN', details: { reason: 'premium_required' } })).toBe(
      true,
    );
    expect(
      isPremiumRequired(
        new ApiError('x', 'forbidden', 403, { code: 'premium_required', feature: 'ai' }),
      ),
    ).toBe(true);
  });
  it('ignores other failures', () => {
    expect(isPremiumRequired({ code: 'FORBIDDEN', details: { reason: 'scope' } })).toBe(false);
    expect(isPremiumRequired(new Error('premium_required'))).toBe(false);
    expect(isPremiumRequired(null)).toBe(false);
  });
  it('reads a 403 Response body without consuming it', async () => {
    const res = new Response(JSON.stringify({ code: 'premium_required' }), { status: 403 });
    expect(await isPremiumResponse(res)).toBe(true);
    expect(await res.json()).toEqual({ code: 'premium_required' });
    expect(
      await isPremiumResponse(new Response('{"code":"premium_required"}', { status: 401 })),
    ).toBe(false);
    expect(await isPremiumResponse(new Response('not json', { status: 403 }))).toBe(false);
  });
});
