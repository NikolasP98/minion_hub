import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAssistantCapability } from '../../_shared/action-auth';
import { listEntries } from '$server/services/email-ledger.service';

/**
 * GET /api/gateway/query/email-ledger?agentId=personal-<uuid>[&orgId=][&limit=][&q=]
 *
 * Recent processed-email rows for the org. Hard privacy contract (same as the
 * gateway watcher's write path): NEVER the email body/snippet — only what the
 * ledger already stores (summary/tags/domain/subject/receivedAt).
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	const { ctx } = await requireAssistantCapability(locals, url, 'comms', 'view');
	const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? 50) || 50));
	const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();

	const rows = await listEntries(ctx, { limit: 200 });
	const entries = rows
		.map((r) => ({
			summary: r.summary ?? '',
			tags: r.labels ?? [],
			domain: r.fromDomain ?? '',
			subject: r.subject ?? '',
			receivedAt: r.processedAt,
		}))
		.filter((e) => !q || e.subject.toLowerCase().includes(q) || e.summary.toLowerCase().includes(q))
		.slice(0, limit);

	return json({ entries });
};
