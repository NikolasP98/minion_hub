// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
vi.mock('$lib/state/ui/toast.svelte', () => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('$lib/components/ui', async () => ({
  Button: (await import('@minion-stack/ui')).Button,
  Select: (await import('$lib/components/ui/Select.svelte')).default,
}));
import JoinLinkForm from './JoinLinkForm.svelte';

const legacy = {
  id: 'legacy',
  name: 'Existing',
  roleModel: 'legacy' as const,
  defaultRoleKey: null,
};
const local = {
  id: 'local',
  name: 'New',
  roleModel: 'organization' as const,
  defaultRoleKey: 'custom-admin',
  roles: [
    { key: 'custom-admin', name: 'Administrator' },
    { key: 'custom-marketing', name: 'Marketing' },
  ],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('organization-local invitation role selection', () => {
  // Fresh mounts exercise each direction: this happy-dom version incorrectly
  // caches selectedOptions across property-only selection changes on one select.
  it('selects the local default, then submits the chosen role while describing the configured default', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ url: 'https://example.test/join/local' }));
    vi.stubGlobal('fetch', fetch);
    const view = render(JoinLinkForm, { organizations: [legacy, local] });
    const [organization, role] = view.getAllByRole('combobox') as HTMLSelectElement[];
    expect(role.value).toBe('staff');
    await fireEvent.change(organization, { target: { selectedIndex: 1 } });
    expect(role.value).toBe('custom-admin');
    const generate = view.getByRole('button', { name: 'Generate link' }) as HTMLButtonElement;
    expect(generate.disabled).toBe(false);
    await fireEvent.change(role, { target: { selectedIndex: 1 } });
    expect(role.value).toBe('custom-marketing');
    expect(view.getByText(/New members receive Administrator/)).toBeTruthy();
    await fireEvent.submit(generate.closest('form')!);
    expect(fetch).toHaveBeenCalledWith('/api/join-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ organizationId: 'local', role: 'custom-marketing' }),
    });
  });

  it('clears the local role when switching back to a legacy organization and submits Staff', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ url: 'https://example.test/join/legacy' }));
    vi.stubGlobal('fetch', fetch);
    const view = render(JoinLinkForm, { organizations: [local, legacy] });
    const [organization, role] = view.getAllByRole('combobox') as HTMLSelectElement[];
    expect(role.value).toBe('custom-admin');
    await fireEvent.change(role, { target: { selectedIndex: 1 } });
    expect(role.value).toBe('custom-marketing');
    await fireEvent.change(organization, { target: { selectedIndex: 1 } });
    expect(role.value).toBe('staff');
    expect(Array.from(role.options, (option) => option.value)).toEqual([
      'admin',
      'manager',
      'staff',
      'viewer',
    ]);
    expect(view.queryByText(/New members receive/)).toBeNull();
    const generate = view.getByRole('button', { name: 'Generate link' }) as HTMLButtonElement;
    expect(generate.disabled).toBe(false);
    await fireEvent.submit(generate.closest('form')!);
    expect(fetch).toHaveBeenCalledWith('/api/join-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ organizationId: 'legacy', role: 'staff' }),
    });
  });
});
