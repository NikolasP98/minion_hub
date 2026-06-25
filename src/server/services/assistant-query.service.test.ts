import { describe, test, expect } from 'vitest';
import { runReadOnlyOrgQuery, canRunQuery, QueryRejected } from './assistant-query.service';
import type { CoreCtx } from '$server/auth/core-ctx';

// Validation throws BEFORE any DB access, so a db that explodes on use proves a
// rejected query never reached the transaction.
const ctx = {
	db: {
		transaction: () => {
			throw new Error('DB MUST NOT BE TOUCHED for a rejected query');
		},
	},
	tenantId: 'org-1',
} as unknown as CoreCtx;

describe('canRunQuery — admin/owner only', () => {
	test('admin & owner allowed; everyone else denied', () => {
		expect(canRunQuery('admin')).toBe(true);
		expect(canRunQuery('owner')).toBe(true);
		expect(canRunQuery('member')).toBe(false);
		expect(canRunQuery(null)).toBe(false);
		expect(canRunQuery(undefined)).toBe(false);
	});
});

describe('runReadOnlyOrgQuery validation (security guards)', () => {
	test('rejects writes / DDL (not SELECT) — incl. comma-join write attempts', async () => {
		for (const q of [
			'delete from fin_invoices',
			'update fin_invoices set total = 0',
			'drop table fin_invoices',
			'insert into fin_invoices (id) values (1)',
		]) {
			await expect(runReadOnlyOrgQuery(ctx, q)).rejects.toBeInstanceOf(QueryRejected);
		}
	});

	test('rejects multiple statements', async () => {
		await expect(runReadOnlyOrgQuery(ctx, 'select 1; drop table fin_invoices')).rejects.toThrow(
			/single statement/i,
		);
	});

	test('a valid SELECT passes validation and reaches the DB (admin path)', async () => {
		// Including a comma-join: there is NO in-process table allowlist anymore
		// (admin-only access makes it moot), so this passes validation → hits db.
		await expect(
			runReadOnlyOrgQuery(ctx, 'select count(*) from fin_invoices, profiles'),
		).rejects.toThrow(/MUST NOT BE TOUCHED/);
	});
});
