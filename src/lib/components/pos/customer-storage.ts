/**
 * Selected-customer persistence for /pos/sell — the same per-org localStorage
 * idiom as the cart lines. A refresh used to keep the cart but drop the client
 * (owner report 2026-09-17). Pure helpers so the parse/serialize rules have a
 * test; the page owns the storage calls.
 */
export interface StoredCustomer {
  partyId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerDocNumber: string | null;
}

export const EMPTY_CUSTOMER: StoredCustomer = {
  partyId: null,
  customerName: null,
  customerPhone: null,
  customerDocNumber: null,
};

export function customerStorageKey(orgId: string | null | undefined): string {
  return `pos-customer-${orgId ?? 'default'}`;
}

/** Tolerant parse: anything malformed or empty yields the empty customer. */
export function parseStoredCustomer(raw: string | null): StoredCustomer {
  if (!raw) return EMPTY_CUSTOMER;
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof StoredCustomer, unknown>>;
    const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x : null);
    const c = {
      partyId: str(v.partyId),
      customerName: str(v.customerName),
      customerPhone: str(v.customerPhone),
      customerDocNumber: str(v.customerDocNumber),
    };
    return hasCustomer(c) ? c : EMPTY_CUSTOMER;
  } catch {
    return EMPTY_CUSTOMER;
  }
}

export function hasCustomer(c: StoredCustomer): boolean {
  return !!(c.partyId || c.customerName || c.customerPhone || c.customerDocNumber);
}

/** `null` means "remove the key" (after a completed sale / cleared picker). */
export function serializeCustomer(c: StoredCustomer): string | null {
  return hasCustomer(c) ? JSON.stringify(c) : null;
}
