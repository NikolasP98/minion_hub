import { describe, test, expect } from 'vitest';
import {
	runReadOnlyOrgQuery,
	resolveQueryableTables,
	QueryRejected,
} from './assistant-query.service';
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

const member = resolveQueryableTables('member')!; // business-data allowlist

describe('resolveQueryableTables', () => {
	test('admin/owner → unrestricted (null)', () => {
		expect(resolveQueryableTables('admin')).toBeNull();
		expect(resolveQueryableTables('owner')).toBeNull();
	});
	test('member → a non-empty business allowlist that excludes platform tables', () => {
		expect(member.has('fin_invoices')).toBe(true);
		expect(member.has('crm_contacts')).toBe(true);
		expect(member.has('profiles')).toBe(false);
		expect(member.has('organization_members')).toBe(false);
		expect(member.has('settings')).toBe(false);
	});
});

describe('runReadOnlyOrgQuery validation (security guards)', () => {
	test('rejects writes / DDL (not SELECT)', async () => {
		for (const q of [
			'delete from fin_invoices',
			'update fin_invoices set total = 0',
			'drop table fin_invoices',
			'insert into fin_invoices (id) values (1)',
		]) {
			await expect(runReadOnlyOrgQuery(ctx, q, member)).rejects.toBeInstanceOf(QueryRejected);
		}
	});

	test('rejects multiple statements', async () => {
		await expect(
			runReadOnlyOrgQuery(ctx, 'select 1; drop table fin_invoices', member),
		).rejects.toThrow(/single statement/i);
	});

	test('rejects a non-admin querying a platform table', async () => {
		await expect(runReadOnlyOrgQuery(ctx, 'select * from profiles', member)).rejects.toThrow(
			/not permitted/i,
		);
		await expect(
			runReadOnlyOrgQuery(ctx, 'select email from organization_members', member),
		).rejects.toThrow(/not permitted/i);
	});

	test('allows a business-table SELECT with CTEs through validation (then hits DB)', async () => {
		// CTE name `t` must not be flagged as a forbidden table; the business table
		// fin_invoices is allowed → validation passes → reaches the (exploding) db.
		await expect(
			runReadOnlyOrgQuery(
				ctx,
				'with t as (select total from fin_invoices) select sum(total) from t',
				member,
			),
		).rejects.toThrow(/DB MUST NOT BE TOUCHED|MUST NOT/);
	});
});
