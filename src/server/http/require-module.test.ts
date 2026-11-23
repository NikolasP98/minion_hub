import { beforeEach, describe, expect, it, vi } from 'vitest';

const enabled = vi.hoisted(() => vi.fn());
vi.mock('$server/services/modules.service', () => ({ isModuleEnabled: enabled }));

import { requireModuleEnabled } from './require-module';

const ctx = { tenantId: 'org-1' } as never;

describe('requireModuleEnabled', () => {
  beforeEach(() => enabled.mockReset());

  it('returns when the module is on', async () => {
    enabled.mockResolvedValue(true);
    await expect(requireModuleEnabled(ctx, 'pos')).resolves.toBeUndefined();
    expect(enabled).toHaveBeenCalledWith(ctx, 'pos');
  });

  it('throws 404 module_disabled when the module is off', async () => {
    enabled.mockResolvedValue(false);
    await expect(requireModuleEnabled(ctx, 'pos')).rejects.toMatchObject({
      status: 404,
      body: { message: 'Not found', error: 'Not found', code: 'module_disabled' },
    });
  });
});
