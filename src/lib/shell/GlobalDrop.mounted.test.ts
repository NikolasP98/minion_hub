// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import { page } from '$app/state';
import Fixture from './GlobalDrop.fixture.svelte';
import { ApiError } from '$lib/api/fetch-json';
vi.mock('$lib/api/fetch-json', async (original) => {
  const actual = await original<typeof import('$lib/api/fetch-json')>();
  return { ...actual, fetchJson: vi.fn(async () => ({ files: [] })) };
});
vi.mock('$lib/records/peek-registry', () => ({ resolvePeekPage: () => null }));
afterEach(cleanup);
async function drop() {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      types: ['Files'],
      files: [new File(['sample'], 'sample.txt', { type: 'text/plain' })],
    },
  });
  await fireEvent(window, event);
}
function mount(receive: (files: File[], signal: AbortSignal) => Promise<void>) {
  page.data = { user: { id: 'actor' }, activeOrgId: 'org' };
  return render(Fixture, { receive });
}
describe('global drop chooser', () => {
  it('requires a destination and does not take a locally handled drop', async () => {
    const receive = vi.fn(async () => {});
    mount(receive);
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', {
      value: { types: ['Files'], files: [new File(['x'], 'local.txt', { type: 'text/plain' })] },
    });
    event.preventDefault();
    await fireEvent(window, event);
    expect(screen.queryByRole('button', { name: 'Target record' })).toBeNull();
    await drop();
    expect(receive).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Target record' }));
    await waitFor(() => expect(receive).toHaveBeenCalledOnce());
  });
  it('does not offer to replay a file whose upload acknowledgement was lost', async () => {
    const receive = vi.fn(async () => {
      throw new Error('lost reply');
    });
    mount(receive);
    await drop();
    await fireEvent.click(screen.getByRole('button', { name: 'Target record' }));
    await screen.findByText(/Could not confirm the upload/);
    expect(screen.queryByRole('button', { name: 'Target record' })).toBeNull();
    expect(receive).toHaveBeenCalledOnce();
  });
  it('allows a deliberate retry after a confirmed rejection', async () => {
    const receive = vi
      .fn<(files: File[], signal: AbortSignal) => Promise<void>>()
      .mockRejectedValueOnce(new ApiError('invalid file', 'validation', 422))
      .mockResolvedValue(undefined);
    mount(receive);
    await drop();
    await fireEvent.click(screen.getByRole('button', { name: 'Target record' }));
    await screen.findByRole('alert');
    await fireEvent.click(screen.getByRole('button', { name: 'Target record' }));
    await waitFor(() => expect(receive).toHaveBeenCalledTimes(2));
  });
});
