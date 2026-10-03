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
    expect(validateTicketMoney(input(), DEFAULT_POS_SETTINGS)).toMatchObject({
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
      ),
    ).toThrowError(expect.objectContaining({ code: 'payment_mismatch' }));
  });
  it('rejects a one-cent cash-tender shortfall after exact normalization', () => {
    expect(() =>
      validateTicketMoney(
        input({ payments: [{ method: 'cash', amount: 1.01, tendered: 1 }] }),
        DEFAULT_POS_SETTINGS,
      ),
    ).toThrowError(expect.objectContaining({ code: 'invalid_tender' }));
  });
  it.each([NaN, Infinity, -0.001])('rejects nonfinite or negative payment %s', (amount) => {
    expect(() =>
      validateTicketMoney(
        input({ payments: [{ method: 'cash', amount }] }),
        DEFAULT_POS_SETTINGS,
      ),
    ).toThrowError(expect.objectContaining({ code: 'invalid_amount' }));
  });
  it('rejects unsupported currency for preview and submit through the same path', () => {
    expect(() =>
      validateTicketMoney(input(), { ...DEFAULT_POS_SETTINGS, currency: 'JPY' }),
    ).toThrowError(expect.objectContaining({ code: 'unsupported_pos_currency' }));
  });
  it('accepts a full displayed line discount without creating a negative half-cent', () => {
    const sale = input({
      lines: [
        { kind: 'service', description: 'fixture', qty: 1, unitPrice: 1.005, discount: 1.01 },
      ],
      payments: [],
    });
    expect(validateTicketMoney(sale, DEFAULT_POS_SETTINGS).total).toBe(0);
  });

  it('uses explicit stored-value flags rather than the legacy credit identifier', () => {
    const methods = [
      {
        id: 'credit',
        label: 'Credit card',
        enabled: true,
        takesTendered: false,
        drawsOnCredit: false,
        requiresCreditDecision: false,
      },
      {
        id: 'wallet-a',
        label: 'Wallet A',
        enabled: true,
        takesTendered: false,
        drawsOnCredit: true,
        requiresCreditDecision: false,
      },
      {
        id: 'wallet-b',
        label: 'Wallet B',
        enabled: true,
        takesTendered: false,
        drawsOnCredit: true,
        requiresCreditDecision: false,
      },
    ];
    const sale = input({
      lines: [{ kind: 'service', description: 'fixture', qty: 1, unitPrice: 3 }],
      payments: [
        { method: 'credit', amount: 1 },
        { method: 'wallet-a', amount: 1 },
        { method: 'wallet-b', amount: 1 },
      ],
    });
    expect(validateTicketMoney(sale, { ...DEFAULT_POS_SETTINGS, methods }).creditPaid).toBe(2);
  });

  it.each([
    {
      id: 'wallet',
      label: 'Disabled wallet',
      enabled: false,
      takesTendered: false,
      drawsOnCredit: true,
      requiresCreditDecision: false,
      code: 'invalid_method',
    },
    {
      id: 'credit',
      label: 'Ambiguous legacy credit',
      enabled: true,
      takesTendered: false,
      drawsOnCredit: null,
      requiresCreditDecision: true,
      code: 'credit_method_decision_required',
    },
  ])('rejects unavailable payment policy $id/$code', (method) => {
    expect(() =>
      validateTicketMoney(
        input({ payments: [{ method: method.id, amount: 1.01 }] }),
        { ...DEFAULT_POS_SETTINGS, methods: [method] },
      ),
    ).toThrowError(expect.objectContaining({ code: method.code }));
  });
});
