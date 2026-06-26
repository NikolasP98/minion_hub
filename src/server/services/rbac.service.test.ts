import { describe, test, expect } from 'vitest';
import { buildCapabilities, defaultCaps, legacyRoleKey, apiWriteCapability } from './rbac.service';

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

describe('apiWriteCapability — central hooks write guard mapping', () => {
	test('reads are never gated here', () => {
		expect(apiWriteCapability('/api/crm/contacts', 'GET')).toBeNull();
		expect(apiWriteCapability('/api/crm/contacts', 'HEAD')).toBeNull();
	});
	test('business writes map to (module, edit); DELETE→delete', () => {
		expect(apiWriteCapability('/api/crm/contacts', 'POST')).toEqual({ module: 'crm', action: 'edit' });
		expect(apiWriteCapability('/api/crm/contacts/abc', 'PATCH')).toEqual({ module: 'crm', action: 'edit' });
		expect(apiWriteCapability('/api/crm/tags/abc', 'DELETE')).toEqual({ module: 'crm', action: 'delete' });
		expect(apiWriteCapability('/api/finances/products', 'PUT')).toEqual({ module: 'finance', action: 'edit' });
		expect(apiWriteCapability('/api/sales/orders/x', 'PATCH')).toEqual({ module: 'sales', action: 'edit' });
	});
	test('work + workforce map to projects (no /api/work ↔ /api/workforce collision)', () => {
		expect(apiWriteCapability('/api/work/reassign', 'PATCH')).toEqual({ module: 'projects', action: 'edit' });
		expect(apiWriteCapability('/api/workforce/anything', 'POST')).toEqual({ module: 'projects', action: 'edit' });
	});
	test('org-config surfaces require settings:manage', () => {
		expect(apiWriteCapability('/api/modules', 'PUT')).toEqual({ module: 'settings', action: 'manage' });
		expect(apiWriteCapability('/api/plugins/whatsapp/toggle', 'POST')).toEqual({ module: 'settings', action: 'manage' });
	});
	test('anonymous public booking is excluded', () => {
		expect(apiWriteCapability('/api/scheduling/public/my-slug/book', 'POST')).toBeNull();
	});
	test('ungated prefixes return null', () => {
		expect(apiWriteCapability('/api/agents/x', 'POST')).toBeNull();
		expect(apiWriteCapability('/api/gateway/query', 'POST')).toBeNull();
		expect(apiWriteCapability('/api/messages/ingest', 'POST')).toBeNull();
	});
});
