import type { StoredCustomer } from './customer-storage';
import type { CartLine, SellCartSellable } from './SellCart.svelte';

export interface SellChargeIdentity {
  actorId: string;
  orgId: string;
}

/**
 * ONE line of the charged event: the booking row the cart line rings up, the
 * catalog product that prices it (null = not in the catalog), and a
 * cashier-facing title. `kind`/`qty` are v3 (spec
 * 2026-10-10-hub-catalog-service-unification §Slice 4): a SERVICE line is
 * always qty 1 (the appointment itself); a PRODUCT line carries the
 * anchor's `bookingId` too, so `pos_ticket_lines.booking_id` links it to the
 * event — but can be any qty ≥ 1, same as the cart's own qty stepper.
 */
export interface SellChargeLine {
  bookingId: string;
  productId: string | null;
  title: string;
  kind: 'service' | 'product';
  qty: number;
}

/** Input shape: `kind`/`qty` are optional — every caller before Slice 4 only
 *  ever sent services, so omitting them still defaults to `service`/`1`, the
 *  exact v2 behavior, for both a fresh handoff and (via `normalizedLines`) a
 *  parsed v1/v2 blob that never had the fields at all. */
export interface SellChargeLineInput {
  bookingId: string;
  productId: string | null;
  title: string;
  kind?: 'service' | 'product';
  qty?: number;
}

export interface SellChargeHandoffInput {
  /** An appointment is ONE event with MANY services and, since Slice 4, its
   *  product lines too — every line the tray offered for payment, in order.
   *  Never empty. */
  lines: readonly SellChargeLineInput[];
  partyId?: string | null;
  customerName?: string | null;
  phone?: string | null;
  planId?: string | null;
}

export interface SellChargeHandoff {
  version: 3;
  actorId: string;
  orgId: string;
  lines: SellChargeLine[];
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
  /** `partial` = some services made it into the cart and some did not. */
  notice: 'loaded' | 'missing' | 'partial';
  /** Services whose product is not an active sellable — the cashier adds those
   *  lines by hand, so the count has to reach the toast. */
  missingLines: number;
}

export interface SellChargeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const MAX_ID_LENGTH = 200;
/** One event's services. A blob claiming more is not a tray handoff. */
const MAX_LINES = 50;
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

/** `undefined` (absent — a v1/v2 line, or a fresh service line) defaults to
 *  `'service'`; present, it must be one of the two known kinds. Anything
 *  else is a malformed line, same as a bad `bookingId`. */
function normalizedKind(value: unknown): 'service' | 'product' | undefined {
  if (value === undefined) return 'service';
  return value === 'service' || value === 'product' ? value : undefined;
}

/** `undefined` (absent) defaults to `1`; present, it must be a finite
 *  positive number. */
function normalizedQty(value: unknown): number | undefined {
  if (value === undefined) return 1;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Every line or nothing: a handoff that silently dropped a service or
 *  product would charge the client less than the tray offered. */
function normalizedLines(value: unknown): SellChargeLine[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_LINES) return null;
  const lines: SellChargeLine[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const record = entry as Record<string, unknown>;
    const bookingId = requiredString(record.bookingId);
    const productId = optionalString(record.productId);
    const kind = normalizedKind(record.kind);
    const qty = normalizedQty(record.qty);
    if (
      !bookingId ||
      productId === undefined ||
      typeof record.title !== 'string' ||
      !kind ||
      qty === undefined
    )
      return null;
    lines.push({
      bookingId,
      productId,
      title: record.title.trim().slice(0, MAX_NAME_LENGTH),
      kind,
      qty,
    });
  }
  return lines;
}

export function createSellChargeHandoff(
  identity: SellChargeIdentity,
  input: SellChargeHandoffInput,
): SellChargeHandoff | null {
  const normalized = normalizedIdentity(identity);
  const lines = normalizedLines(input.lines);
  const partyId = optionalString(input.partyId);
  const customerName = optionalString(input.customerName, MAX_NAME_LENGTH);
  const phone = optionalString(input.phone, MAX_PHONE_LENGTH);
  const planId = optionalString(input.planId);
  if (
    !normalized ||
    !lines ||
    partyId === undefined ||
    customerName === undefined ||
    phone === undefined ||
    planId === undefined
  ) {
    return null;
  }
  return {
    version: 3,
    ...normalized,
    lines,
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
  // v3 lines carry kind/qty; a v2 blob's lines lack both, and `normalizedLines`
  // (via `createSellChargeHandoff`, below) defaults them to service/1 — the
  // exact v2 behavior, so a v2 blob still parses with no special-casing here.
  if (record.version !== 1 && record.version !== 2 && record.version !== 3) return null;
  const actorId = requiredString(record.actorId);
  const orgId = requiredString(record.orgId);
  if (actorId !== identity.actorId.trim() || orgId !== identity.orgId.trim()) return null;
  // v1 was strictly one booking + one product; it reads as a single-line
  // service (v2 and v3 both carry `lines` directly; v3's optional kind/qty
  // default to service/1 when absent, which is exactly what v2's lines are).
  const lines =
    record.version === 1
      ? [{ bookingId: record.bookingId, productId: record.productId ?? null, title: '' }]
      : record.lines;
  const partyId = optionalString(record.partyId);
  const customerName = optionalString(record.customerName, MAX_NAME_LENGTH);
  const phone = optionalString(record.phone, MAX_PHONE_LENGTH);
  const planId = optionalString(record.planId);
  if (
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
      lines: lines as SellChargeLineInput[],
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
  // One cart line per service/product whose catalog row is still an active
  // sellable, each at the handoff's own qty (always 1 for a service; a
  // product can be more) — `bookingId` rides along on BOTH kinds, so a
  // product line still links to the event's anchor at submit time (spec
  // 2026-10-10-hub-catalog-service-unification §Slice 4 D10). An instalment
  // charge rings up the PLAN, not the services, so it stages none.
  const lines: CartLine[] = handoff.planId
    ? []
    : handoff.lines.flatMap((line) => {
        const sellable = line.productId
          ? sellables.find(
              (candidate) => candidate.productId === line.productId && candidate.active,
            )
          : undefined;
        return sellable
          ? [
              {
                sellable,
                qty: line.qty,
                unitPrice: sellable.unitPrice,
                discount: 0,
                bookingId: line.bookingId,
              },
            ]
          : [];
      });
  const missingLines = handoff.planId ? 0 : handoff.lines.length - lines.length;
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
    notice: missingLines === 0 ? 'loaded' : lines.length > 0 ? 'partial' : 'missing',
    missingLines,
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
