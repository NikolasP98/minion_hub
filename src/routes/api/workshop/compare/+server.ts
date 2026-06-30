import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { saveComparisonRun, type CompareOutputInput } from '$server/services/workshop-experiments.service';

// Persist a finished model-comparison run + its per-model outputs.
// Auth + tenant scope only (workshop is a dev/experiment tool, not business data).
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.tenantCtx) throw error(401);
	const b = (await request.json().catch(() => ({}))) as {
		prompt?: string;
		system?: string;
		params?: unknown;
		blind?: boolean;
		outputs?: CompareOutputInput[];
	};
	if (!b.prompt || !Array.isArray(b.outputs)) throw error(400, 'prompt and outputs required');
	const runId = await saveComparisonRun(
		{ tenantId: locals.tenantCtx.tenantId },
		locals.user?.id ?? null,
		locals.serverId ?? null,
		{
			prompt: b.prompt,
			system: b.system,
			params: b.params,
			blind: b.blind === true,
			outputs: b.outputs,
		},
	);
	return json({ runId });
};
