import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { getCoreDb } from '$server/db/pg-client';
import { resolveAssistantPrincipal } from '$server/auth/assistant-principal';
import { listBuiltTools } from '$server/services/builder.service';
import type { CoreCtx } from '$server/auth/core-ctx';
import type { Module, PermAction } from '$server/services/rbac.service';

function safeJsonObject(raw: unknown): Record<string, unknown> {
	if (typeof raw !== 'string' || !raw.trim()) return {};
	try {
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

/**
 * GET /api/gateway/query/custom-tools?agentId=personal-<uuid>[&orgId=]
 *
 * Published, org-scoped custom tools (spec C3) — feeds the gateway's custom-tool
 * loader (WP-3). No RBAC module gate: which custom tools a principal may
 * actually USE is enforced per-tool via each tool's own `permission` (checked
 * against the C2 snapshot on the gateway side), mirroring how the gateway's L1
 * gate already treats native tool permissions.
 *
 * `permission` is read from `executionConfig.permission` — builtTools has no
 * dedicated permission column; `executionConfig` (an existing JSON text column,
 * default '{}') is the closest fit since permission is an execution/runtime
 * concern, and it avoids a schema migration (see WP-2 report).
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	const { orgId, principalId } = await resolveAssistantPrincipal(locals, url);
	const ctx: CoreCtx = { db: getCoreDb(), tenantId: orgId, profileId: principalId };

	const rows = await listBuiltTools(ctx, { status: 'published' });
	const tools = rows.map((row) => {
		const executionConfig = safeJsonObject(row.executionConfig);
		const rawPermission = executionConfig.permission as
			| { module?: unknown; action?: unknown }
			| undefined;
		const permission =
			rawPermission && typeof rawPermission.module === 'string' && typeof rawPermission.action === 'string'
				? { module: rawPermission.module as Module, action: rawPermission.action as PermAction }
				: null;
		return {
			id: row.id,
			name: row.name,
			description: row.description ?? '',
			scriptLang: row.scriptLang,
			scriptCode: row.scriptCode ?? '',
			envVars: safeJsonObject(row.envVars),
			permission,
		};
	});

	return json({ tools });
};
