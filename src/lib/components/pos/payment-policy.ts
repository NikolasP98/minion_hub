import type { PaymentMethodOption, PaymentRow } from './PaymentPanel.svelte';

export interface PaymentMethodPolicyProjection {
  id: string;
  label: string;
  enabled: boolean;
  takesTendered: boolean;
  drawsOnCredit: boolean | null;
  requiresCreditDecision: boolean;
}

export type PaymentPolicyIssue = 'method_unavailable' | 'credit_decision_required';

export function cashierPaymentMethods(
  methods: readonly PaymentMethodPolicyProjection[],
): PaymentMethodOption[] {
  return methods
    .filter((method) => method.enabled)
    .map((method) => ({
      id: method.id,
      label: method.label,
      takesTendered: method.takesTendered,
      drawsOnCredit: method.drawsOnCredit,
      requiresCreditDecision: method.requiresCreditDecision,
    }));
}

export function paymentPolicyIssue(
  payments: readonly Pick<PaymentRow, 'method'>[],
  methods: readonly PaymentMethodPolicyProjection[],
): PaymentPolicyIssue | null {
  const enabled = new Map(
    methods.filter((method) => method.enabled).map((method) => [method.id, method]),
  );
  for (const payment of payments) {
    const method = enabled.get(payment.method);
    if (!method) return 'method_unavailable';
    if (method.requiresCreditDecision || method.drawsOnCredit === null) {
      return 'credit_decision_required';
    }
  }
  return null;
}

export function creditPayments(
  payments: readonly PaymentRow[],
  methods: readonly PaymentMethodPolicyProjection[],
): PaymentRow[] {
  const creditIds = new Set(
    methods
      .filter(
        (method) =>
          method.enabled && !method.requiresCreditDecision && method.drawsOnCredit === true,
      )
      .map((method) => method.id),
  );
  return payments.filter((payment) => creditIds.has(payment.method));
}
