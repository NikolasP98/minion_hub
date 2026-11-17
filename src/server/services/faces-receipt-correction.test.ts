import { describe, expect, it, vi } from 'vitest';

vi.mock('@minion-stack/cache', () => ({
  cached: (_k: unknown, _o: unknown, fn: () => unknown) => fn(),
  keys: { hub: () => 'k' },
  tags: { tenantDomain: () => [] },
  invalidateTags: async () => undefined,
}));
import {
  RECEIPT_CORRECTION_EXIT,
  ReceiptCorrectionError,
  mapHelperRefusal,
} from './faces-receipt-correction.logic';
import {
  applyReceiptCorrection,
  getReceiptCorrectionStatus,
  previewReceiptCorrection,
} from './faces-receipt-correction.service';

const U = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
/** A ctx whose database throws if it is ever touched: invalid input must be refused before any read. */
const ctx = (profileId: string | null = U(2)) =>
  ({
    db: new Proxy(
      {},
      {
        get: () => {
          throw new Error('database touched');
        },
      },
    ),
    tenantId: U(1),
    profileId,
  }) as never;
const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof ReceiptCorrectionError ? e.code : `other:${(e as Error).message}`;
  }
  return null;
};

describe('receipt correction service boundary (no database)', () => {
  it('refuses malformed manifest, command and status input before any read', async () => {
    expect(await code(previewReceiptCorrection(ctx(), {}))).toBe('invalid_manifest');
    expect(await code(previewReceiptCorrection(ctx(), { schemaVersion: 1, extra: 1 }))).toBe(
      'invalid_manifest',
    );
    expect(
      await code(applyReceiptCorrection(ctx(), { manifest: {} }, { id: U(2), name: 'x' })),
    ).toBe('invalid_command');
    expect(await code(getReceiptCorrectionStatus(ctx(), null))).toBe('invalid_command');
  });
  it('maps every helper refusal to a fixed code and exit', () => {
    expect(mapHelperRefusal('posted_at_out_of_order')).toBe('period_unavailable');
    expect(mapHelperRefusal('negative_stock')).toBe('invariant_failed');
    expect(mapHelperRefusal('not_draft')).toBe('source_conflict');
    expect(mapHelperRefusal('module_disabled')).toBe('actor_unavailable');
    expect(mapHelperRefusal(undefined, '40001')).toBe('read_unavailable');
    expect(mapHelperRefusal(undefined, '57014')).toBe('read_unavailable');
    expect(RECEIPT_CORRECTION_EXIT).toMatchObject({
      invalid_manifest: 2,
      read_unavailable: 3,
      stale_preview: 4,
      commit_outcome_unknown: 5,
    });
  });
  it('error text is the fixed code only', () => {
    expect(new ReceiptCorrectionError('stale_preview').message).toBe('stale_preview');
  });
});
