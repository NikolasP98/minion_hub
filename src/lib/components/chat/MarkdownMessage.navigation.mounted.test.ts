// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import MarkdownMessage from './MarkdownMessage.svelte';
import { goto } from '$lib/navigation';
import { setLanguageTag } from '$lib/paraglide/runtime';

const access = vi.hoisted(() => ({ allowed: true }));
vi.mock('$lib/access/can.svelte', () => ({ canViewPath: () => access.allowed }));
vi.mock('$lib/navigation', () => ({ goto: vi.fn() }));
const fence = (tool: string, input: Record<string, unknown> = {}) =>
  '```minion-ui\n' + JSON.stringify({ tool, input }) + '\n```';
const nav = fence('hub.navigate', { path: '/pos/catalog', params: { q: 'a & b' } });
afterEach(() => {
  cleanup();
  access.allowed = true;
  vi.clearAllMocks();
  setLanguageTag('en');
});

describe('user-click navigation links', () => {
  it.each(['', 'Here is the catalog.\n\n'])(
    'renders inert links with prose %j; actual click is the only navigation',
    async (prose) => {
      const view = render(MarkdownMessage, { value: prose + nav });
      const link = view.getByRole('link', { name: /Open / });
      expect(link.getAttribute('href')).toBe('/en/pos/catalog?q=a+%26+b');
      expect(goto).not.toHaveBeenCalled();
      await view.rerender({ value: prose + nav });
      expect(goto).not.toHaveBeenCalled();
      await fireEvent.click(link);
      expect(goto).toHaveBeenCalledExactlyOnceWith('/en/pos/catalog?q=a+%26+b');
    },
  );
  it('revalidates permission on click even before a rerender', async () => {
    const view = render(MarkdownMessage, { value: nav });
    const link = view.getByRole('link');
    access.allowed = false;
    await fireEvent.click(link);
    expect(goto).not.toHaveBeenCalled();
  });
  it('denied and hostile destinations do not render links', () => {
    access.allowed = false;
    const view = render(MarkdownMessage, {
      value: nav + fence('hub.navigate', { path: '//evil.test' }),
    });
    expect(view.queryByRole('link')).toBeNull();
  });
  it('does not fabricate completion for suppressed fills and guides', () => {
    const view = render(MarkdownMessage, { value: fence('fill_test') + nav + fence('ui.guide') });
    expect(view.container.textContent).not.toMatch(/Opened|Filled|Started|✓/);
    expect(view.getByRole('link')).toBeTruthy();
  });
  it('renders Spanish link text and locale', () => {
    setLanguageTag('es');
    const view = render(MarkdownMessage, { value: nav });
    expect(view.getByRole('link', { name: /Abrir / }).getAttribute('href')).toBe(
      '/es/pos/catalog?q=a+%26+b',
    );
  });
  it('retains ordinary source-link clicks', async () => {
    const view = render(MarkdownMessage, { value: '[Catalog](/pos/catalog)' });
    await fireEvent.click(view.getByRole('link', { name: 'Catalog' }));
    expect(goto).toHaveBeenCalledExactlyOnceWith('/pos/catalog');
  });
});
