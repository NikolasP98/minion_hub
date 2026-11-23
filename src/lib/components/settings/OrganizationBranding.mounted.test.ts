// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
vi.mock('$app/state', async () => ({
  page: Object.assign(
    (await import('$lib/state/ui/__fixtures__/preference-owner.svelte')).testPage,
    { status: 200, error: null },
  ),
}));
vi.mock('$app/navigation', () => ({ invalidate: vi.fn() }));
vi.mock('$lib/services/actions/context', () => ({ tryUseActions: () => runtime }));
import { invalidate } from '$app/navigation';
import { testPage } from '$lib/state/ui/__fixtures__/preference-owner.svelte';
import { createActionRuntime } from '$lib/services/actions/runtime.svelte';
import { resolveBranding, type Branding } from '$lib/branding';
import OrganizationBranding from './OrganizationBranding.svelte';
let runtime: ReturnType<typeof createActionRuntime>;
const data = testPage.data as typeof testPage.data & { branding?: Branding };
const branding = (name = 'Faces', orgId = 'org-a') =>
  resolveBranding({ id: orgId, name: 'Organization', hub_name: name });
const settings = (overrides = {}) => ({
  organizationName: 'Organization',
  hubName: 'Faces' as string | null,
  branding: branding(),
  canViewBrandingSettings: true,
  canEditBranding: true,
  ...overrides,
});
const reply = (name = 'New') =>
  new Response(JSON.stringify({ branding: branding(name), hubName: name }), { status: 200 });
const edit = async (value = 'New') => {
  await fireEvent.input(screen.getByLabelText('Hub name'), { target: { value } });
};
const save = async () => {
  await fireEvent.click(screen.getByRole('button', { name: 'Save shared name' }));
};
beforeEach(() => {
  runtime = createActionRuntime();
  data.user = { id: 'actor-a' };
  data.activeOrgId = 'org-a';
  data.branding = branding();
  vi.mocked(invalidate).mockReset();
  vi.mocked(invalidate).mockImplementation(async () => {
    flushSync(() => {
      data.branding = branding('New');
    });
  });
});
afterEach(() => {
  cleanup();
  runtime.dispose();
  vi.unstubAllGlobals();
});

describe('organization branding editor', () => {
  it('keeps last committed shell identity and the draft on a known HTTP rejection', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 403 }));
    vi.stubGlobal('fetch', fetcher);
    render(OrganizationBranding, { settings: settings() });
    await edit();
    await save();
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Retry save' })).toBeTruthy());
    expect((screen.getByLabelText('Hub name') as HTMLInputElement).value).toBe('New');
    expect(data.branding?.fullName).toBe('Faces Hub');
    expect(runtime.attention[0].status).toBe('failed');
    expect(invalidate).not.toHaveBeenCalled();
  });
  it('preserves an unsent draft if runtime admission rejects without dispatch', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    runtime.dispose();
    render(OrganizationBranding, { settings: settings() });
    await edit();
    await save();
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Retry save' })).toBeTruthy());
    expect(fetcher).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Hub name') as HTMLInputElement).value).toBe('New');
  });
  it('reconciles the original acknowledged action on refresh-only recovery without another PATCH', async () => {
    const fetcher = vi.fn(async () => reply());
    vi.stubGlobal('fetch', fetcher);
    vi.mocked(invalidate).mockRejectedValueOnce(new Error('refresh failed'));
    render(OrganizationBranding, { settings: settings() });
    await edit();
    await save();
    await vi.waitFor(() => expect(runtime.attention[0]?.status).toBe('committed-refreshing'));
    const actionId = runtime.attention[0].id;
    await fireEvent.click(screen.getByRole('button', { name: 'Retry refresh' }));
    await vi.waitFor(() => expect(runtime.get(actionId)?.status).toBe('succeeded'));
    expect(runtime.attention).toHaveLength(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Shared name saved.')).toBeTruthy();
  });
  it('retains unknown operation history after a matching authoritative reload and enables deliberate new save', async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError('lost response');
    });
    vi.stubGlobal('fetch', fetcher);
    render(OrganizationBranding, { settings: settings() });
    await edit();
    await save();
    await vi.waitFor(() => expect(runtime.attention[0]?.status).toBe('unknown'));
    const actionId = runtime.attention[0].id;
    expect(
      (screen.getByRole('button', { name: 'Save shared name' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: 'Reload current name' }));
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save as a new change' })).toBeTruthy(),
    );
    expect(runtime.get(actionId)?.status).toBe('unknown');
    expect(runtime.attention).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('keeps acknowledged refresh pending when the current projection is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply()),
    );
    vi.mocked(invalidate).mockImplementation(async () => {
      flushSync(() => {
        data.branding = { ...branding(), readStatus: 'unavailable' };
      });
    });
    render(OrganizationBranding, { settings: settings() });
    await edit();
    await save();
    await vi.waitFor(() => expect(runtime.attention[0]?.status).toBe('committed-refreshing'));
    await fireEvent.click(screen.getByRole('button', { name: 'Retry refresh' }));
    await vi.waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Retry refresh' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(runtime.attention[0].status).toBe('committed-refreshing');
  });
  it('cannot publish or invalidate a delayed save after organization replacement', async () => {
    let done!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            done = resolve;
          }),
      ),
    );
    const view = render(OrganizationBranding, { settings: settings() });
    await edit();
    await save();
    flushSync(() => {
      data.activeOrgId = 'org-b';
      data.branding = branding('Second', 'org-b');
    });
    await view.rerender({
      settings: settings({ hubName: 'Second', branding: branding('Second', 'org-b') }),
    });
    done(reply());
    await vi.waitFor(() =>
      expect((screen.getByLabelText('Hub name') as HTMLInputElement).value).toBe('Second'),
    );
    expect(invalidate).not.toHaveBeenCalled();
    expect(data.branding?.name).toBe('Second');
  });
  it('retires pending work when permission is revoked and hides controls for a read-only member', async () => {
    let done!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            done = resolve;
          }),
      ),
    );
    const view = render(OrganizationBranding, { settings: settings() });
    await edit();
    await save();
    await view.rerender({ settings: settings({ canEditBranding: false }) });
    done(reply());
    expect(screen.queryByRole('button', { name: 'Save shared name' })).toBeNull();
    expect(invalidate).not.toHaveBeenCalled();
  });
  it('hides the shared setting independently of personal Appearance access', () => {
    render(OrganizationBranding, { settings: settings({ canViewBrandingSettings: false }) });
    expect(screen.queryByLabelText('Hub name')).toBeNull();
  });
  it('validates before dispatch and offers explicit MINION and automatic choices', async () => {
    const fetcher = vi.fn(async () => reply('MINION'));
    vi.stubGlobal('fetch', fetcher);
    render(OrganizationBranding, { settings: settings() });
    await edit('W'.repeat(16));
    expect(
      (screen.getByRole('button', { name: 'Save shared name' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: 'Use organization name' }));
    expect(screen.getByRole('img', { name: 'Organization Hub' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Use MINION' }));
    await save();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ hubName: 'MINION' });
  });
});

it('persists null for automatic mode, applies long-name fallback, and reacts to full-name changes', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ branding: resolveBranding({ id: 'org-a', name: 'Organization' }), hubName: null })));
  vi.stubGlobal('fetch', fetcher);
  const view = render(OrganizationBranding, { settings: settings({ hubName: null, organizationName: 'A very long organization name' }) });
  expect(screen.getByRole('img', { name: 'MINION Hub' })).toBeTruthy();
  await view.rerender({ settings: settings({ hubName: null, organizationName: 'Short' }) });
  expect(screen.getByRole('img', { name: 'Short Hub' })).toBeTruthy();
  await save();
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(init.body as string)).toEqual({ hubName: null });
});

it('keeps a custom prefix when the full organization name changes', async () => {
  const view = render(OrganizationBranding, { settings: settings() });
  await view.rerender({ settings: settings({ organizationName: 'Another organization name' }) });
  expect(screen.getByRole('img', { name: 'Faces Hub' })).toBeTruthy();
  expect((screen.getByLabelText('Hub name') as HTMLInputElement).value).toBe('Faces');
});

it('rejects a malformed successful reply as unknown without refresh or a false acknowledgement', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ branding: branding('New', 'org-foreign'), hubName: 'New' }))));
  render(OrganizationBranding, { settings: settings() }); await edit(); await save();
  await vi.waitFor(() => expect(runtime.attention[0]?.status).toBe('unknown'));
  expect(invalidate).not.toHaveBeenCalled();
  expect(data.branding?.fullName).toBe('Faces Hub');
});

it('retires pending editor state when the action runtime changes scope for the same account and org', async () => {
  let done!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { done = resolve; })));
  render(OrganizationBranding, { settings: settings() }); await edit(); await save();
  flushSync(() => runtime.setScope('new-authority-generation'));
  expect((screen.getByLabelText('Hub name') as HTMLInputElement).value).toBe('Faces');
  expect((screen.getByRole('button', { name: 'Save shared name' }) as HTMLButtonElement).disabled).toBe(false);
  done(reply());
  await Promise.resolve();
  expect(invalidate).not.toHaveBeenCalled();
});

it('explains a complex one-grapheme name without dispatching a shared change', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  render(OrganizationBranding, { settings: settings() });
  const complexName = 'a' + '\u0301'.repeat(130);
  await edit(complexName);
  expect(screen.getByText('This name is too complex. Use fewer accents or simpler characters.')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Save shared name' }) as HTMLButtonElement).disabled).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
});

it('explains unavailable browser validation independently of a ready authorized server projection', () => {
  const ready = settings();
  vi.stubGlobal('Intl', Object.assign(Object.create(Intl), { Segmenter: undefined }));
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  render(OrganizationBranding, { settings: ready });
  expect(screen.getByText('This browser cannot validate Hub names. Use an updated browser to choose a Hub name.')).toBeTruthy();
  expect(screen.queryByText('Only an organization owner with permission to manage settings can change this name.')).toBeNull();
  expect((screen.getByLabelText('Hub name') as HTMLInputElement).disabled).toBe(true);
  expect(screen.queryByRole('button', { name: 'Save shared name' })).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});
