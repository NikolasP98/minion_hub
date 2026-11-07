import { describe, expect, it } from 'vitest';
import {
  EMPTY_NAV_CONFIG,
  normalizeNavConfig,
  setOrgLandingPage,
  validateNavConfig,
  visibleNavConfig,
} from './custom-sections';
import { navConfigSchema } from './nav-config-schema';

// Spec 046 FR-009: the org landing page rides in the nav document.
describe('nav document landingPage', () => {
  it('round-trips through the schema, normalize and the member view', () => {
    const doc = setOrgLandingPage(EMPTY_NAV_CONFIG, '/overview');
    expect(EMPTY_NAV_CONFIG.landingPage).toBeUndefined();
    const parsed = navConfigSchema.parse(JSON.parse(JSON.stringify(doc)));
    expect(parsed.landingPage).toBe('/overview');
    const stored = normalizeNavConfig(parsed);
    expect(stored.landingPage).toBe('/overview');
    expect(visibleNavConfig(stored, new Set(), false).landingPage).toBe('/overview');
    expect(validateNavConfig(stored, { reserved: new Set(), targets: new Set() })).toEqual([]);
  });

  it('clears with null', () => {
    const doc = setOrgLandingPage(setOrgLandingPage(EMPTY_NAV_CONFIG, '/team'), null);
    expect('landingPage' in doc).toBe(false);
    expect(normalizeNavConfig(doc).landingPage).toBeUndefined();
  });

  it('the schema refuses an off-site landing page', () => {
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com'])
      expect(navConfigSchema.safeParse({ ...EMPTY_NAV_CONFIG, landingPage: bad }).success).toBe(
        false,
      );
  });
});
