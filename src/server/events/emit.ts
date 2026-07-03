import { sql } from 'drizzle-orm';
import type { CoreTx } from '$server/db/with-org-core';

/**
 * Transactional domain events emitted via `pg_notify` — delivered to any
 * `LISTEN`ing connection only on COMMIT of the emitting transaction (exactly-
 * on-commit semantics). The flows-runner's long-lived listener
 * (`langgraph-server/src/flow/hub-events.ts`) relays each event to
 * `/api/internal/events/handle`. NOTIFY is fire-and-forget by design — cron
 * ticks remain the durability fallback; there is no outbox table in v1.
 */
export type HubEvent =
	| { type: 'finance.invoices_upserted'; orgId: string; created: number; updated: number }
	| { type: 'booking.created'; orgId: string; bookingId: string }
	| { type: 'ticket.status_changed'; orgId: string; issueId: string; old: string; new: string }
	| { type: 'stock.entry_submitted'; orgId: string; entryId: string; entryType: string };

/** Emit inside an open tx — PG delivers on commit. Payload must stay small (<8KB, NOTIFY's hard limit). */
export async function emitHubEvent(tx: CoreTx, event: HubEvent): Promise<void> {
	await tx.execute(sql`select pg_notify('hub_events', ${JSON.stringify(event)})`);
}
