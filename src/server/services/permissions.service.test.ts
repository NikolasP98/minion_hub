import { describe, test, expect } from 'vitest';
import { capsToLegacyPermissions } from './permissions.service';
import { buildCapabilities } from './rbac.service';

const permsFor = (...roles: string[]) => new Set(capsToLegacyPermissions(buildCapabilities(roles, [])));

describe('capsToLegacyPermissions — RBAC → legacy nav vocab', () => {
	test('owner gets the full admin surface', () => {
		const p = permsFor('owner');
		for (const perm of [
			'settings:manage',
			'users:remove',
			'agents:delete',
			'roles:manage',
			'module:admin',
		]) {
			expect(p.has(perm)).toBe(true);
		}
	});

	test('manager preserves every *:view (== old "user") + business, minus admin writes', () => {
		const p = permsFor('manager');
		// All read perms a legacy "user" had:
		for (const v of [
			'agents:view',
			'sessions:view',
			'channels:view',
			'skills:view',
			'settings:view',
			'users:view',
			'roles:view',
			'billing:view',
			'hosts:view',
			'workshop:view',
		]) {
			expect(p.has(v)).toBe(true);
		}
		// Nav groups still visible:
		expect(p.has('module:admin')).toBe(true);
		expect(p.has('module:operations')).toBe(true);
		// But NOT admin/destructive writes:
		expect(p.has('settings:manage')).toBe(false);
		expect(p.has('users:remove')).toBe(false);
		expect(p.has('agents:edit')).toBe(false);
	});

	test('viewer is business-read only — no platform nav', () => {
		const p = permsFor('viewer');
		expect(p.has('module:admin')).toBe(false);
		expect(p.has('settings:view')).toBe(false);
		expect(p.has('agents:view')).toBe(false);
		expect(p.has('users:view')).toBe(false);
	});

	test('multi-role unions (viewer+admin → full)', () => {
		const p = permsFor('viewer', 'admin');
		expect(p.has('settings:manage')).toBe(true);
	});
});
