import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreDb } from '$server/db/pg-client';
import { resolveAssistantPrincipal } from '$server/auth/assistant-principal';
import {
	runReadOnlyOrgQuery,
	resolveQueryableTables,
	QueryRejected,
} from '$server/services/assistant-query.service';
import type { CoreCtx } from '$server/auth/core-ctx';

/**
 * POST /api/gateway/query?agentId=personal-<uuid>[&orgId=<org>]   body: { sql }
 *
 * Run the assistant's read-only analytics SQL ("any sorting/grouping") against
 * the caller's org. HARD guards live in assistant-query.service: READ-ONLY txn,
 * org RLS, statement_timeout, single SELECT, row cap, and a per-role table
 * allowlist (non-admins → business data only). Auth/identity is the same trusted
 * agentId→profile→org-membership resolution as /insight.
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
	const { principalId, orgId, role } = await resolveAssistantPrincipal(locals, url);
	const ctx: CoreCtx = { db: getCoreDb(), tenantId: orgId, profileId: principalId };

	const body = (await request.json().catch(() => ({}))) as { sql?: unknown };
	const querySql = typeof body.sql === 'string' ? body.sql : '';
	if (!querySql.trim()) throw error(400, 'sql body field required');

	try {
		const result = await runReadOnlyOrgQuery(ctx, querySql, resolveQueryableTables(role));
		return json({ orgId, ...result });
	} catch (e) {
		// Validation + SQL errors are the agent's to fix — surface the message at
		// 400 so it can self-correct the query. Re-throw SvelteKit errors.
		if (e instanceof Response) throw e;
		const message = e instanceof Error ? e.message : 'query failed';
		if (!(e instanceof QueryRejected)) console.error('[POST /api/gateway/query]', message);
		return json({ error: message }, { status: 400 });
	}
};
