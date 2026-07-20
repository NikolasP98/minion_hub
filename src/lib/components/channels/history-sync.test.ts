import { describe, it, expect } from 'vitest';
import {
  readGlobalHistorySync,
  readAccountHistorySync,
  selectedChoice,
  effectiveMode,
  historySyncPatch,
  INHERIT,
} from './history-sync';

describe('history-sync', () => {
  it('treats an unset/garbage global as full', () => {
    expect(readGlobalHistorySync(undefined)).toBe('full');
    expect(readGlobalHistorySync({})).toBe('full');
    expect(readGlobalHistorySync({ gateway: { messageLedger: {} } })).toBe('full');
    expect(readGlobalHistorySync({ gateway: { messageLedger: { historySync: 'nope' } } })).toBe(
      'full',
    );
    expect(readGlobalHistorySync({ gateway: { messageLedger: { historySync: 'off' } } })).toBe(
      'off',
    );
  });

  it('reads an account override, null when absent', () => {
    const cfg = {
      channels: { whatsapp: { accounts: { '+51999': { historySync: 'recent' }, '+51888': {} } } },
    };
    expect(readAccountHistorySync(cfg, '+51999')).toBe('recent');
    expect(readAccountHistorySync(cfg, '+51888')).toBe(null);
    expect(readAccountHistorySync(cfg, 'missing')).toBe(null);
    expect(readAccountHistorySync(cfg, null)).toBe(null);
  });

  it('inherits the global when there is no override', () => {
    expect(selectedChoice('account', 'recent', null)).toBe(INHERIT);
    expect(effectiveMode(INHERIT, 'recent')).toBe('recent');
    expect(selectedChoice('account', 'recent', 'off')).toBe('off');
    expect(effectiveMode('off', 'recent')).toBe('off');
    expect(selectedChoice('global', 'off', null)).toBe('off');
  });

  it('clears an override with merge-patch null and never nulls the global', () => {
    expect(historySyncPatch('+51999', INHERIT)).toEqual({
      channels: { whatsapp: { accounts: { '+51999': { historySync: null } } } },
    });
    expect(historySyncPatch('+51999', 'full')).toEqual({
      channels: { whatsapp: { accounts: { '+51999': { historySync: 'full' } } } },
    });
    expect(historySyncPatch(null, 'off')).toEqual({
      gateway: { messageLedger: { historySync: 'off' } },
    });
    expect(historySyncPatch(null, INHERIT)).toEqual({
      gateway: { messageLedger: { historySync: 'full' } },
    });
  });
});
