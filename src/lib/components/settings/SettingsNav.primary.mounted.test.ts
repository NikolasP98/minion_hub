// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';

const context = vi.hoisted(() => ({
  page: { url: new URL('https://hub.test/es/settings/appearance'), data: {} },
  goto: vi.fn(async () => {}),
}));
vi.mock('$app/state', () => ({ page: context.page }));
vi.mock('$lib/navigation', () => ({ goto: context.goto }));
vi.mock('$lib/state/features/user.svelte', () => ({ isAdmin: { value: true } }));
vi.mock('$lib/access/can.svelte', () => ({ canViewPath: () => true, hasFeature: () => true }));
import SettingsNav from './SettingsNav.svelte';

afterEach(cleanup);
beforeEach(() => {
  context.goto.mockClear();
  context.page.url = new URL('https://hub.test/es/settings/appearance');
});

describe('actual Settings navigation in the primary shell', () => {
  it('keeps its grouped searchable navigation and active route in primary layout', async () => {
    const view = render(SettingsNav, { primary: true });
    expect(view.getByRole('complementary').getAttribute('data-layout')).toBe('primary');
    expect(view.getByRole('link', { name: 'Appearance' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(view.getByRole('group', { name: 'Server' })).toBeTruthy();
    await fireEvent.input(view.getByRole('searchbox'), { target: { value: 'Security' } });
    expect(view.getByRole('button', { name: 'Security' })).toBeTruthy();
    expect(view.queryByRole('link', { name: 'Appearance' })).toBeNull();
    expect(view.queryByRole('group', { name: 'General' })).toBeNull();
  });

  it('opens a gateway tab from a Hub settings route', async () => {
    const view = render(SettingsNav, { primary: true });
    await fireEvent.click(view.getByRole('button', { name: 'Security' }));
    expect(context.goto).toHaveBeenCalledWith('/settings?s=security', undefined);
  });

  it('keeps scroll and replaces the query entry when already on gateway configuration', async () => {
    context.page.url = new URL('https://hub.test/es/settings?s=ai');
    const view = render(SettingsNav, { primary: true });
    await fireEvent.click(view.getByRole('button', { name: 'Security' }));
    expect(context.goto).toHaveBeenCalledWith('/settings?s=security', {
      replaceState: true,
      noScroll: true,
    });
  });
});
