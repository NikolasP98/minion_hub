import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { requireAssistantCapability } from '../../_shared/action-auth';
import {
	createBuiltTool,
	getBuiltTool,
	updateBuiltTool,
	publishBuiltTool,
} from '$server/services/builder.service';
import { MODULES, ACTIONS } from '$server/services/rbac.service';

const bodySchema = z.object({
	confirm: z.literal(true),
	id: z.string().min(1).max(200).optional(),
	name: z.string().min(1).max(200),
	description: z.string().max(2000).optional(),
	scriptLang: z.enum(['javascript', 'python', 'bash']),
	scriptCode: z.string().max(100_000),
	envVars: z.record(z.string(), z.string()).optional(),
	permission: z
		.object({ module: z.enum(MODULES), action: z.enum(ACTIONS) })
		.optional(),
	publish: z.boolean().optional(),
});

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
 * POST /api/gateway/actions/tool-save?agentId=personal-<uuid>[&orgId=]
 * body: {id?, name, description?, scriptLang, scriptCode, envVars?, permission?, publish?, confirm:true}
 *
 * Lets the builder-agent drive `/api/builder/tools` itself (spec C14):
 * creates a new draft builtTool when `id` is absent, otherwise updates the
 * existing one (ownership enforced by `updateBuiltTool`'s tenantId filter —
 * an id from another org silently no-ops rather than leaking a write).
 * `permission` is merged into `executionConfig` (preserving any other keys
 * already stored there) since builtTools has no dedicated permission column
 * (same rationale as the custom-tools query endpoint).
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
	const { ctx } = await requireAssistantCapability(locals, url, 'tools', 'manage');
	const b = await parseBody(request, bodySchema);

	const envVars = b.envVars ? JSON.stringify(b.envVars) : undefined;

	let toolId: string;
	if (!b.id) {
		const executionConfig = b.permission ? JSON.stringify({ permission: b.permission }) : undefined;
		const created = await createBuiltTool(ctx, {
			name: b.name,
			description: b.description,
			scriptCode: b.scriptCode,
			scriptLang: b.scriptLang,
			envVars,
			executionConfig,
		});
		toolId = created.id;
	} else {
		toolId = b.id;
		const existing = await getBuiltTool(ctx, toolId);
		if (!existing) throw error(404, 'tool not found');
		const executionConfig = b.permission
			? JSON.stringify({ ...safeJsonObject(existing.executionConfig), permission: b.permission })
			: undefined;
		await updateBuiltTool(ctx, toolId, {
			name: b.name,
			scriptCode: b.scriptCode,
			scriptLang: b.scriptLang,
			...(b.description !== undefined && { description: b.description }),
			...(envVars !== undefined && { envVars }),
			...(executionConfig !== undefined && { executionConfig }),
		});
	}

	let status: 'draft' | 'published' = 'draft';
	if (b.publish) {
		await publishBuiltTool(ctx, toolId);
		status = 'published';
	}

	return json({ ok: true, toolId, status });
};
