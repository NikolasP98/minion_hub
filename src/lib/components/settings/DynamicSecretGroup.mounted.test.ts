// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { page } from '$app/state';
import DynamicSecretGroup from './DynamicSecretGroup.svelte';

const data = page.data as Record<string, unknown>;
const props = {
  groupKey: 'g',
  label: 'L',
  scopeLabel: 's',
  ownerPlugin: 'p',
  instances: [],
  onRotate: () => {},
  onClear: () => {},
  onProbe: async () => {},
};
const link = () => document.querySelector('a[href^="/settings/plugins"]');
afterEach(() => {
  cleanup();
  delete data.entitlements;
});

// Spec 043 R8: /settings/plugins 404s for an org without `ai`, so the manage link is not offered.
describe('DynamicSecretGroup plugin link and the plan', () => {
  it('no link without ai', () => {
    data.entitlements = { plan: 'base', features: [] };
    render(DynamicSecretGroup, props);
    expect(link()).toBeNull();
  });
  it('link with ai and with no entitlements (unchanged)', () => {
    render(DynamicSecretGroup, props);
    expect(link()).not.toBeNull();
    cleanup();
    data.entitlements = { plan: 'premium', features: ['ai'] };
    render(DynamicSecretGroup, props);
    expect(link()).not.toBeNull();
  });
});
