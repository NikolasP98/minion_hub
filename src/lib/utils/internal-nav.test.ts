import { describe, test, expect } from 'vitest';
import { resolveInternalNav } from './internal-nav';

const plain = { metaKey: false, ctrlKey: false, shiftKey: false, button: 0 };

// Fake event target: closest('a') returns an anchor with the given attrs (or null).
function targetWith(attrs: Record<string, string> | null) {
	const a = attrs && { getAttribute: (k: string) => attrs[k] ?? null };
	return { closest: () => a };
}

describe('resolveInternalNav', () => {
	test('internal href → returns it for SPA navigation', () => {
		expect(resolveInternalNav(targetWith({ href: '/crm/123' }), plain)).toBe('/crm/123');
	});

	test('external link → null (let browser handle)', () => {
		expect(resolveInternalNav(targetWith({ href: 'https://x.com' }), plain)).toBeNull();
	});

	test('hash / relative non-root → null', () => {
		expect(resolveInternalNav(targetWith({ href: '#section' }), plain)).toBeNull();
	});

	test('no anchor in click path → null', () => {
		expect(resolveInternalNav(targetWith(null), plain)).toBeNull();
	});

	test('modified clicks (new tab / middle button) → null', () => {
		const t = targetWith({ href: '/crm/1' });
		expect(resolveInternalNav(t, { ...plain, metaKey: true })).toBeNull();
		expect(resolveInternalNav(t, { ...plain, ctrlKey: true })).toBeNull();
		expect(resolveInternalNav(t, { ...plain, button: 1 })).toBeNull();
	});

	test('target=_blank → null', () => {
		expect(resolveInternalNav(targetWith({ href: '/crm/1', target: '_blank' }), plain)).toBeNull();
	});
});
