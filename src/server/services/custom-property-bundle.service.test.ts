import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  inspectAccess: vi.fn(),
  authorizeRecords: vi.fn(),
  listProperties: vi.fn(),
  readValues: vi.fn(),
}));

vi.mock('./custom-properties-access', () => ({
  inspectCustomPropertyAccess: mocks.inspectAccess,
}));
vi.mock('./custom-property-entities.service', () => ({
  authorizeCustomPropertyRecords: mocks.authorizeRecords,
}));
vi.mock('./custom-properties.service', () => ({
  listCustomProperties: mocks.listProperties,
  readCustomPropertyValues: mocks.readValues,
}));

import type { CoreCtx } from '$server/auth/core-ctx';
import { loadCustomPropertyBundle } from './custom-property-bundle.service';

const ctx = { tenantId: 'org-a', profileId: 'profile-a', db: {} } as CoreCtx;
const locals: App.Locals = {
  user: {
    id: 'user-a',
    supabaseId: 'profile-a',
    email: 'custom-properties@qa.minion.test',
    displayName: 'Custom properties tester',
    role: 'user',
  },
};

describe('loadCustomPropertyBundle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inspectAccess.mockResolvedValue({ canManage: true, canEdit: true });
    mocks.listProperties.mockResolvedValue([]);
    mocks.authorizeRecords.mockImplementation(
      async (_locals, _ctx, _tableId, recordIds: string[]) =>
        Object.fromEntries(recordIds.map((id) => [id, { canEdit: true }])),
    );
    mocks.readValues.mockImplementation(async (_ctx, _tableId, recordIds: string[]) =>
      Object.fromEntries(recordIds.map((id) => [id, {}])),
    );
  });

  it('authorizes and reads 501 requested records in bounded chunks without dropping records', async () => {
    const recordIds = Array.from({ length: 501 }, (_, index) => `record-${index}`);

    const bundle = await loadCustomPropertyBundle(locals, ctx, 'stock.items', recordIds);

    expect(mocks.authorizeRecords).toHaveBeenCalledTimes(2);
    expect(mocks.authorizeRecords.mock.calls.map((call) => call[3].length)).toEqual([500, 1]);
    expect(mocks.readValues).toHaveBeenCalledTimes(2);
    expect(mocks.readValues.mock.calls.map((call) => call[2].length)).toEqual([500, 1]);
    expect(Object.keys(bundle.recordAccess)).toHaveLength(501);
    expect(Object.keys(bundle.values)).toHaveLength(501);
    expect(bundle.recordAccess['record-500']).toEqual({ canEdit: true });
    expect(bundle.values['record-500']).toEqual({});
  });
});
