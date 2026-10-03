import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$server/db/with-org-core', () => ({
	withOrgCore: (_ctx: unknown, fn: (tx: unknown) => unknown) => fn(tx),
}));

let rows: Record<string, unknown>[] = [];
const tx = { execute: vi.fn(async (_statement: SQL) => rows) };

import { listClientAccounts } from './pos-accounts.service';

const ctx = { db: {} as never, tenantId: 'org-1' };

function accountRow(patch: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		client_key: 'party:party-1',
		pos_currency: 'PEN',
		party_id: 'party-1',
		contact_id: null,
		balances: [],
		plan_buckets: [],
		total_open_plans: 0,
		active_grants: 0,
		pending_scheduling: 0,
		pending_ticket_id: null,
		identity_status: 'active',
		display_name: 'Ana',
		...patch,
	};
}

beforeEach(() => {
	rows = [];
	tx.execute.mockClear();
});

describe('listClientAccounts — canonical currency projection', () => {
	it('rejects unsafe aggregate amounts and unsupported currencies', async () => {
		rows = [accountRow({ balances: [{ currency: 'PEN', balance: '90071992547409.91' }] })];
		await expect(listClientAccounts(ctx)).rejects.toMatchObject({ code: 'invalid_stored_amount' });
		rows = [accountRow({ balances: [{ currency: 'JPY', balance: '100' }] })];
		await expect(listClientAccounts(ctx)).rejects.toMatchObject({
			code: 'unsupported_pos_currency',
		});
	});

	it('projects every currency while preserving the configured compatibility balance', async () => {
		rows = [
			accountRow({
				contact_id: 'contact-1',
				balances: [
					{ currency: 'PEN', balance: '120.50' },
					{ currency: 'USD', balance: '7.25' },
				],
				plan_buckets: [
					{ currency: 'PEN', count: 1, total: '300' },
					{ currency: 'USD', count: 2, total: '25.50' },
				],
				total_open_plans: 3,
				active_grants: 5,
				pending_scheduling: 2,
				pending_ticket_id: 'ticket-9',
				display_name: 'QA DNI Verified',
			}),
		];
		expect(await listClientAccounts(ctx)).toEqual([
			{
				clientKey: 'party:party-1',
				partyId: 'party-1',
				crmContactId: 'contact-1',
				identityStatus: 'active',
				balancesByCurrency: [
					{ currency: 'PEN', balance: 120.5 },
					{ currency: 'USD', balance: 7.25 },
				],
				openPlansByCurrency: [
					{ currency: 'PEN', count: 1, total: 300 },
					{ currency: 'USD', count: 2, total: 25.5 },
				],
				balance: 120.5,
				balanceCurrency: 'PEN',
				activeGrants: 5,
				openPlans: 1,
				totalOpenPlans: 3,
				openPlanTotal: 300,
				displayName: 'QA DNI Verified',
				pendingScheduling: 2,
				pendingTicketId: 'ticket-9',
			},
		]);
	});

	it('takes both locks before exactly one bounded projection statement', async () => {
		rows = [accountRow()];
		await listClientAccounts(ctx, { limit: 999 });
		expect(tx.execute).toHaveBeenCalledTimes(3);
		const statements = tx.execute.mock.calls.map(
			(call) => new PgDialect().sqlToQuery(call[0] as SQL).sql,
		);
		expect(statements[0]).toContain('pg_advisory_xact_lock_shared');
		expect(statements[1]).toContain('pg_advisory_xact_lock_shared');
		expect(statements[2]).toContain('limit');
		expect(new PgDialect().sqlToQuery(tx.execute.mock.calls[2][0] as SQL).params).toContain(500);
		expect(statements[2]).toContain('when l.party_id is not null then');
		expect(statements[2]).toContain("'party:' || l.party_id::text");
	});

	it('keeps an orphan party visible without inventing a contact or name', async () => {
		rows = [
			accountRow({
				client_key: 'party:missing-party',
				party_id: 'missing-party',
				identity_status: 'missing_party',
				display_name: null,
				balances: [{ currency: 'USD', balance: '50' }],
			}),
		];
		expect(await listClientAccounts(ctx)).toMatchObject([
			{
				clientKey: 'party:missing-party',
				partyId: 'missing-party',
				crmContactId: null,
				identityStatus: 'missing_party',
				displayName: null,
				balancesByCurrency: [{ currency: 'USD', balance: 50 }],
				balance: 0,
				balanceCurrency: 'PEN',
			},
		]);
	});
});
