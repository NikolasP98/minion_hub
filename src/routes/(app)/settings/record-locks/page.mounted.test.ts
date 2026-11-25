// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import * as m from '$lib/paraglide/messages';

vi.mock('$app/state', async () => {
  const { testPage } = await import('$lib/state/ui/__fixtures__/preference-owner.svelte');
  // The curl example reads the page origin.
  return {
    page: new Proxy(testPage, {
      get: (t, k) =>
        k === 'url' ? new URL('http://hub.test/settings/record-locks') : Reflect.get(t, k),
    }),
  };
});
const invalidate = vi.hoisted(() => vi.fn(async () => {}));
const goto = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('$lib/navigation', () => ({ invalidate, goto }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('$lib/state/ui/toast.svelte', () => ({
  toastSuccess: toast.success,
  toastError: toast.error,
}));

import Page from './+page.svelte';

type Data = ComponentProps<typeof Page>['data'];
const policy = { month: true, days: null, sunat: false, webhook: false };
const event = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  action: 'policy_changed',
  recordType: null,
  recordId: null,
  rules: [],
  actorKind: 'person',
  actorId: 'p1',
  actorName: 'Ada',
  reason: null,
  detail: { after: { month: true, days: 60, sunat: false, webhook: false } },
  refEventId: null,
  expiresAt: null,
  occurredAt: '2026-11-24T15:20:00.000Z',
  recordLabel: null,
  ...over,
});
const data = (over: Record<string, unknown> = {}) =>
  ({
    policy,
    isOwner: true,
    events: [],
    eventsLimit: 100,
    externalLocks: [],
    ...over,
  }) as unknown as Data;
const external = (over: Record<string, unknown> = {}) => ({
  id: 'l1',
  label: 'Contabilidad',
  upTo: '2026-10-31',
  recordId: null,
  recordLabel: null,
  actorName: 'contador-externo',
  createdAt: '2026-11-05T14:00:00.000Z',
  ...over,
});

const fetcher = vi.fn();
beforeEach(() => {
  fetcher.mockReset().mockResolvedValue(
    new Response(JSON.stringify({ policy }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  invalidate.mockClear();
  goto.mockClear();
  toast.success.mockClear();
  toast.error.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Settings → Record locks', () => {
  it('an owner turns on the days rule, sets 60 and saves', async () => {
    render(Page, { data: data() });
    const save = screen.getByRole('button', { name: m.record_locks_save() });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    await fireEvent.click(screen.getByRole('switch', { name: m.record_locks_rule_days() }));
    const input = screen.getByLabelText(m.record_locks_days_label()) as HTMLInputElement;
    expect(input.value).toBe('60');
    await fireEvent.input(input, { target: { value: '45' } });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    await fireEvent.click(save);

    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/settings/record-locks/policy');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ month: true, days: 45, webhook: false });
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(invalidate).toHaveBeenCalledWith('settings:record-locks');
  });

  it('an invalid number blocks the save and says what to fix', async () => {
    render(Page, { data: data({ policy: { ...policy, days: 30 } }) });
    const input = screen.getByLabelText(m.record_locks_days_label()) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '0' } });
    expect(
      (screen.getByRole('button', { name: m.record_locks_save() }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText(/entre 1 y 3650|from 1 to 3650/)).toBeTruthy();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('an admin sees the rules read-only with the owner note and no save button', () => {
    render(Page, { data: data({ isOwner: false, policy: { ...policy, days: 60 } }) });
    expect(screen.getByText(m.record_locks_readonly_note())).toBeTruthy();
    expect(screen.queryByRole('button', { name: m.record_locks_save() })).toBeNull();
    for (const sw of screen.getAllByRole('switch'))
      expect(
        sw.getAttribute('aria-disabled') === 'true' || (sw as HTMLButtonElement).disabled,
      ).toBe(true);
  });

  it('a refused save shows the translated next step', async () => {
    fetcher.mockResolvedValue(
      new Response(JSON.stringify({ error: 'x', code: 'owner_required' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    );
    render(Page, { data: data() });
    await fireEvent.click(screen.getByRole('switch', { name: m.record_locks_rule_month() }));
    await fireEvent.click(screen.getByRole('button', { name: m.record_locks_save() }));
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String(toast.error.mock.calls[0]![0])).toBe(m.record_locks_err_owner_required());
  });

  it('lists the audit rows newest first with the action, record link, rule and actor', () => {
    render(Page, {
      data: data({
        events: [
          event({
            id: 'e2',
            action: 'refused',
            recordType: 'stock_receipt',
            recordId: 'r-1',
            recordLabel: 'STE-2026-00488',
            rules: [{ rule: 'days', kind: 'days', unlockable: true, days: 60 }],
            detail: { code: 'record_locked' },
          }),
          event(),
        ],
      }),
    });
    expect(screen.getByText(m.record_locks_action_refused())).toBeTruthy();
    expect(screen.getByText(m.record_locks_action_policy_changed())).toBeTruthy();
    const link = screen.getByRole('link', { name: 'STE-2026-00488' });
    expect(link.getAttribute('href')).toBe('/stock/entries/r-1');
    const reason = m.record_locks_reason_days({ days: 60 });
    expect(screen.getByText((text) => text.includes(`${reason} · Ada`))).toBeTruthy();
  });

  it('shows the empty state, and "Cargar más" only when a full page came back', async () => {
    const { unmount } = render(Page, { data: data() });
    expect(screen.getByText(m.record_locks_audit_empty())).toBeTruthy();
    expect(screen.queryByRole('button', { name: m.record_locks_audit_more() })).toBeNull();
    unmount();

    render(Page, {
      data: data({
        eventsLimit: 2,
        events: [event({ id: 'a' }), event({ id: 'b' })],
      }),
    });
    await fireEvent.click(screen.getByRole('button', { name: m.record_locks_audit_more() }));
    expect(goto).toHaveBeenCalledWith('?events=102', expect.any(Object));
  });
});

describe('Settings → Record locks: webhook (spec 140 S4)', () => {
  it('an owner turns on "Por webhook" and the save sends webhook:true', async () => {
    render(Page, { data: data() });
    await fireEvent.click(screen.getByRole('switch', { name: m.record_locks_rule_webhook() }));
    await fireEvent.click(screen.getByRole('button', { name: m.record_locks_save() }));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ month: true, days: null, webhook: true });
  });

  it('"Tras SUNAT" is shown off and cannot be switched yet', () => {
    render(Page, { data: data() });
    const sw = screen.getByRole('switch', { name: m.record_locks_rule_sunat() });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(sw.getAttribute('aria-disabled') === 'true' || (sw as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('lists the external locks with label, scope and key, and shows the curl example when empty', () => {
    const { unmount } = render(Page, { data: data() });
    expect(screen.getByText(m.record_locks_external_empty())).toBeTruthy();
    expect(screen.getByText(/\/api\/hooks\/record-locks/, { selector: 'pre' })).toBeTruthy();
    unmount();
    render(Page, {
      data: data({
        externalLocks: [
          external(),
          external({
            id: 'l2',
            label: 'Auditoría',
            upTo: null,
            recordId: 'r-9',
            recordLabel: 'STE-2026-00559',
            actorName: 'auditor',
          }),
        ],
      }),
    });
    expect(screen.getByText('Contabilidad')).toBeTruthy();
    expect(screen.getByText('contador-externo')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'STE-2026-00559' }).getAttribute('href')).toBe(
      '/stock/entries/r-9',
    );
  });

  it('an owner lifts a lock with a reason; an admin sees no lift button', async () => {
    render(Page, { data: data({ externalLocks: [external()] }) });
    await fireEvent.click(screen.getByRole('button', { name: m.record_locks_external_lift() }));
    const confirm = screen.getByRole('button', {
      name: m.record_locks_external_lift_confirm(),
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await fireEvent.input(screen.getByLabelText(/Reason|Motivo/), {
      target: { value: 'ya corregido' },
    });
    await fireEvent.click(confirm);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/settings/record-locks/locks/l1/lift');
    expect(JSON.parse(init.body as string)).toEqual({ reason: 'ya corregido' });
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledWith('settings:record-locks'));
    cleanup();
    render(Page, { data: data({ isOwner: false, externalLocks: [external()] }) });
    expect(screen.queryByRole('button', { name: m.record_locks_external_lift() })).toBeNull();
  });
});
