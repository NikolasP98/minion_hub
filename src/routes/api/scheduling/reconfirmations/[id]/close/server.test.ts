import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';

const mocks = vi.hoisted(() => ({
  requireOrgCapability: vi.fn(),
  getCoreCtx: vi.fn(),
  isModuleEnabled: vi.fn(),
  closeCase: vi.fn(),
}));
vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: (...a: unknown[]) => mocks.requireOrgCapability(...a),
}));
vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: (...a: unknown[]) => mocks.getCoreCtx(...a),
}));
vi.mock('$server/services/modules.service', () => ({
  isModuleEnabled: (...a: unknown[]) => mocks.isModuleEnabled(...a),
}));
vi.mock('$server/services/reconfirm.service', () => ({
  closeCase: (...a: unknown[]) => mocks.closeCase(...a),
}));

import { POST } from './+server';

const ID = '3f0c1d0e-8a54-4a27-9a43-0f6d8f1d2c11';
const call = (id = ID, body: unknown = {}) =>
  POST!({
    locals: { user: { supabaseId: 'profile-1' }, tenantCtx: { tenantId: 'org-1' } },
    params: { id },
    request: new Request('http://localhost/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as never) as Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireOrgCapability.mockResolvedValue(null);
  mocks.getCoreCtx.mockResolvedValue({ db: {}, tenantId: 'org-1', profileId: 'profile-1' });
  mocks.isModuleEnabled.mockResolvedValue(true);
  mocks.closeCase.mockResolvedValue('closed');
});

describe('POST /api/scheduling/reconfirmations/[id]/close', () => {
  it('closes the case as attended by the caller and answers 200', async () => {
    const res = await call(ID, { note: 'llamé a la clienta' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.requireOrgCapability).toHaveBeenCalledWith(
      expect.anything(),
      'scheduling',
      'manage',
    );
    expect(mocks.closeCase.mock.calls[0]![1]).toBe(ID);
    expect(mocks.closeCase.mock.calls[0]![2]).toEqual({
      profileId: 'profile-1',
      action: 'attended',
      note: 'llamé a la clienta',
    });
  });

  it('is idempotent: an already closed case still answers 200', async () => {
    mocks.closeCase.mockResolvedValue('already_closed');
    expect((await call()).status).toBe(200);
  });

  it('answers 404 for an unknown or malformed id', async () => {
    mocks.closeCase.mockResolvedValue('not_found');
    const unknown = await call();
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ code: 'not_found' });
    expect((await call('nope')).status).toBe(404);
    expect(mocks.closeCase).toHaveBeenCalledTimes(1);
  });

  it('answers 403 without scheduling:manage and closes nothing', async () => {
    mocks.requireOrgCapability.mockImplementation(async () => {
      error(403, 'scheduling: manage required');
    });
    await expect(call()).rejects.toMatchObject({ status: 403 });
    expect(mocks.closeCase).not.toHaveBeenCalled();
  });

  it('is refused when the scheduling module is off', async () => {
    mocks.isModuleEnabled.mockResolvedValue(false);
    await expect(call()).rejects.toMatchObject({ status: 403 });
    expect(mocks.closeCase).not.toHaveBeenCalled();
  });

  it('never touches a booking: the route imports no booking writer', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./+server.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/scheduling-bookings|setBookingStatus|cancel/i);
  });
});
