import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for createBackNav.
 *
 * Bug: MIN-1353 — back button from CRM detail page dropped filter query params.
 *
 * Root cause: createBackNav captured referrer from nav.from (SvelteKit), but
 * on direct loads (no nav.from), fallback goto lost query params.
 *
 * Fix: when nav.from is absent, parse document.referrer to capture the real
 * in-app referrer path+search. history.back() then returns to the exact
 * filtered list.
 */
describe('createBackNav', () => {
	const mockGoto = vi.fn();
	const mockHistoryBack = vi.fn();

	beforeEach(() => {
		vi.resetModules();
		mockGoto.mockClear();
		mockHistoryBack.mockClear();
		global.history = { back: mockHistoryBack } as never;
	});

	it('calls history.back when there is a SvelteKit referrer', async () => {
		const { createBackNav } = await import('./back-nav.svelte');
		vi.doMock('$app/navigation', () => ({
			goto: mockGoto,
			afterNavigate: (fn: (nav: { from: { url: { pathname: string; search: string } }; to: { url: { pathname: string } } }) => void) => {
				fn({
					from: { url: { pathname: '/crm/customers', search: '?funnel=lead' } },
					to: { url: { pathname: '/crm/123' } },
				});
			},
		}));

		const back = createBackNav('/crm/customers', () => 'Back');
		back.go();

		expect(mockHistoryBack).toHaveBeenCalledOnce();
		expect(mockGoto).not.toHaveBeenCalled();
	});

	it('uses document.referrer when nav.from is absent (direct load)', async () => {
		const { createBackNav } = await import('./back-nav.svelte');
		const mockDocument = {
			referrer: 'http://localhost:5173/crm/customers?funnel=lead',
		};
		global.document = mockDocument as never;
		global.location = { origin: 'http://localhost:5173' } as never;

		vi.doMock('$app/navigation', () => ({
			goto: mockGoto,
			afterNavigate: (fn: (nav: { from: null; to: { url: { pathname: string; search: string } } }) => void) => {
				fn({ from: null, to: { url: { pathname: '/crm/123', search: '' } } });
			},
		}));

		const back = createBackNav('/crm/customers', () => 'Back to list');
		back.go();

		// Should extract /crm/customers?funnel=lead from document.referrer and use history.back
		expect(mockHistoryBack).toHaveBeenCalledOnce();
		expect(mockGoto).not.toHaveBeenCalled();
	});

	it('uses base fallback when no referrer is available', async () => {
		const { createBackNav } = await import('./back-nav.svelte');
		global.document = { referrer: '' } as never;

		vi.doMock('$app/navigation', () => ({
			goto: mockGoto,
			afterNavigate: (fn: (nav: { from: null; to: { url: { pathname: string; search: string } } }) => void) => {
				fn({ from: null, to: { url: { pathname: '/crm/123', search: '' } } });
			},
		}));

		const back = createBackNav('/crm/customers', () => 'Back');
		back.go();

		expect(mockHistoryBack).not.toHaveBeenCalled();
		expect(mockGoto).toHaveBeenCalledWith('/crm/customers');
	});
});
