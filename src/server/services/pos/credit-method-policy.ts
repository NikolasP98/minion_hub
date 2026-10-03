import { createHash } from 'node:crypto';
import { PosError } from './errors';

export interface PaymentMethodPolicy {
  id: string;
  label: string;
  enabled: boolean;
  takesTendered: boolean;
  drawsOnCredit: boolean | null;
  requiresCreditDecision: boolean;
  surcharge?: { type: 'percent' | 'fixed'; amount: number };
  documentDefault?: '03' | '01' | null;
  sunat?: boolean;
}

/**
 * Settings writers choose whether a method draws on the customer wallet.
 * `requiresCreditDecision` is reader-derived compatibility state and must
 * never be accepted from a caller or persisted as an independent decision.
 */
export type PaymentMethodWrite = Omit<
  PaymentMethodPolicy,
  'drawsOnCredit' | 'requiresCreditDecision'
> & {
  drawsOnCredit: boolean;
};

function capitalize(value: string): string {
  return value.length ? value[0].toUpperCase() + value.slice(1) : value;
}

/** Reader compatibility preserves the ambiguous legacy `credit` identifier. */
export function normalizePaymentMethods(raw: unknown): PaymentMethodPolicy[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((candidate) => {
    if (typeof candidate === 'string') {
      const ambiguous = candidate === 'credit';
      return {
        id: candidate,
        label: capitalize(candidate),
        enabled: true,
        takesTendered: candidate === 'cash',
        drawsOnCredit: ambiguous ? null : false,
        requiresCreditDecision: ambiguous,
        documentDefault: null,
      };
    }
    const row = candidate as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id : '';
    const explicit = typeof row.drawsOnCredit === 'boolean';
    const ambiguous = id === 'credit' && !explicit;
    return {
      ...(row as unknown as Omit<PaymentMethodPolicy, 'drawsOnCredit' | 'requiresCreditDecision'>),
      id,
      drawsOnCredit: explicit ? (row.drawsOnCredit as boolean) : ambiguous ? null : false,
      requiresCreditDecision: ambiguous,
    };
  });
}

export function validatePaymentMethodsWrite(methods: readonly PaymentMethodWrite[]): void {
  if (!Array.isArray(methods) || methods.length === 0)
    throw new PosError('methods must be a non-empty array', 'invalid_methods');
  const seen = new Set<string>();
  let enabled = false;
  for (const method of methods) {
    if (!method || typeof method.id !== 'string' || !method.id || method.id !== method.id.toLowerCase())
      throw new PosError('method id must be a non-empty lowercase string', 'invalid_methods');
    if (seen.has(method.id))
      throw new PosError(`duplicate method id ${method.id}`, 'duplicate_method_id');
    seen.add(method.id);
    if (typeof method.drawsOnCredit !== 'boolean')
      throw new PosError('drawsOnCredit must be explicitly true or false', 'credit_method_decision_required');
    if (method.drawsOnCredit && method.takesTendered)
      throw new PosError('stored-value methods cannot take physical tender', 'invalid_credit_method');
    if (method.enabled) enabled = true;
    if (method.surcharge && !(method.surcharge.amount >= 0))
      throw new PosError('surcharge amount must be >= 0', 'invalid_surcharge');
  }
  if (!enabled) throw new PosError('at least one method must be enabled', 'invalid_methods');
}

export function paymentPolicyRevision(settings: {
  currency: string;
  methods: readonly PaymentMethodPolicy[];
  requireCustomer: boolean;
  allowPriceOverride: boolean;
  emission: { mode: string; docTypeDefault: string };
  requirements: Record<string, unknown>;
}): string {
  const projection = {
    version: 1,
    currency: settings.currency,
    methods: settings.methods.map((method) => ({
      id: method.id,
      label: method.label,
      enabled: method.enabled,
      takesTendered: method.takesTendered,
      drawsOnCredit: method.drawsOnCredit,
      requiresCreditDecision: method.requiresCreditDecision,
      surcharge: method.surcharge ?? null,
      documentDefault: method.documentDefault ?? null,
      sunat: method.sunat ?? true,
    })),
    requireCustomer: settings.requireCustomer,
    allowPriceOverride: settings.allowPriceOverride,
    emission: {
      mode: settings.emission.mode,
      docTypeDefault: settings.emission.docTypeDefault,
    },
    requirements: settings.requirements,
  };
  return createHash('sha256').update(JSON.stringify(projection)).digest('hex');
}
