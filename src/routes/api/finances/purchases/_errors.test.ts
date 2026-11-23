import { describe, expect, it } from 'vitest';
import { PurchasesError } from '$server/services/purchases.service';
import { handlePurchasesError } from './_errors';

describe('handlePurchasesError', () => {
  it('returns the shared envelope with the table status', async () => {
    const res = handlePurchasesError(new PurchasesError('closed', 'period_closed'));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ message: 'closed', error: 'closed', code: 'period_closed' });
  });

  it('defaults to 400 and re-throws anything else', () => {
    expect(handlePurchasesError(new PurchasesError('x', 'weird')).status).toBe(400);
    const boom = new Error('boom');
    expect(() => handlePurchasesError(boom)).toThrow(boom);
  });
});
