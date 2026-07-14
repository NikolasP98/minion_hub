import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import AsyncBoundary from './AsyncBoundary.svelte';
import Dialog from './Dialog.svelte';
import FoundationHarness from './foundation-test-harness.svelte';
import SectionNav from './SectionNav.svelte';
import SectionNavBusinessFixture from './section-nav-business-fixture.svelte';
import { assertDialogLabel } from './dialog';
import { clampWindowRect, moveWindowBy, resizeWindowBy } from './draggable-window';

describe('composition foundations', () => {
  it('associates a field label and helper with one stable control id', () => {
    const body = render(FoundationHarness).body;
    expect(body).toContain('for="agent-name"');
    expect(body).toContain('id="agent-name"');
    expect(body).toContain('required');
    expect(body).toMatch(/aria-describedby="[^"]+-helper"/);
    expect(body).toContain('Shown to operators');
  });

  it('names dialogs and exposes stable component parts', () => {
    const body = render(Dialog, { props: { open: true, title: 'Delete draft' } }).body;
    expect(body).toContain('data-component="dialog"');
    expect(body).toMatch(/aria-labelledby="[^"]+-title"/);
    expect(body).toContain('Delete draft');
    expect(body).toContain('data-part="close-trigger"');
  });

  it('rejects an unnamed dialog contract', () => {
    expect(() => assertDialogLabel()).toThrow(/requires a title/i);
  });

  it('renders visibly distinct async failure states', () => {
    const retry = vi.fn();
    const error = render(AsyncBoundary, {
      props: { state: { kind: 'error', description: 'Request failed', retry } },
    }).body;
    const unavailable = render(AsyncBoundary, {
      props: { state: { kind: 'unavailable', title: 'Gateway offline' } },
    }).body;
    expect(error).toContain('data-state="error"');
    expect(error).toContain('role="alert"');
    expect(unavailable).toContain('data-state="unavailable"');
    expect(unavailable).toContain('Gateway offline');
  });

  it('keeps section labels visible and disables links without href', () => {
    const body = render(SectionNav, {
      props: {
        ariaLabel: 'Settings',
        activeId: 'general',
        items: [
          { id: 'general', label: 'General', href: '/settings' },
          { id: 'billing', label: 'Billing', href: '/settings/billing', disabled: true },
        ],
      },
    }).body;
    expect(body).toContain('General');
    expect(body).toContain('Billing');
    expect(body).toContain('aria-current="page"');
    expect(body).toContain('aria-disabled="true"');
    expect(body).not.toContain('href="/settings/billing"');
  });

  it('renders a labelled section search without turning routed links into selection buttons', () => {
    const body = render(SectionNav, {
      props: {
        ariaLabel: 'Settings',
        search: { enabled: true, placeholder: 'Search settings' },
        items: [{ id: 'appearance', label: 'Appearance', href: '/settings/appearance' }],
      },
    }).body;
    expect(body).toContain('type="search"');
    expect(body).toContain('aria-label="Search settings"');
    expect(body).toContain('href="/settings/appearance"');
  });

  it('keeps nested destinations and persistent operational context in the responsive section nav', () => {
    const body = render(SectionNavBusinessFixture).body;
    expect(body).toContain('aria-label="Operations"');
    expect(body).toMatch(/class="[^"]*nested[^"]*"/);
    expect(body).toContain('href="/operations/insights"');
    expect(body).toMatch(/class="nav-footer[^"]*"/);
    expect(body).toContain('Open shift');
  });

  it('keeps the legacy PageHeader action contract while adding priority hooks', () => {
    const body = render(FoundationHarness).body;
    expect(body).toContain('data-component="page-header"');
    expect(body).toMatch(/<h1 id="fixture-title"[^>]*>Agents<\/h1>/);
    expect(body).toContain('Operator roster');
    expect(body).toContain('data-part="primary-actions"');
    expect(body).toContain('data-part="secondary-actions"');
    expect(body).toContain('data-part="overflow-actions"');
  });

  it('clamps floating-window geometry and supports keyboard-sized deltas', () => {
    const rect = clampWindowRect(
      { x: 2000, y: -20, width: 120, height: 2000 },
      { width: 1200, height: 800 },
      { width: 360, height: 280 },
    );
    expect(rect).toEqual({ x: 1120, y: 0, width: 360, height: 800 });
    expect(moveWindowBy(rect, -16, 16).x).toBe(1104);
    expect(resizeWindowBy(rect, 16, -16).height).toBe(784);
  });
});
