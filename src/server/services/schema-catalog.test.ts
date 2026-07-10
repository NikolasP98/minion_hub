import { describe, it, expect } from 'vitest';
import { getSchemaCatalog } from './schema-catalog';

describe('getSchemaCatalog', () => {
	const catalog = getSchemaCatalog();

	it('returns a non-empty list of business tables', () => {
		expect(catalog.length).toBeGreaterThan(0);
	});

	it('excludes auth/system tables', () => {
		const names = catalog.map((t) => t.name);
		for (const excluded of ['user', 'session', 'account', 'verification', 'jwks']) {
			expect(names).not.toContain(excluded);
		}
	});

	it('includes the enumerated business domains (fin/sched/stk/pos/proj/parties/notes/support/crm/email_ledger)', () => {
		const names = catalog.map((t) => t.name);
		expect(names).toContain('fin_invoices');
		expect(names).toContain('sched_bookings');
		expect(names).toContain('stk_items');
		expect(names).toContain('pos_tickets');
		expect(names).toContain('proj_tasks');
		expect(names).toContain('parties');
		expect(names).toContain('notes');
		expect(names).toContain('support_issues');
		expect(names).toContain('crm_contacts');
		expect(names).toContain('email_ledger');
	});

	it('every table has a name and every column has a name + type', () => {
		for (const table of catalog) {
			expect(typeof table.name).toBe('string');
			expect(table.name.length).toBeGreaterThan(0);
			expect(table.columns.length).toBeGreaterThan(0);
			for (const col of table.columns) {
				expect(typeof col.name).toBe('string');
				expect(col.name.length).toBeGreaterThan(0);
				expect(typeof col.type).toBe('string');
				expect(col.type.length).toBeGreaterThan(0);
			}
		}
	});

	it('is cached — repeated calls return the same array instance', () => {
		expect(getSchemaCatalog()).toBe(catalog);
	});
});
