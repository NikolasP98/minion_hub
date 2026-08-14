import type { EmissionDocType, EmissionInvoice, EmissionLine } from '$server/finance/emission';

/**
 * Ticket -> EmissionInvoice mapping (spec 2026-08-14-pos-shadow-emission-spec
 * .md §3), pure and dependency-free on purpose: NO `$env`/`$server/db`/
 * `@vercel/functions` imports here, so `scripts/shadow-emit-test.ts` can
 * import it directly with plain `bun run` (no SvelteKit runtime, no virtual
 * `$env/*` modules to resolve). `pos-emission.service.ts` re-exports
 * everything from this module for the orchestration side.
 */

// ---- ticket -> EmissionInvoice mapping ----

/** The minimal shape of a customer's fiscal document, sourced from `parties`
 *  (`docType` there is free text — 'DNI'/'RUC'/'CE'/… — not the SUNAT catalog
 *  code; this module is the ONLY place that converts one to the other). */
export interface PartyDocInfo {
  docType: string | null;
  docNumber: string | null;
  name: string | null;
}

/**
 * docType decision (spec §3): '01' factura iff the customer's document is a
 * RUC, else the org's configured default ('03' boleta, `'01'` usable too if
 * an org ever configures it that way). Exported so the orchestrator can
 * resolve it ONCE, before allocateNumber needs it — `ticketToEmission` calls
 * this same function, so the two never drift apart.
 */
export function resolveEmissionDocType(
  customer: PartyDocInfo | null,
  docTypeDefault: EmissionDocType,
): EmissionDocType {
  return customer?.docType?.toUpperCase() === 'RUC' ? '01' : docTypeDefault;
}

const ANONYMOUS_CONSUMER = { docType: '1' as const, docNumber: '00000000', name: 'CLIENTE VARIOS' };

/** Legally valid below S/700 boleta convention (spec §3). At/above 700 with no
 *  document this function still returns a client (never blocks checkout) —
 *  the caller flags the resulting emission row `docRequired` instead. */
function resolveClient(customer: PartyDocInfo | null): EmissionInvoice['client'] {
  if (!customer?.docNumber) return ANONYMOUS_CONSUMER;
  const isRuc = customer.docType?.toUpperCase() === 'RUC';
  return {
    docType: isRuc ? '6' : '1',
    docNumber: customer.docNumber,
    name: customer.name ?? (isRuc ? customer.docNumber : ANONYMOUS_CONSUMER.name),
  };
}

export interface TicketEmissionLine {
  description: string;
  qty: string | number;
  total: string | number;
}

export interface TicketEmissionTotals {
  subtotal: string | number;
  total: string | number;
}

export interface EmitterConfig {
  ruc: string;
  razonSocial: string;
  ubigeo?: string;
  address?: string;
}

/** Minimal shape `ticketToEmission` needs from `PosSettings` — avoids pulling
 *  in the full pos.service.ts type graph. */
export interface EmissionSettingsInput {
  emission: { docTypeDefault: EmissionDocType };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Ticket -> EmissionInvoice (spec §3). Lines map 1:1; a ticket-level discount
 * is folded proportionally into each line's effective unit price by scaling
 * every PERSISTED line total by `ticket.total / ticket.subtotal` — those line
 * totals are exactly what `submitTicket`/`computeTicketTotals` wrote, so this
 * reuses the authoritative numbers instead of recomputing discount math.
 * `unitPriceInclTax` is IGV-inclusive; the emission library derives IGV from
 * it (`quantity * unitPriceInclTax`, see ubl.ts computeTotals) — never pass a
 * separately-discounted amount here, it would double-apply the discount.
 */
export function ticketToEmission(
  ticket: TicketEmissionTotals,
  lines: TicketEmissionLine[],
  customer: PartyDocInfo | null,
  settings: EmissionSettingsInput,
  allocation: { serie: string; correlativo: number },
  emitter: EmitterConfig,
): { invoice: EmissionInvoice; docRequired: boolean } {
  const docType = resolveEmissionDocType(customer, settings.emission.docTypeDefault);
  const client = resolveClient(customer);

  const total = Number(ticket.total);
  const subtotal = Number(ticket.subtotal);
  const ratio = subtotal > 0 ? total / subtotal : 1;
  const emissionLines: EmissionLine[] = lines.map((l) => {
    const qty = Number(l.qty);
    const adjustedTotal = Number(l.total) * ratio;
    return {
      description: l.description,
      quantity: qty,
      unitPriceInclTax: qty > 0 ? round2(adjustedTotal / qty) : 0,
    };
  });

  const invoice: EmissionInvoice = {
    docType,
    serie: allocation.serie,
    correlativo: String(allocation.correlativo),
    issueDate: new Date().toISOString().slice(0, 10),
    currency: 'PEN',
    emitter,
    client,
    lines: emissionLines,
  };

  // "Never block checkout" (spec §3) — docRequired is a data-quality FLAG on
  // the emission row, not a validation failure.
  const docRequired = total >= 700 && client.docType === '1' && client.docNumber === '00000000';
  return { invoice, docRequired };
}
