/**
 * Shared context type + loopback guard for the QA seed. Mirrors the
 * loopback-only semantics of scripts/qc/disposable-postgres.ts (never trust
 * an app .env; refuse anything that isn't 127.0.0.1/localhost/::1) without
 * that script's single-fixture-database restriction, since the QA stack is a
 * whole disposable Supabase project, not a per-test throwaway schema.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type postgres from 'postgres';
import type { Client as LibsqlClient } from '@libsql/client';

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * Throws unless `rawUrl` is a `postgres(ql)://` or `http(s)://` URL pointing
 * at a loopback host, or a `file:` URL (always local). Every script that
 * touches a database or the GoTrue admin API calls this before connecting.
 */
export function assertLoopback(rawUrl: string | undefined, label: string): string {
  if (!rawUrl) throw new Error(`${label} is required`);
  if (rawUrl.startsWith('file:')) return rawUrl;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${label} is not a valid URL`);
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (!LOOPBACK_HOSTNAMES.has(hostname)) {
    throw new Error(
      `Refusing non-loopback host for ${label}: "${hostname}". The QA seed only ever targets ` +
        '127.0.0.1/localhost/::1 — production and every shared/staging project are forbidden targets.',
    );
  }
  return rawUrl;
}

/** A matrix-id -> row pointer, registered by every domain module as it writes
 *  a fixture. The contract test walks this to verify coverage + existence.
 *  `expect: 'absent'` (default 'present') registers a CONTRAST instead — the
 *  matrix id's whole point is that no row matches `where` (e.g. an org that
 *  deliberately carries no `crm_settings` row). Same generic mechanism, the
 *  contract test just flips the assertion. */
export interface RowRef {
  table: string;
  where: Record<string, string | number | boolean | null>;
  expect?: 'present' | 'absent';
}

export type Register = (matrixId: string, ref: RowRef) => void;

export interface SeedContext {
  /** postgres.js client connected as the `postgres` superuser — bypasses RLS
   *  (FORCE ROW LEVEL SECURITY only binds non-superuser roles). */
  sql: ReturnType<typeof postgres>;
  /** Supabase service-role client — used ONLY for `auth.admin.*` (GoTrue user
   *  provisioning); table writes go through `sql`, matching the "seed as
   *  postgres" rule in the spec (PostgREST would hit the same forced-RLS
   *  policies a normal request does, since they key off a GUC nothing here sets). */
  admin: SupabaseClient;
  /** @libsql/client for the gateway tables (servers/agents/sessions/…). */
  libsql: LibsqlClient;
  now: Date;
  password: string;
  register: Register;
}

/** Every table a seed module writes to, for the startup preflight. Extend
 *  this alongside a new module — index.ts fails fast (not mid-seed) when one
 *  is missing, the same idea as ui-audit-seed.ts's assertRequiredSchema. */
export const SEEDED_TABLES: readonly string[] = [
  'organizations',
  'profiles',
  'organization_members',
  'member_roles',
  'org_roles',
  'permission_rules',
  'app_modules',
  'personal_agents',
  'join_link',
  'join_request',
  'parties',
  'crm_contacts',
  'crm_contact_identities',
  'crm_contact_activity_stats',
  'crm_tags',
  'crm_contact_tags',
  'tag_links',
  'crm_settings',
  'app_table_config',
  'fin_products',
  'fin_product_components',
  'stk_items',
  'stk_consumption',
  'pos_settings',
  'pos_series',
  'pos_shifts',
  'pos_tickets',
  'pos_ticket_lines',
  'pos_payments',
  'pos_client_ledger',
  'pos_payment_plans',
  'pos_package_grants',
  'pos_package_redemptions',
  'pos_emissions',
  'sched_resources',
  'sched_schedules',
  'sched_availability',
  'sched_event_kinds',
  'sched_event_types',
  'sched_event_type_resources',
  'sched_links',
  'sched_bookings',
  'hr_employees',
  'hr_holidays',
  'hr_leave_types',
  'hr_leave_requests',
  'stk_warehouses',
  'stk_entries',
  'stk_entry_lines',
  'stk_ledger',
  'stk_bins',
  'stk_accruals',
  'fin_invoices',
  'fin_invoice_items',
  'fin_clients',
  'fin_settings',
  'fin_statement_imports',
  'fin_transactions',
  'fin_sync_jobs',
  'fin_purchases',
  'fin_purchase_periods',
  'files',
  'attachment_links',
  'attachment_trash',
  'attachment_file_state',
  'bg_jobs',
  'fin_sync_jobs',
  'brains',
  'brain_documents',
  'knowledge_sources',
  'knowledge_documents',
  'knowledge_chunks',
];

/** Sum of row counts across every seeded table — cheap, table-shaped proxy for
 *  "did the second seed run insert anything new" (ON CONFLICT means updates
 *  never change the count, only a genuinely new row does). */
export async function countAllSeededRows(sql: ReturnType<typeof postgres>): Promise<number> {
  let total = 0;
  for (const table of new Set(SEEDED_TABLES)) {
    const [row] = await sql.unsafe<{ n: number }[]>(`select count(*)::int as n from "${table}"`);
    total += row?.n ?? 0;
  }
  return total;
}
