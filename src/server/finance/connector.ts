export interface CanonicalLineItem {
  code: string | null;
  description: string | null;
  category: string | null;
  quantity: number | null;
  unitPrice: number | null;
  discount: number | null;
  tax: number | null;
  total: number | null;
  metadata: Record<string, unknown>;
}

export interface CanonicalPayment {
  providerRef: string | null;
  method: string | null;
  paidAt: string | null; // ISO
  amount: number | null;
  status: string | null;
  metadata: Record<string, unknown>;
}

export interface CanonicalClient {
  provider: string;
  providerRef: string;
  name: string | null;
  docType: string | null;
  docNumber: string | null; // RUC/DNI
  email: string | null;
  phone: string | null;
  metadata: Record<string, unknown>;
}

export interface CanonicalInvoice {
  provider: string;
  providerRef: string;
  number: string | null;
  documentId: string | null;
  issuedAt: string | null; // ISO
  clientName: string | null;
  clientDocType: string | null;
  clientDocNumber: string | null;
  clientEmail: string | null;
  currency: string | null;
  subtotal: number | null;
  tax: number | null;
  discount: number | null;
  total: number | null;
  status: string | null; // 'paid'|'partial'|'pending'|'void'
  seller: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
  items: CanonicalLineItem[];
  payments: CanonicalPayment[];
  client: CanonicalClient | null;
}

export interface PullOpts {
  config: Record<string, unknown>;
  secrets: Record<string, string>;
  since?: string;
}

export interface PullPage {
  invoices: CanonicalInvoice[];
  cursor: string | null; // resume token for the *next* page; null = drained
}
export interface PullPagesOpts extends PullOpts {
  cursor?: string | null; // resume from here instead of building the first page
}

export interface FinanceConnector {
  provider: string;
  pull(opts: PullOpts): AsyncIterable<CanonicalInvoice>;        // convenience wrapper over pullPages
  pullPages(opts: PullPagesOpts): AsyncIterable<PullPage>;      // resumable, batch + cursor
  count?(opts: PullOpts): Promise<number | null>;              // optional % baseline
}

const REGISTRY = new Map<string, FinanceConnector>();

export function registerConnector(c: FinanceConnector): void {
  REGISTRY.set(c.provider, c);
}

export function getConnector(provider: string): FinanceConnector | null {
  return REGISTRY.get(provider) ?? null;
}
