import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAuth = vi.fn();
const getCoreDb = vi.fn(() => ({}));
const upsertUserPreference = vi.fn();
const invalidateLandingCache = vi.fn();

vi.mock('$server/auth/authorize', () => ({ requireAuth }));
vi.mock('$server/db/pg-client', () => ({ getCoreDb }));
vi.mock('$server/services/user-preferences.service', () => ({ upsertUserPreference }));
vi.mock('$server/landing-cache', () => ({ invalidateLandingCache }));

const { PUT } = await import('./+server');

const put = (section: string, value: unknown, organizationId = 'org-a') =>
  PUT!({
    locals: { orgId: organizationId },
    params: { section },
    request: new Request(`http://localhost/api/me/preferences/${section}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value }),
    }),
  } as never);

beforeEach(() => {
  vi.clearAllMocks();
  requireAuth.mockReturnValue({ supabaseId: 'u1' });
  upsertUserPreference.mockResolvedValue(undefined);
});

describe('PUT /api/me/preferences/tableOpenIn', () => {
  it('accepts a valid per-table open-mode map', async () => {
    const res = await put('tableOpenIn', { 'stock.items': 'tray', 'pos.catalog': 'modal' });
    expect(res.status).toBe(200);
    expect(upsertUserPreference).toHaveBeenCalledWith(expect.anything(), 'u1', 'tableOpenIn', {
      'stock.items': 'tray',
      'pos.catalog': 'modal',
    });
  });

  it('rejects an unknown open mode', async () => {
    await expect(put('tableOpenIn', { 'stock.items': 'popup' })).rejects.toMatchObject({
      status: 400,
    });
    expect(upsertUserPreference).not.toHaveBeenCalled();
  });

  it('rejects a non-object value', async () => {
    await expect(put('tableOpenIn', ['tray'])).rejects.toMatchObject({ status: 400 });
    await expect(put('tableOpenIn', 'tray')).rejects.toMatchObject({ status: 400 });
  });

  it('accepts an empty map', async () => {
    const res = await put('tableOpenIn', {});
    expect(res.status).toBe(200);
  });
});

describe('PUT /api/me/preferences/[section] — unknown section', () => {
  it('is rejected before touching the DB', async () => {
    await expect(put('nope', { x: 1 })).rejects.toMatchObject({ status: 400 });
    expect(upsertUserPreference).not.toHaveBeenCalled();
  });
});

describe('daily dashboard version and organization admission', () => {
  const value = { version: 1, organizationId: 'org-a', order: ['kpis'], hidden: [] };
  it('accepts bounded current-scope layout and rejects a rotated organization', async () => {
    expect((await put('dailyDashboard', value)).status).toBe(200);
    upsertUserPreference.mockClear();
    await expect(put('dailyDashboard', value, 'org-b')).rejects.toMatchObject({ status: 409 });
    expect(upsertUserPreference).not.toHaveBeenCalled();
  });
  it('rejects unknown versions, duplicate catalog entries and invalid scope', async () => {
    for (const invalid of [
      { ...value, version: 2 },
      { ...value, order: ['kpis', 'kpis'] },
      { ...value, organizationId: '' },
      { ...value, hidden: ['retired'] },
    ]) {
      await expect(put('dailyDashboard', invalid)).rejects.toMatchObject({ status: 400 });
    }
    expect(upsertUserPreference).not.toHaveBeenCalled();
  });
});

describe('PUT /api/me/preferences/density', () => {
  it('accepts both modes in the exact versioned shape', async () => {
    for (const mode of ['compact', 'comfortable']) {
      expect((await put('density', { version: 1, mode })).status).toBe(200);
      expect(upsertUserPreference).toHaveBeenLastCalledWith(expect.anything(), 'u1', 'density', {
        version: 1,
        mode,
      });
    }
  });
  it('rejects unknown modes, versions, extra keys and non-objects', async () => {
    for (const invalid of [
      { version: 1, mode: 'dense' },
      { version: 2, mode: 'compact' },
      { mode: 'compact' },
      { version: 1, mode: 'compact', extra: true },
      'compact',
      ['compact'],
      null,
    ]) {
      await expect(put('density', invalid)).rejects.toMatchObject({ status: 400 });
    }
    expect(upsertUserPreference).not.toHaveBeenCalled();
  });
});

describe('PUT /api/me/preferences/thinkingStyle', () => {
  it('accepts every known spinner style', async () => {
    for (const style of [
      'mercury',
      'cel',
      'neon',
      'chrome',
      'holo',
      'dither',
      'crystal',
      'velvet',
      'softtouch',
    ]) {
      expect((await put('thinkingStyle', { style })).status).toBe(200);
    }
  });
  it('rejects an unknown style or shape', async () => {
    for (const invalid of [{ style: 'lava' }, { style: 1 }, 'cel', null]) {
      await expect(put('thinkingStyle', invalid)).rejects.toMatchObject({ status: 400 });
    }
    expect(upsertUserPreference).not.toHaveBeenCalled();
  });
});
