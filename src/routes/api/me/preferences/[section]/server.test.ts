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

const put = (section: string, value: unknown) =>
  PUT!({
    locals: {},
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
