import { describe, test, expect } from 'vitest';
import { capsToLegacyPermissions } from './permissions.service';
import { buildCapabilities } from './rbac.service';
import { requiredViewPermForPath } from '$lib/permissions';

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

	test('viewer gets every business *:view (the nav + route guard gate)', () => {
		const p = permsFor('viewer');
		for (const v of [
			'crm:view',
			'finance:view',
			'sales:view',
			'scheduling:view',
			'support:view',
			'projects:view',
			'memberships:view',
			'comms:view',
		]) {
			expect(p.has(v)).toBe(true);
		}
	});

	test('per-org override disabling crm view strips crm:view (the reported bug)', () => {
		const noView = {
			role_key: 'viewer',
			module: 'crm',
			can_view: false,
			can_create: false,
			can_edit: false,
			can_delete: false,
			can_export: false,
			can_manage: false,
		};
		const p = new Set(capsToLegacyPermissions(buildCapabilities(['viewer'], [noView])));
		expect(p.has('crm:view')).toBe(false);
		// other modules untouched
		expect(p.has('finance:view')).toBe(true);
	});
});

describe('requiredViewPermForPath — central route guard mapping', () => {
	test('business routes map to their view perm (longest prefix, subpaths)', () => {
		expect(requiredViewPermForPath('/crm')).toBe('crm:view');
		expect(requiredViewPermForPath('/crm/abc-123')).toBe('crm:view');
		expect(requiredViewPermForPath('/finances/invoices')).toBe('finance:view');
		expect(requiredViewPermForPath('/workforce/projects')).toBe('projects:view');
	});

	test('non-business / platform routes are ungated here', () => {
		expect(requiredViewPermForPath('/overview')).toBeNull();
		expect(requiredViewPermForPath('/settings/roles')).toBeNull();
		expect(requiredViewPermForPath('/crmfoo')).toBeNull(); // not a real prefix boundary
	});
});
