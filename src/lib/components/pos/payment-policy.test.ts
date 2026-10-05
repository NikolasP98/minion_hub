import { describe, expect, it } from 'vitest';
import { cashierPaymentMethods, creditPayments, paymentPolicyIssue } from './payment-policy';

const methods = [
  {
    id: 'credit',
    label: 'Named credit but external',
    enabled: true,
    takesTendered: false,
    drawsOnCredit: false,
    requiresCreditDecision: false,
  },
  {
    id: 'wallet-card',
    label: 'Wallet',
    enabled: true,
    takesTendered: false,
    drawsOnCredit: true,
    requiresCreditDecision: false,
  },
  {
    id: 'legacy',
    label: 'Needs review',
    enabled: true,
    takesTendered: false,
    drawsOnCredit: null,
    requiresCreditDecision: true,
  },
  {
    id: 'disabled-wallet',
    label: 'Disabled',
    enabled: false,
    takesTendered: false,
    drawsOnCredit: true,
    requiresCreditDecision: false,
  },
] as const;

describe('cashier payment policy projection', () => {
  it('preserves explicit wallet semantics instead of inferring them from method ids', () => {
    expect(cashierPaymentMethods(methods)).toEqual([
      expect.objectContaining({ id: 'credit', drawsOnCredit: false }),
      expect.objectContaining({ id: 'wallet-card', drawsOnCredit: true }),
      expect.objectContaining({
        id: 'legacy',
        drawsOnCredit: null,
        requiresCreditDecision: true,
      }),
    ]);

    const payments = [
      { method: 'credit', amount: 1, tendered: null, takesTendered: false },
      { method: 'wallet-card', amount: 2, tendered: null, takesTendered: false },
      { method: 'disabled-wallet', amount: 3, tendered: null, takesTendered: false },
    ];
    expect(creditPayments(payments, methods)).toEqual([payments[1]]);
  });

  it('blocks unavailable and unresolved methods while accepting explicit external methods', () => {
    expect(paymentPolicyIssue([{ method: 'credit' }], methods)).toBeNull();
    expect(paymentPolicyIssue([{ method: 'legacy' }], methods)).toBe('credit_decision_required');
    expect(paymentPolicyIssue([{ method: 'disabled-wallet' }], methods)).toBe('method_unavailable');
  });
});
