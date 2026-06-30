import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { createGroupchatRun, setRunStatus, type GroupchatAgentInput } from '$server/services/groupchat.service';
import { enqueueJob } from '$server/services/bg-runtime';

// Create a group-chat run (+ ephemeral agents) and enqueue it on the global
// bg-runtime so it runs server-side and survives navigation.
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.tenantCtx) throw error(401);
	const b = (await request.json().catch(() => ({}))) as {
		prompt?: string;
		rounds?: number | null;
		style?: string;
		includeOrchestrator?: boolean;
		background?: boolean;
		agents?: GroupchatAgentInput[];
	};
	if (!b.prompt || !Array.isArray(b.agents) || b.agents.length === 0) {
		throw error(400, 'prompt and at least one agent required');
	}
	const tenantId = locals.tenantCtx.tenantId;
	const runId = await createGroupchatRun({
		tenantId,
		userId: locals.user?.id ?? null,
		serverId: locals.serverId ?? null,
		prompt: b.prompt,
		rounds: b.rounds ?? null,
		style: b.style ?? 'freeform',
		includeOrchestrator: b.includeOrchestrator === true,
		background: b.background !== false,
		agents: b.agents,
	});
	await setRunStatus(runId, 'queued');
	const jobId = await enqueueJob({ tenantId, userId: locals.user?.id ?? null, type: 'groupchat', refId: runId });
	return json({ runId, jobId });
};
