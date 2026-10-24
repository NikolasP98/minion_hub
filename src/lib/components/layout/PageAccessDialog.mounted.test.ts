// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({ invalidate: vi.fn(async () => {}), goto: vi.fn() }));

import PageAccessDialog from './PageAccessDialog.svelte';

const calls: { method: string; url: string; body: unknown }[] = [];
let failWrites = false;

beforeEach(() => {
  calls.length = 0;
  failWrites = false;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (init?.method === 'POST' || init?.method === 'DELETE') {
      calls.push({ method: init.method, url, body: JSON.parse(String(init.body)) });
      return new Response('{}', { status: failWrites ? 500 : 200 });
    }
    if (url === '/api/roles')
      return new Response(
        JSON.stringify({
          roles: [
            { key: 'owner', name: 'Owner', isSystem: true },
            { key: 'admin', name: 'Admin', isSystem: true },
            { key: 'staff', name: 'Staff', isSystem: true },
            { key: 'viewer', name: 'Viewer', isSystem: true },
          ],
        }),
      );
    return new Response(JSON.stringify({ viewer: false }));
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mount = () =>
  render(PageAccessDialog, {
    props: { open: true, subject: { key: 'page:k3x9q2', label: 'Sell' }, onclose: () => {} },
  });
const group = (name: string) => screen.findByRole('group', { name });
const btn = async (name: string, label: string) =>
  [...(await group(name)).querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!;

describe('PageAccessDialog', () => {
  it('lists roles, reflects stored rules and fixes owner/admin', async () => {
    mount();
    expect((await btn('Viewer', 'Deny')).getAttribute('aria-pressed')).toBe('true');
    expect((await btn('Staff', 'Inherit')).getAttribute('aria-pressed')).toBe('true');
    expect((await btn('Owner', 'Allow')).getAttribute('aria-pressed')).toBe('true');
    expect((await btn('Owner', 'Deny')).hasAttribute('disabled')).toBe(true);
    expect((await btn('Admin', 'Inherit')).hasAttribute('disabled')).toBe(true);
  });

  it('allow / deny POST view, inherit DELETEs', async () => {
    mount();
    await fireEvent.click(await btn('Staff', 'Allow'));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      method: 'POST',
      body: { roleKey: 'staff', module: 'page:k3x9q2', caps: { view: true } },
    });
    await fireEvent.click(await btn('Staff', 'Deny'));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].body).toMatchObject({ caps: { view: false } });
    await fireEvent.click(await btn('Staff', 'Inherit'));
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2]).toMatchObject({
      method: 'DELETE',
      body: { roleKey: 'staff', module: 'page:k3x9q2' },
    });
  });

  it('rolls the row back when the save fails', async () => {
    mount();
    failWrites = true;
    await fireEvent.click(await btn('Staff', 'Allow'));
    await waitFor(() => expect(calls).toHaveLength(1));
    await waitFor(async () =>
      expect((await btn('Staff', 'Inherit')).getAttribute('aria-pressed')).toBe('true'),
    );
  });
});
