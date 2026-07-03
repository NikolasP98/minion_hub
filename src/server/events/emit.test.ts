import { describe, it, expect, vi } from 'vitest';
import { emitHubEvent } from './emit';

describe('emitHubEvent', () => {
	it('fires pg_notify on the hub_events channel with the JSON-serialized event', async () => {
		const execute = vi.fn(async (_q: unknown) => [] as unknown[]);
		const tx = { execute } as never;

		await emitHubEvent(tx, {
			type: 'booking.created',
			orgId: 'org-1',
			bookingId: 'booking-1',
		});

		expect(execute).toHaveBeenCalledTimes(1);
		const chunks = (execute.mock.calls[0][0] as { queryChunks: unknown[] }).queryChunks;
		const text = chunks.map((c) => (typeof c === 'string' ? c : JSON.stringify(c))).join('');
		expect(text).toContain('pg_notify');
		expect(text).toContain('hub_events');
	});

	it('serializes the full event payload as JSON in the query params', async () => {
		const execute = vi.fn(async (_q: unknown) => [] as unknown[]);
		const tx = { execute } as never;

		await emitHubEvent(tx, {
			type: 'finance.invoices_upserted',
			orgId: 'org-2',
			created: 3,
			updated: 5,
		});

		const chunks = (execute.mock.calls[0][0] as { queryChunks: unknown[] }).queryChunks;
		// The event payload is JSON.stringify-ed before interpolation, so it lands
		// as a plain string param chunk (not a StringChunk) — find it directly.
		const payload = chunks.find((c) => typeof c === 'string' && c.includes('finance.invoices_upserted'));
		expect(payload).toBeDefined();
		expect(payload as string).toContain('org-2');
		expect(JSON.parse(payload as string)).toEqual({
			type: 'finance.invoices_upserted',
			orgId: 'org-2',
			created: 3,
			updated: 5,
		});
	});
});
