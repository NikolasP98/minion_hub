/**
 * Finances — invoices/items/clients, org settings, personal-org statement
 * imports + transactions, sync jobs, purchases (RCE) + periods.
 */
import { matrixUuid } from './ids';
import { ORG_BUSINESS, ORG_PERSONAL, userId } from './tenancy';
import type { SeedContext } from './db';

const INVOICE_SUSII_PAID = matrixUuid('fin.invoice.susii-paid');
const INVOICE_PARTIAL = matrixUuid('fin.invoice.partial');
const INVOICE_PENDING = matrixUuid('fin.invoice.pending');
const INVOICE_VOID = matrixUuid('fin.invoice.void');
const INVOICE_SUNAT_SHADOW = matrixUuid('fin.invoice.sunat-sire-shadow');
const INVOICE_LINKED_FROM_BOOKING = matrixUuid('fin.invoice.linked-from-booking');

export async function seed(ctx: SeedContext): Promise<void> {
  const { sql, register, now } = ctx;
  const owner = userId('tenancy.user.owner');

  const invoices: Array<{
    matrixId: string;
    id: string;
    provider: string;
    providerRef: string;
    status: string;
    shadowed?: boolean;
  }> = [
    {
      matrixId: 'fin.invoice.susii-paid',
      id: INVOICE_SUSII_PAID,
      provider: 'susii',
      providerRef: 'QA-SUSII-0001',
      status: 'paid',
    },
    {
      matrixId: 'fin.invoice.partial',
      id: INVOICE_PARTIAL,
      provider: 'susii',
      providerRef: 'QA-SUSII-0002',
      status: 'partial',
    },
    {
      matrixId: 'fin.invoice.pending',
      id: INVOICE_PENDING,
      provider: 'susii',
      providerRef: 'QA-SUSII-0003',
      status: 'pending',
    },
    {
      matrixId: 'fin.invoice.void',
      id: INVOICE_VOID,
      provider: 'susii',
      providerRef: 'QA-SUSII-0004',
      status: 'void',
    },
    {
      matrixId: 'fin.invoice.sunat-sire-shadow',
      id: INVOICE_SUNAT_SHADOW,
      provider: 'sunat-sire',
      providerRef: 'QA-SUSII-0001',
      status: 'paid',
      shadowed: true,
    },
    {
      matrixId: 'fin.invoice.linked-from-booking',
      id: INVOICE_LINKED_FROM_BOOKING,
      provider: 'susii',
      providerRef: 'QA-SUSII-0005',
      status: 'paid',
    },
  ];
  for (const inv of invoices) {
    await sql`
      insert into fin_invoices (id, org_id, provider, provider_ref, number, issued_at, client_name, client_doc_type, client_doc_number, currency, subtotal, tax, total, status, shadowed)
      values (
        ${inv.id}, ${ORG_BUSINESS}, ${inv.provider}, ${inv.providerRef}, ${inv.providerRef}, ${now.toISOString()},
        'QA Invoice Client', 'DNI', '10000001', 'PEN', 100.00, 18.00, 118.00, ${inv.status}, ${inv.shadowed ?? false}
      )
      on conflict (org_id, provider, provider_ref) do update set status = excluded.status, shadowed = excluded.shadowed
    `;
    register(inv.matrixId, { table: 'fin_invoices', where: { id: inv.id } });
  }

  await sql`
    insert into fin_settings (org_id, currency, tax_rate, fx_mode, fx_manual_rate)
    values (${ORG_BUSINESS}, 'PEN', 0.18, 'manual', 3.75)
    on conflict (org_id) do update set fx_mode = excluded.fx_mode, fx_manual_rate = excluded.fx_manual_rate
  `;
  register('fin.settings.fx-manual', { table: 'fin_settings', where: { org_id: ORG_BUSINESS } });

  // ── Personal-org statement imports (one per status incl. undone) ──────
  const importStatuses = [
    ['fin.statement.queued', 'queued'],
    ['fin.statement.parsing', 'parsing'],
    ['fin.statement.done', 'done'],
    ['fin.statement.failed', 'failed'],
    ['fin.statement.undone', 'undone'],
  ] as const;
  for (const [matrixId, status] of importStatuses) {
    const id = matrixUuid(matrixId);
    const sha = matrixUuid(matrixId, 'sha256').replace(/-/g, '');
    await sql`
      insert into fin_statement_imports (id, org_id, source_kind, content_sha256, parser_version, status, row_count, inserted_count, rejected_count, error_code, error_message, created_by, finished_at)
      values (
        ${id}, ${ORG_PERSONAL}, 'csv', ${sha}, 1, ${status},
        ${status === 'done' ? 2 : null}, ${status === 'done' ? 1 : null}, ${status === 'done' ? 1 : null},
        ${status === 'failed' ? 'PARSE_ERROR' : null}, ${status === 'failed' ? 'QA: malformed CSV row 3' : null},
        ${owner}, ${status === 'done' || status === 'failed' || status === 'undone' ? now.toISOString() : null}
      )
      on conflict (org_id, content_sha256) do update set status = excluded.status
    `;
    register(matrixId, { table: 'fin_statement_imports', where: { id } });
  }
  const doneImportId = matrixUuid('fin.statement.done');
  await sql`
    insert into fin_transactions (id, org_id, import_id, source_row, posted_on, description, signed_amount, currency, raw)
    values
      (${matrixUuid('fin.statement.done', 'row-1')}, ${ORG_PERSONAL}, ${doneImportId}, 1, '2026-01-05', 'QA accepted row', 150.00, 'PEN', ${sql.json({ rejected: false })}),
      (${matrixUuid('fin.statement.done', 'row-2')}, ${ORG_PERSONAL}, ${doneImportId}, 2, '2026-01-06', 'QA rejected row (unparseable amount)', 0, 'PEN', ${sql.json({ rejected: true, reason: 'unparseable amount' })})
    on conflict (import_id, source_row) do nothing
  `;

  const stuckJobId = matrixUuid('fin.sync.stuck-running');
  const staleHeartbeat = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
  await sql`
    insert into fin_sync_jobs (id, org_id, provider, status, total, processed, started_at, heartbeat_at)
    values (${stuckJobId}, ${ORG_BUSINESS}, 'susii', 'running', 500, 120, ${staleHeartbeat}, ${staleHeartbeat})
    on conflict (id) do update set status = excluded.status, heartbeat_at = excluded.heartbeat_at
  `;
  register('fin.sync.stuck-running', { table: 'fin_sync_jobs', where: { id: stuckJobId } });

  const closedPeriodId = matrixUuid('fin.purchase.closed-period');
  await sql`
    insert into fin_purchase_periods (id, org_id, period, status, doc_count, base_gravada, igv, total)
    values (${closedPeriodId}, ${ORG_BUSINESS}, '202601', 'closed', 3, 1000.00, 180.00, 1180.00)
    on conflict (org_id, period) do update set status = excluded.status
  `;
  register('fin.purchase.closed-period', {
    table: 'fin_purchase_periods',
    where: { id: closedPeriodId },
  });

  const divergedPurchaseId = matrixUuid('fin.purchase.diverged');
  await sql`
    insert into fin_purchases (id, org_id, source, provider_ref, period, supplier_ruc, supplier_name, doc_type, serie, numero, period_status, sync_state, total)
    values (${divergedPurchaseId}, ${ORG_BUSINESS}, 'sunat', 'QA-RCE-0001', '202601', '20100000002', 'QA Supplier SAC', '01', 'F001', '123', 'closed', 'diverged', 236.00)
    on conflict (org_id, provider_ref) where provider_ref is not null do update set sync_state = excluded.sync_state
  `;
  register('fin.purchase.diverged', { table: 'fin_purchases', where: { id: divergedPurchaseId } });
}
