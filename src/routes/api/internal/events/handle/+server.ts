import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { parseBody } from '$server/api/validate';
import { getCoreDb } from '$server/db/pg-client';
import { bustFinanceCache } from '$server/services/finance.service';
import { processOrgNotifications } from '$server/services/notif.service';

// Loosely typed on purpose — `type` drives the switch below; unknown types are
// forward-compat (200 {ignored:true}), not a validation error. Per-type field
// shape is trusted (this is a bearer-gated server-to-server callback fed only
// by our own emitHubEvent()/hub-events.ts listener, not user input).
const hubEventBody = z.object({ type: z.string(), orgId: z.string() }).passthrough();

/**
 * POST /api/internal/events/handle — callback target for the flows-runner's
 * `hub_events` LISTEN relay (`langgraph-server/src/flow/hub-events.ts`).
 * Same Bearer HUB_API_TOKEN pattern as /api/internal/flows/[id]. The runner
 * may redeliver on reconnect, so every branch here must be idempotent.
 */
export const POST: RequestHandler = async ({ request }) => {
	const authHeader = request.headers.get('Authorization') ?? '';
	const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
	const expectedToken = env.HUB_API_TOKEN ?? '';
	if (expectedToken && token !== expectedToken) throw error(401, 'Unauthorized');

	const event = await parseBody(request, hubEventBody);
	const ctx = { db: getCoreDb(), tenantId: event.orgId };

	switch (event.type) {
		case 'finance.invoices_upserted':
			// Idempotent: invalidateTags just re-clears already-clear cache tags.
			await bustFinanceCache(ctx);
			return json({ ok: true });
		case 'booking.created':
		case 'ticket.status_changed':
			// No dedicated queue table — instant-run the same rule engine the cron
			// tick drains; notifLog's onConflictDoNothing dedup makes a redelivered
			// event (or an overlapping cron pass) a no-op.
			await processOrgNotifications(ctx, new Date());
			return json({ ok: true });
		default:
			return json({ ignored: true });
	}
};
