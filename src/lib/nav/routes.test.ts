import { describe, expect, it } from 'vitest';
import { palettePageRoutes, routeTitle } from './routes';

describe('Workforce Inbox navigation', () => {
	it('registers the HITL Inbox as the most-specific navigable workforce route', () => {
		expect(palettePageRoutes().map((route) => route.path)).toContain('/workforce/inbox');
		expect(routeTitle('/workforce/inbox')).toBeTruthy();
	});
});
