import { describe, test, expect } from 'vitest';
import { buildCapabilities, defaultCaps, legacyRoleKey } from './rbac.service';

describe('defaultCaps — role tiers', () => {
	test('owner/admin get everything', () => {
		for (const r of ['owner', 'admin']) {
			expect(defaultCaps(r, 'crm').delete).toBe(true);
			expect(defaultCaps(r, 'settings').manage).toBe(true);
		}
	});
	test('manager: full business data, no delete/manage; admin modules view-only', () => {
		expect(defaultCaps('manager', 'finance').export).toBe(true);
		expect(defaultCaps('manager', 'finance').delete).toBe(false);
		expect(defaultCaps('manager', 'settings').view).toBe(true);
		expect(defaultCaps('manager', 'settings').manage).toBe(false);
	});
	test('staff: edit on crm/scheduling/support/comms, read-only finance/sales', () => {
		expect(defaultCaps('staff', 'crm').edit).toBe(true);
		expect(defaultCaps('staff', 'finance').edit).toBe(false);
		expect(defaultCaps('staff', 'finance').view).toBe(true);
		expect(defaultCaps('staff', 'settings').view).toBe(false);
	});
	test('viewer: read business only', () => {
		expect(defaultCaps('viewer', 'crm').view).toBe(true);
		expect(defaultCaps('viewer', 'crm').edit).toBe(false);
		expect(defaultCaps('viewer', 'settings').view).toBe(false);
	});
	test('overview is viewable by every role; unknown role fails closed', () => {
		expect(defaultCaps('viewer', 'overview').view).toBe(true);
		expect(defaultCaps('nonsense', 'crm').view).toBe(false);
	});
});

describe('buildCapabilities — multi-role OR + overrides', () => {
	test('roles OR together (viewer+staff → staff can edit crm)', () => {
		const caps = buildCapabilities(['viewer', 'staff'], []);
		expect(caps.can('crm', 'edit')).toBe(true);
		expect(caps.can('finance', 'edit')).toBe(false);
	});
	test('canRunAnalytics true for any role with a business view; false with no roles', () => {
		expect(buildCapabilities(['viewer'], []).canRunAnalytics()).toBe(true);
		const none = buildCapabilities([], []);
		expect(none.canRunAnalytics()).toBe(false);
		expect(none.can('crm', 'view')).toBe(false);
	});
	test('per-org override beats the code default', () => {
		const caps = buildCapabilities(
			['staff'],
			[
				{
					role_key: 'staff',
					module: 'finance',
					can_view: true,
					can_create: false,
					can_edit: true, // override: staff normally cannot edit finance
					can_delete: false,
					can_export: false,
					can_manage: false,
				},
			],
		);
		expect(caps.can('finance', 'edit')).toBe(true);
	});
	test('visibleModules reflects view caps', () => {
		const caps = buildCapabilities(['viewer'], []);
		expect(caps.visibleModules()).toContain('crm');
		expect(caps.visibleModules()).not.toContain('settings');
	});
});

describe('legacyRoleKey — back-compat mapping', () => {
	test('owner/admin pass through; member→manager; unknown→viewer', () => {
		expect(legacyRoleKey('owner')).toBe('owner');
		expect(legacyRoleKey('admin')).toBe('admin');
		expect(legacyRoleKey('member')).toBe('manager');
		expect(legacyRoleKey(null)).toBe('viewer');
	});
});
