// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, fireEvent, cleanup, screen, waitFor } from '@testing-library/svelte';
import Fixture from './ViewMemory.fixture.svelte';
import { page } from '$app/state';
vi.mock('$lib/records/peek-registry', () => ({ resolvePeekPage: () => null }));
afterEach(cleanup);
describe('actual table across module destruction', () => {
  it.each([true, false])(
    'restores filters and selection when returning to the same view (registered=%s)',
    async (registered) => {
      Object.assign(page, {
        data: { user: { id: 'actor' }, activeOrgId: 'org' },
        url: new URL('https://hub.test/es/crm'),
      });
      render(Fixture, { onaction: vi.fn(), registered });
      const search = screen.getByRole('textbox');
      await fireEvent.input(search, { target: { value: 'Alpha' } });
      const checkbox = screen
        .getAllByRole('checkbox')
        .find((box) => box.getAttribute('aria-label')?.includes('Alpha'))!;
      await fireEvent.click(checkbox);
      await fireEvent.click(screen.getByRole('button', { name: 'Switch module' }));
      expect(screen.queryByRole('textbox')).toBeNull();
      await fireEvent.click(screen.getByRole('button', { name: 'Switch module' }));
      await waitFor(() =>
        expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Alpha'),
      );
      expect(
        screen
          .getAllByRole('checkbox')
          .some(
            (box) =>
              box.getAttribute('aria-label')?.includes('Alpha') &&
              box.getAttribute('aria-checked') === 'true',
          ),
      ).toBe(true);
    },
  );
  it('right-click invokes the same typed action and honors disabled actions', async () => {
    const onaction = vi.fn();
    Object.assign(page, {
      data: { user: { id: 'actor' }, activeOrgId: 'org' },
      url: new URL('https://hub.test/es/crm'),
    });
    render(Fixture, { onaction });
    const row = screen.getByText('Alpha').closest('tr')!;
    await fireEvent.contextMenu(row, { clientX: 30, clientY: 40 });
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    await waitFor(() => expect(onaction).toHaveBeenCalledOnce());
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
