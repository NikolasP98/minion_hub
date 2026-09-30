import { describe, it, expect } from 'vitest';
import { TABLE_REGISTRY } from './index';

describe('stock.items TableDef', () => {
  it('no longer lists itemGroup/reorderQty/moq as core fields (moved to custom columns)', () => {
    const items = TABLE_REGISTRY.find((t) => t.id === 'stock.items');
    const keys = items?.fields.map((f) => f.key) ?? [];
    expect(keys).not.toContain('itemGroup');
    expect(keys).not.toContain('reorderQty');
    expect(keys).not.toContain('moq');
    // reorderLevel stays — it gates the low-stock alert.
    expect(keys).toContain('reorderLevel');
  });
});
