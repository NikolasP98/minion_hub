import { sql } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';

/**
 * Read-only, org-scoped SQL for the assistant's "any sorting/grouping" analytics
 * (crm_query tool). The agent writes a SELECT; we run it under HARD guards so an
 * LLM (or a crafted prompt) can't write, escape the org, or run away:
 *
 *  - SET TRANSACTION READ ONLY  → rejects every write/DDL, even though the
 *    app_ledger role itself CAN write (the hub writes through it). Authoritative.
 *  - SET LOCAL ROLE app_ledger + app.current_org_id GUC → forced RLS scopes
 *    every row to the caller's org (same as withOrgCore). No cross-org reads.
 *  - statement_timeout → no runaway query.
 *  - single SELECT/WITH only; multi-statement rejected.
 *  - row cap → bounded result handed to the model.
 *
 * ADMIN/OWNER ONLY (enforced at the endpoint via canRunQuery): arbitrary SQL is
 * a full-org-read capability, so it's gated to org admins. Non-admins use the
 * curated crm_insight intents. A per-table-scoped non-admin variant would need a
 * dedicated read-only DB ROLE whose GRANTs cover only the business tables — an
 * in-process table allowlist can't be trusted (e.g. comma-joins,
 * `from a, b`, bypass any regex), so we don't attempt one here.
 */

const MAX_ROWS = 200;
const STATEMENT_TIMEOUT_MS = 5000;

/** Whether a role may run arbitrary analytics SQL. Admin/owner only. */
export function canRunQuery(role: string | null | undefined): boolean {
	return role === 'admin' || role === 'owner';
}

export interface QueryResult {
	columns: string[];
	rows: Record<string, unknown>[];
	rowCount: number;
	truncated: boolean;
}

/** Caller-facing validation failure (maps to 400). */
export class QueryRejected extends Error {}

export async function runReadOnlyOrgQuery(ctx: CoreCtx, rawSql: string): Promise<QueryResult> {
	const q = rawSql.trim().replace(/;+\s*$/, '');
	if (!q) throw new QueryRejected('Empty query.');
	if (q.includes(';')) throw new QueryRejected('Only a single statement is allowed.');
	if (!/^(with|select)\b/i.test(q)) {
		throw new QueryRejected('Only read-only SELECT / WITH queries are allowed.');
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
