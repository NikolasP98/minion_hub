// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import Fixture from './PageHeader.fixture.svelte';

const PRIMARY = "[data-part='primary-actions'] > *";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PageHeader dominant action (spec 013, action scope `page`)', () => {
  it('renders one primary action in the page-scope header region', () => {
    const r = render(Fixture);
    const header = r.container.querySelector('[data-component="page-header"]')!;
    expect(header.getAttribute('data-action-scope')).toBe('page');
    expect(header.querySelectorAll(PRIMARY)).toHaveLength(1);
    expect(header.querySelectorAll("[data-part='secondary-actions'] > *")).toHaveLength(1);
  });

  it('warns in DEV when a header renders more than one primary action', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = render(Fixture, { primaries: 2 });
    expect(r.container.querySelectorAll(PRIMARY)).toHaveLength(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('renders 2 primary actions'));
  });
});
