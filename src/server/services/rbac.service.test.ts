import { describe, test, expect } from 'vitest';
import {
	buildCapabilities,
	defaultCaps,
	legacyRoleKey,
	apiWriteCapability,
	normalizeViewDependency,
	wouldRemoveLastOwner,
} from './rbac.service';

const ROW = (over: Record<string, unknown>) => ({
	role_key: 'viewer',
	module: 'crm',
	can_view: false,
	can_create: false,
	can_edit: false,
	can_delete: false,
	can_export: false,
	can_manage: false,
	...over,
});

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

describe('sub-resource inheritance + view-dependency', () => {
	test('sub-resource inherits parent caps when no explicit override', () => {
		// viewer default: crm = VIEW only → crm.insights inherits VIEW
		const caps = buildCapabilities(['viewer'], []);
		expect(caps.can('crm.insights', 'view')).toBe(true);
		expect(caps.can('crm.insights', 'edit')).toBe(false);
	});
	test('explicit sub-resource override wins over parent', () => {
		// parent crm has view; sub crm.insights explicitly denied view
		const caps = buildCapabilities(['viewer'], [ROW({ module: 'crm.insights', can_view: false })]);
		expect(caps.can('crm', 'view')).toBe(true); // parent default still view
		expect(caps.can('crm.insights', 'view')).toBe(false); // sub overridden off
	});
	test('parent override propagates to inheriting sub-resources', () => {
		// give viewer full crm via override → crm.cleanup (no own override) inherits it
		const caps = buildCapabilities(
			['viewer'],
			[ROW({ module: 'crm', can_view: true, can_edit: true })],
		);
		expect(caps.can('crm.cleanup', 'edit')).toBe(true);
	});
	test('normalizeViewDependency: view off clears all; view on untouched', () => {
		const offWithExtras = { view: false, create: true, edit: true, delete: false, export: false, manage: false };
		expect(normalizeViewDependency(offWithExtras)).toEqual({
			view: false, create: false, edit: false, delete: false, export: false, manage: false,
		});
		const onSet = { view: true, create: true, edit: false, delete: false, export: false, manage: false };
		expect(normalizeViewDependency(onSet)).toBe(onSet);
	});
});

describe('ownerScoped — record-level (if-owner)', () => {
	test('a role restricted with if_owner is owner-scoped on that module', () => {
		const caps = buildCapabilities(['viewer'], [ROW({ module: 'crm', can_view: true, if_owner: true })]);
		expect(caps.can('crm', 'view')).toBe(true);
		expect(caps.ownerScoped('crm')).toBe(true);
	});
	test('no if_owner → full visibility (not scoped)', () => {
		const caps = buildCapabilities(['viewer'], []); // viewer default crm = VIEW, no if_owner
		expect(caps.ownerScoped('crm')).toBe(false);
	});
	test('least-restrictive wins: any role with un-restricted view lifts the scope', () => {
		// staff restricted-to-own on crm, but manager grants un-restricted crm view
		const caps = buildCapabilities(
			['staff', 'manager'],
			[ROW({ role_key: 'staff', module: 'crm', can_view: true, if_owner: true })],
		);
		expect(caps.ownerScoped('crm')).toBe(false);
	});
	test('not scoped when the role cannot view at all', () => {
		const caps = buildCapabilities(['viewer'], [ROW({ module: 'finance', can_view: false, if_owner: true })]);
		expect(caps.ownerScoped('finance')).toBe(false);
	});
});

describe('fieldLevel — field-level (sensitive field) tier', () => {
	test('default is 1 (visible) for modules with a sensitive tier', () => {
		const caps = buildCapabilities(['viewer'], []);
		expect(caps.fieldLevel('crm')).toBe(1);
		expect(caps.fieldLevel('finance')).toBe(1);
		// modules without a sensitive tier → 0
		expect(caps.fieldLevel('agents')).toBe(0);
	});
	test('an override can lower a role below the sensitive threshold (mask)', () => {
		const caps = buildCapabilities(
			['viewer'],
			[ROW({ module: 'crm', can_view: true, field_level: 0 })],
		);
		expect(caps.fieldLevel('crm')).toBe(0); // PII masked
	});
	test('MAX across roles — least-restrictive wins', () => {
		const caps = buildCapabilities(
			['staff', 'manager'],
			[
				ROW({ role_key: 'staff', module: 'crm', can_view: true, field_level: 0 }),
				ROW({ role_key: 'manager', module: 'crm', can_view: true, field_level: 1 }),
			],
		);
		expect(caps.fieldLevel('crm')).toBe(1);
	});
});

describe('wouldRemoveLastOwner — multi-role last-owner guard', () => {
	test('blocks removing owner from the sole owner', () => {
		expect(wouldRemoveLastOwner(['p1'], 'p1', 'owner')).toBe(true);
	});
	test('allows removing owner when another owner remains', () => {
		expect(wouldRemoveLastOwner(['p1', 'p2'], 'p1', 'owner')).toBe(false);
	});
	test('ignores non-owner role removals entirely', () => {
		expect(wouldRemoveLastOwner(['p1'], 'p1', 'manager')).toBe(false);
	});
	test('no-op when the profile is not an owner in the first place', () => {
		expect(wouldRemoveLastOwner(['p2'], 'p1', 'owner')).toBe(false);
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
