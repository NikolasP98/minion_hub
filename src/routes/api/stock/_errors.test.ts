import { describe, expect, it } from 'vitest';
import { StockError } from '$server/services/stock.service';
import { handleStockError } from './_errors';

describe('handleStockError', () => {
  it('throws an HttpError whose body has message, error and code', () => {
    try {
      handleStockError(new StockError('not a draft', 'not_draft'));
      expect.unreachable();
    } catch (e) {
      expect(e).toMatchObject({
        status: 409,
        body: { message: 'not a draft', error: 'not a draft', code: 'not_draft' },
      });
    }
  });

  it('re-throws anything else untouched', () => {
    const boom = new Error('boom');
    expect(() => handleStockError(boom)).toThrow(boom);
  });
});
