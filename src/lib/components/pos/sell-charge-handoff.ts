import type { StoredCustomer } from './customer-storage';
import type { CartLine, SellCartSellable } from './SellCart.svelte';

export interface SellChargeIdentity {
  actorId: string;
  orgId: string;
}

export interface SellChargeHandoffInput {
  bookingId: string;
  productId: string | null;
  partyId?: string | null;
  customerName?: string | null;
  phone?: string | null;
  planId?: string | null;
}

export interface SellChargeHandoff {
  version: 1;
  actorId: string;
  orgId: string;
  bookingId: string;
  productId: string | null;
  partyId: string | null;
  customerName: string | null;
  phone: string | null;
  planId: string | null;
}

export interface SellChargeHandoffStage {
  handoff: SellChargeHandoff;
  lines: CartLine[];
  customer: StoredCustomer;
  pendingPlanId: string | null;
  notice: 'loaded' | 'missing';
}

export interface SellChargeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const MAX_ID_LENGTH = 200;
const MAX_NAME_LENGTH = 500;
const MAX_PHONE_LENGTH = 100;

function requiredString(value: unknown, maxLength = MAX_ID_LENGTH): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

function optionalString(value: unknown, maxLength = MAX_ID_LENGTH): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  const parsed = requiredString(value, maxLength);
  return parsed ?? undefined;
}

function normalizedIdentity(identity: SellChargeIdentity): SellChargeIdentity | null {
  const actorId = requiredString(identity.actorId);
  const orgId = requiredString(identity.orgId);
  return actorId && orgId ? { actorId, orgId } : null;
}

/** A browser handoff belongs to one authenticated actor in one organization. */
export function sellChargeStorageKey(identity: SellChargeIdentity): string {
  const normalized = normalizedIdentity(identity);
  if (!normalized) return '';
  return [
    'pos-charge',
    encodeURIComponent(normalized.actorId),
    encodeURIComponent(normalized.orgId),
  ].join(':');
}

/**
 * Old Hub builds used an organization-only key. It is inspected only to show a
 * recovery instruction; its payload is never parsed, claimed or deleted.
 */
export function legacySellChargeStorageKey(orgId: string): string {
  const normalized = requiredString(orgId);
  return normalized ? `pos-charge-${normalized}` : '';
}

export function createSellChargeHandoff(
  identity: SellChargeIdentity,
  input: SellChargeHandoffInput,
): SellChargeHandoff | null {
  const normalized = normalizedIdentity(identity);
  const bookingId = requiredString(input.bookingId);
  const productId = optionalString(input.productId);
  const partyId = optionalString(input.partyId);
  const customerName = optionalString(input.customerName, MAX_NAME_LENGTH);
  const phone = optionalString(input.phone, MAX_PHONE_LENGTH);
  const planId = optionalString(input.planId);
  if (
    !normalized ||
    !bookingId ||
    productId === undefined ||
    partyId === undefined ||
    customerName === undefined ||
    phone === undefined ||
    planId === undefined
  ) {
    return null;
  }
  return {
    version: 1,
    ...normalized,
    bookingId,
    productId,
    partyId,
    customerName,
    phone,
    planId,
  };
}

export function parseSellChargeHandoff(
  raw: string,
  identity: SellChargeIdentity,
): SellChargeHandoff | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return null;
  const actorId = requiredString(record.actorId);
  const orgId = requiredString(record.orgId);
  if (actorId !== identity.actorId.trim() || orgId !== identity.orgId.trim()) return null;
  const productId = optionalString(record.productId);
  const partyId = optionalString(record.partyId);
  const customerName = optionalString(record.customerName, MAX_NAME_LENGTH);
  const phone = optionalString(record.phone, MAX_PHONE_LENGTH);
  const planId = optionalString(record.planId);
  if (
    productId === undefined ||
    partyId === undefined ||
    customerName === undefined ||
    phone === undefined ||
    planId === undefined
  ) {
    return null;
  }
  return createSellChargeHandoff(
    { actorId, orgId },
    {
      bookingId: record.bookingId as string,
      productId,
      partyId,
      customerName,
      phone,
      planId,
    },
  );
}

export function stageSellChargeHandoff(
  handoff: SellChargeHandoff,
  sellables: readonly SellCartSellable[],
): SellChargeHandoffStage {
  const sellable = handoff.productId
    ? sellables.find((candidate) => candidate.productId === handoff.productId && candidate.active)
    : undefined;
  const lines: CartLine[] =
    !handoff.planId && sellable
      ? [
          {
            sellable,
            qty: 1,
            unitPrice: sellable.unitPrice,
            discount: 0,
            bookingId: handoff.bookingId,
          },
        ]
      : [];
  return {
    handoff,
    lines,
    customer: {
      partyId: handoff.partyId,
      customerName: handoff.customerName,
      customerPhone: handoff.phone,
      customerDocNumber: null,
    },
    pendingPlanId: handoff.planId,
    notice: handoff.planId || sellable ? 'loaded' : 'missing',
  };
}

/** Store and verify the draft before leaving the appointment page. */
export function dispatchSellChargeHandoff(options: {
  storage: () => SellChargeStorage | null;
  identity: SellChargeIdentity;
  input: SellChargeHandoffInput;
  navigate: () => void;
  onStorageFailure: () => void;
}): boolean {
  const handoff = createSellChargeHandoff(options.identity, options.input);
  const key = sellChargeStorageKey(options.identity);
  if (!handoff || !key) {
    options.onStorageFailure();
    return false;
  }
  const raw = JSON.stringify(handoff);
  try {
    const storage = options.storage();
    if (!storage) throw new Error('storage unavailable');
    storage.setItem(key, raw);
    if (storage.getItem(key) !== raw) throw new Error('handoff readback mismatch');
  } catch {
    options.onStorageFailure();
    return false;
  }
  options.navigate();
  return true;
}
