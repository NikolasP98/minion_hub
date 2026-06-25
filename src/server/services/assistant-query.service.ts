import { sql } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';

/**
 * Read-only, org-scoped, permission-gated SQL for the assistant's "any sorting /
 * grouping" analytics (crm_query tool). The agent writes a SELECT; we run it
 * under HARD guards so an LLM (or a crafted prompt) can't write, escape the org,
 * run away, or read tables the user isn't allowed to:
 *
 *  - SET TRANSACTION READ ONLY  → rejects every write/DDL, even though the
 *    app_ledger role itself CAN write (the hub writes through it). This is the
 *    authoritative write guard.
 *  - SET LOCAL ROLE app_ledger + app.current_org_id GUC → forced RLS scopes
 *    every row to the caller's org (same as withOrgCore).
 *  - statement_timeout → no runaway query.
 *  - table allowlist → non-admins may only touch business-domain tables (never
 *    users / billing / settings / profiles / agent internals).
 *  - row cap → bounded result handed back to the model.
 */

const MAX_ROWS = 200;
const STATEMENT_TIMEOUT_MS = 5000;

// Business-domain tables an org MEMBER may analyze. Excludes platform/admin/PII
// tables (profiles, organization_members, settings, billing, sessions, channels,
// agents, agent_memories, …) — those require an admin role. Everything is
// org-scoped by RLS regardless of this list; the list is the per-user gate.
const BUSINESS_DATA_TABLES = new Set<string>([
	'crm_contacts',
	'crm_contact_identities',
	'crm_contact_stats',
	'crm_contact_tags',
	'crm_contact_timeline',
	'crm_activities',
	'crm_tags',
	'crm_message_sentiment',
	'parties',
	'fin_clients',
	'fin_invoices',
	'fin_invoice_items',
	'fin_payments',
	'fin_products',
	'fin_sources',
	'sched_bookings',
	'sched_event_types',
	'sched_availability',
	'sched_schedules',
	'sched_resources',
	'sched_reminders',
	'sales_orders',
	'memberships',
	'membership_plans',
	'membership_cycles',
	'proj_projects',
	'proj_tasks',
	'proj_timesheets',
	'support_issues',
	'messages',
]);

/** The tables a role may query. `null` = no restriction (admin/owner). */
export function resolveQueryableTables(role: string | null | undefined): Set<string> | null {
	if (role === 'admin' || role === 'owner') return null;
	return BUSINESS_DATA_TABLES;
}

export interface QueryResult {
	columns: string[];
	rows: Record<string, unknown>[];
	rowCount: number;
	truncated: boolean;
}

/** Caller-facing validation failure (maps to 400). */
export class QueryRejected extends Error {}

/** Base tables referenced after FROM/JOIN. Best-effort (the SQL comes from an
 *  LLM, not an adversary; RO-txn + RLS are the hard guards). Schema-qualified or
 *  exotic refs that slip past simply can't write or leave the org. */
function referencedTables(q: string): string[] {
	const out: string[] = [];
	const re = /\b(?:from|join)\s+("?)([a-z_][a-z0-9_$]*)\1/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(q)) !== null) out.push(m[2].toLowerCase());
	return out;
}

/** CTE names declared with `name as (` — allowed even though they appear after FROM. */
function cteNames(q: string): Set<string> {
	const names = new Set<string>();
	const re = /\b([a-z_][a-z0-9_$]*)\s+as\s*\(/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(q)) !== null) names.add(m[1].toLowerCase());
	return names;
}

export async function runReadOnlyOrgQuery(
	ctx: CoreCtx,
	rawSql: string,
	allowedTables: Set<string> | null,
): Promise<QueryResult> {
	const q = rawSql.trim().replace(/;+\s*$/, '');
	if (!q) throw new QueryRejected('Empty query.');
	if (q.includes(';')) throw new QueryRejected('Only a single statement is allowed.');
	if (!/^(with|select)\b/i.test(q)) {
		throw new QueryRejected('Only read-only SELECT / WITH queries are allowed.');
	}
	if (allowedTables) {
		const ctes = cteNames(q);
		const bad = [...new Set(referencedTables(q))].filter(
			(t) => !allowedTables.has(t) && !ctes.has(t),
		);
		if (bad.length > 0) {
			throw new QueryRejected(
				`Not permitted to query: ${bad.join(', ')}. You may only query business data ` +
					`(CRM, finance, scheduling, sales, support, memberships, projects).`,
			);
		}
	}

	return ctx.db.transaction(async (tx) => {
		// READ ONLY must precede the first real query (set_config below is a SELECT).
		await tx.execute(sql`set transaction read only`);
		await tx.execute(sql`set local role app_ledger`);
		await tx.execute(sql.raw(`set local statement_timeout = ${STATEMENT_TIMEOUT_MS}`));
		await tx.execute(sql`select set_config('app.current_org_id', ${ctx.tenantId}, true)`);
		const res = (await tx.execute(sql.raw(q))) as unknown as Record<string, unknown>[];
		const rows = Array.isArray(res) ? res : [];
		const capped = rows.slice(0, MAX_ROWS);
		return {
			columns: capped[0] ? Object.keys(capped[0]) : [],
			rows: capped,
			rowCount: capped.length,
			truncated: rows.length > MAX_ROWS,
		};
	});
}
