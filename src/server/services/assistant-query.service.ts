import { sql } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';

/**
 * Read-only, org-scoped SQL for the assistant's "any sorting/grouping" analytics
 * (crm_query tool). The agent writes a SELECT; we run it under HARD guards so an
 * LLM (or a crafted prompt) can't write, escape the org, reach a secret/PII table,
 * or run away:
 *
 *  - SET LOCAL ROLE app_assistant_ro → a NOLOGIN role with SELECT grants on the
 *    business-domain tables ONLY. PG itself rejects platform/secret/identity
 *    tables (gateway tokens, settings, profiles, flows, …) with 42501, and the
 *    role has no write grants, so writes are impossible at the engine level.
 *    This is the authoritative table-scope + write guard (see migration
 *    `assistant_ro_role`) — no in-process table allowlist needed (a regex can't
 *    be trusted; comma-joins `from a, b` bypass it).
 *  - + app.current_org_id GUC → the PUBLIC `*_org_guc` RLS policies scope every
 *    row to the caller's org (same mechanism as withOrgCore). No cross-org reads.
 *  - SET TRANSACTION READ ONLY → redundant belt-and-suspenders against the role
 *    ever gaining a write grant.
 *  - statement_timeout → no runaway query.
 *  - single SELECT/WITH only; multi-statement rejected.
 *  - row cap → bounded result handed to the model.
 *
 * Because the DB role enforces table-scope and read-only, ANY authenticated org
 * member may run it (their reads are confined to their org's business data — what
 * they already see in the UI). The endpoint only requires a resolved org role.
 */

const MAX_ROWS = 200;
const STATEMENT_TIMEOUT_MS = 5000;

/**
 * Whether a caller may run analytics SQL. Any resolved org member qualifies — the
 * app_assistant_ro DB role (not this check) is what scopes the data, so there's no
 * need to gate on admin/owner. A null role means "not a member" → denied.
 */
export function canRunQuery(role: string | null | undefined): boolean {
	return typeof role === 'string' && role.length > 0;
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
		await tx.execute(sql`set local role app_assistant_ro`);
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
