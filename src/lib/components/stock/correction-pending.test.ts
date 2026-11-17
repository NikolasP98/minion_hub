import { describe, expect, it } from 'vitest';
import {
  RecoveryStorageUnavailable,
  decodePendingCorrectionV1,
  dismissAppliedPendingCorrection,
  pendingCorrectionKey,
  persistPendingCorrection,
  readPendingCorrections,
  type PendingCorrectionV1,
} from './correction-pending';
import { KNOWN_REFUSAL_CODES, correctionRefusal } from './correction-refusals';
import { CORRECTION_STATUS } from '$server/services/stock-corrections.logic';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rec = (over: Partial<PendingCorrectionV1> = {}): PendingCorrectionV1 => ({
  schemaVersion: 1,
  orgId: U(1),
  profileId: U(2),
  sourceType: 'pos_ticket_line',
  sourceId: U(3),
  operationKey: U(4),
  previewHash: 'a'.repeat(64),
  payloadHash: 'b'.repeat(64),
  ...over,
});
const scope = {
  orgId: U(1),
  profileId: U(2),
  sourceType: 'pos_ticket_line' as const,
  sourceId: U(3),
};
/** Minimal Storage with an iterable key order, like the browser's. */
function memory(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
  };
}

describe('pending correction pointer', () => {
  it('decodes exact keys only', () => {
    expect(decodePendingCorrectionV1(rec())).toEqual(rec());
    expect(() => decodePendingCorrectionV1({ ...rec(), reason: 'x' })).toThrow(
      RecoveryStorageUnavailable,
    );
    expect(() => decodePendingCorrectionV1(rec({ payloadHash: 'zz' }))).toThrow();
    expect(() => decodePendingCorrectionV1(rec({ orgId: 'org-a' }))).toThrow();
  });

  it('persists once, reads back by scope and is idempotent for identical bytes', () => {
    const s = memory();
    persistPendingCorrection(s, rec());
    persistPendingCorrection(s, rec());
    expect(s.length).toBe(1);
    expect(readPendingCorrections(s, scope)).toEqual([rec()]);
    expect(readPendingCorrections(s, { ...scope, profileId: U(9) })).toEqual([]);
    expect(readPendingCorrections(s, { ...scope, sourceId: U(8) })).toEqual([]);
  });

  it('two operations on one source keep independent keys; the bytes hold no reason or amounts', () => {
    const s = memory();
    persistPendingCorrection(s, rec());
    persistPendingCorrection(s, rec({ operationKey: U(5) }));
    expect(readPendingCorrections(s, scope)).toHaveLength(2);
    expect(Object.keys(JSON.parse(s.getItem(pendingCorrectionKey(rec()))!)).sort()).toEqual(
      Object.keys(rec()).sort(),
    );
  });

  it('refuses conflicting bytes, a corrupt matching record, a full quota and a failing storage', () => {
    const s = memory();
    persistPendingCorrection(s, rec());
    s.setItem(pendingCorrectionKey(rec()), '{"schemaVersion":1}');
    expect(() => persistPendingCorrection(s, rec())).toThrow(RecoveryStorageUnavailable);
    expect(() => readPendingCorrections(s, scope)).toThrow(RecoveryStorageUnavailable);
    const full = memory();
    for (let i = 0; i < 20; i += 1)
      persistPendingCorrection(full, rec({ operationKey: U(100 + i) }));
    expect(() => persistPendingCorrection(full, rec({ operationKey: U(500) }))).toThrow(
      RecoveryStorageUnavailable,
    );
    const broken = {
      ...memory(),
      setItem: () => {
        throw new Error('quota');
      },
    } as Storage;
    expect(() => persistPendingCorrection(broken, rec())).toThrow(RecoveryStorageUnavailable);
  });

  it('dismisses only after a matching applied receipt, and only that pointer', () => {
    const s = memory();
    persistPendingCorrection(s, rec());
    persistPendingCorrection(s, rec({ operationKey: U(5) }));
    expect(() => dismissAppliedPendingCorrection(s, rec(), { outcome: 'not_found' })).toThrow(
      RecoveryStorageUnavailable,
    );
    expect(() =>
      dismissAppliedPendingCorrection(s, rec(), {
        outcome: 'applied',
        receipt: { operationKey: U(5), sourceId: U(3) },
      }),
    ).toThrow();
    dismissAppliedPendingCorrection(s, rec(), {
      outcome: 'applied',
      receipt: { operationKey: U(4), sourceId: U(3) },
    });
    expect(readPendingCorrections(s, scope).map((r) => r.operationKey)).toEqual([U(5)]);
  });
});

describe('correction refusals', () => {
  it('every refusal the API can return has its own translated next step', () => {
    const generic = correctionRefusal('nope');
    for (const code of Object.keys(CORRECTION_STATUS)) {
      expect(KNOWN_REFUSAL_CODES).toContain(code);
      expect(correctionRefusal(code)).not.toBe(generic);
    }
  });
});
