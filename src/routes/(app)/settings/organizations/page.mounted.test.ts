// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
vi.mock('$lib/access/can.svelte', () => ({ canViewPath: () => false }));
import Page from './+page.svelte';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('suggests a bounded name then preserves an edited prefix across full-name changes and retry', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: false, organization: null, steps: [] })));
  vi.stubGlobal('fetch', fetcher);
  render(Page, { data: { organizations: [] } });
  await fireEvent.input(screen.getByRole('textbox', { name: /^Organization name/ }), { target: { value: 'Faces' } });
  expect((screen.getByLabelText('Hub name') as HTMLInputElement).value).toBe('Faces');
  await fireEvent.input(screen.getByLabelText('Hub name'), { target: { value: 'Team' } });
  await fireEvent.input(screen.getByRole('textbox', { name: /^Organization name/ }), { target: { value: 'Faces Organization' } });
  expect((screen.getByLabelText('Hub name') as HTMLInputElement).value).toBe('Team');
  await fireEvent.submit(screen.getByRole('textbox', { name: /^Organization name/ }).closest('form')!);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(init.body as string)).toMatchObject({ name: 'Faces Organization', hubName: 'Team' });
  await fireEvent.submit(screen.getByRole('textbox', { name: /^Organization name/ }).closest('form')!);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  const [, retryInit] = fetcher.mock.calls[1] as unknown as [string, RequestInit];
  expect(JSON.parse(retryInit.body as string).hubName).toBe('Team');
});
it('rejects over-bound manual prefixes before provisioning effects', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  render(Page, { data: { organizations: [] } });
  await fireEvent.input(screen.getByRole('textbox', { name: /^Organization name/ }), { target: { value: 'Faces' } });
  await fireEvent.input(screen.getByLabelText('Hub name'), { target: { value: 'W'.repeat(16) } });
  await fireEvent.submit(screen.getByRole('textbox', { name: /^Organization name/ }).closest('form')!);
  expect(fetcher).not.toHaveBeenCalled();
});
