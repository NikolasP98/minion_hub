import { describe, expect, it } from 'vitest';
import { validateTicketMoney } from './ticket-money';
import { DEFAULT_POS_SETTINGS, type SubmitTicketInput } from '../pos.service';

const input = (patch: Partial<SubmitTicketInput> = {}) => ({
  lines: [{ kind: 'service' as const, description: 'fixture', qty: 1, unitPrice: 1.005 }],
  payments: [{ method: 'cash', amount: 1.005, tendered: 2 }],
  ...patch,
});

describe('preview and sale money admission', () => {
  it('normalizes each payment once and preserves the change-bearing tender', () => {
    expect(validateTicketMoney(input(), DEFAULT_POS_SETTINGS, 'credit')).toMatchObject({
      subtotal: 1.01,
      total: 1.01,
      payments: [{ method: 'cash', amount: 1.01, tendered: 2 }],
    });
  });
  it('rejects one-cent underpayment without epsilon tolerance', () => {
    expect(() =>
      validateTicketMoney(
        input({ payments: [{ method: 'cash', amount: 1 }] }),
        DEFAULT_POS_SETTINGS,
        'credit',
      ),
    ).toThrowError(expect.objectContaining({ code: 'payment_mismatch' }));
  });
  it('rejects a one-cent cash-tender shortfall after exact normalization', () => {
    expect(() =>
      validateTicketMoney(
        input({ payments: [{ method: 'cash', amount: 1.01, tendered: 1 }] }),
        DEFAULT_POS_SETTINGS,
        'credit',
      ),
    ).toThrowError(expect.objectContaining({ code: 'invalid_tender' }));
  });
  it.each([NaN, Infinity, -0.001])('rejects nonfinite or negative payment %s', (amount) => {
    expect(() =>
      validateTicketMoney(
        input({ payments: [{ method: 'cash', amount }] }),
        DEFAULT_POS_SETTINGS,
        'credit',
      ),
    ).toThrowError(expect.objectContaining({ code: 'invalid_amount' }));
  });
  it('rejects unsupported currency for preview and submit through the same path', () => {
    expect(() =>
      validateTicketMoney(input(), { ...DEFAULT_POS_SETTINGS, currency: 'JPY' }, 'credit'),
    ).toThrowError(expect.objectContaining({ code: 'unsupported_pos_currency' }));
  });
  it('accepts a full displayed line discount without creating a negative half-cent', () => {
    const sale = input({
      lines: [
        { kind: 'service', description: 'fixture', qty: 1, unitPrice: 1.005, discount: 1.01 },
      ],
      payments: [],
    });
    expect(validateTicketMoney(sale, DEFAULT_POS_SETTINGS, 'credit').total).toBe(0);
  });
});
