// @vitest-environment happy-dom
/** Spec 139 S3: the wait-time field and the two notices on the reminders settings page. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import PageBody from './PageBody.svelte';

vi.mock('$app/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$app/environment')>()),
  browser: true,
}));
vi.mock('@sentry/sveltekit', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('$app/navigation', () => ({ invalidate: vi.fn(), goto: vi.fn(), afterNavigate: vi.fn() }));
vi.mock('$lib/access/can.svelte', () => ({ canAct: () => true, canViewPath: () => true }));
vi.mock('$lib/access/premium', () => ({ hasFeature: () => false }));

type Data = ComponentProps<typeof PageBody>['data'];
const account = (over: Record<string, unknown> = {}) => ({
  channel: 'whatsapp',
  accountId: 'acct-1',
  name: 'FACES Recepción',
  phone: null,
  enabled: true,
  linked: true,
  ...over,
});
const data = (over: Record<string, unknown> = {}, cfg: Record<string, unknown> = {}): Data =>
  ({
    config: {
      enabled: true,
      stages: [],
      channels: [{ channel: 'whatsapp', accountId: 'acct-1' }],
      channel: 'whatsapp',
      accountId: null,
      personalize: false,
      inferConfirmation: false,
      fromName: null,
      negationWaitHours: 24,
      ...cfg,
    },
    activity: { counts: { sent: 0, failed: 0, skipped: 0 }, recent: [] },
    channels: [account()],
    channelsChecked: true,
    ...over,
  }) as unknown as Data;

let puts: Array<Record<string, unknown>>;
let putStatus = 200;
beforeEach(() => {
  puts = [];
  putStatus = 200;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)));
        return Response.json({ ok: putStatus === 200 }, { status: putStatus });
      }
      return Response.json({});
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('reminders settings notices', () => {
  it('shows none when everything is fine', () => {
    const v = render(PageBody, { data: data() });
    expect(v.queryByText(/Reminders are off/)).toBeNull();
    expect(v.queryByText(/WhatsApp disconnected/)).toBeNull();
    expect(v.queryByText(/could not check/)).toBeNull();
  });

  it('"Reminders are off" when the agent is disabled', () => {
    const v = render(PageBody, { data: data({}, { enabled: false }) });
    expect(
      v.getByText(/Reminders are off\. Clients receive no messages or follow-up\./),
    ).toBeTruthy();
  });

  it('"WhatsApp disconnected" names the chosen account that is not linked', () => {
    const v = render(PageBody, { data: data({ channels: [account({ linked: false })] }) });
    expect(
      v.getByText(/WhatsApp disconnected\. The number “FACES Recepción” is not linked/),
    ).toBeTruthy();
  });

  it('an unlinked account that was NOT chosen raises nothing', () => {
    const v = render(PageBody, {
      data: data({ channels: [account({ accountId: 'other', linked: false })] }),
    });
    expect(v.queryByText(/WhatsApp disconnected/)).toBeNull();
  });

  it('says so when the gateway did not answer, and stays silent for a viewer without channels access', () => {
    const unchecked = render(PageBody, { data: data({ channelsChecked: false, channels: [] }) });
    expect(unchecked.getByText(/We could not check the WhatsApp connection/)).toBeTruthy();
    cleanup();
    const denied = render(PageBody, { data: data({ channelsChecked: null, channels: [] }) });
    expect(denied.queryByText(/could not check/)).toBeNull();
  });
});

describe('agent wait time', () => {
  const field = (v: { container: HTMLElement }) =>
    v.container.querySelector<HTMLInputElement>(
      'input[type="number"][aria-describedby="sched-rem-wait-help"]',
    )!;

  it('shows the saved hours', () => {
    expect(field(render(PageBody, { data: data({}, { negationWaitHours: 12 }) })).value).toBe('12');
  });

  it('saves a valid value on blur', async () => {
    const v = render(PageBody, { data: data() });
    await fireEvent.input(field(v), { target: { value: '12' } });
    await fireEvent.blur(field(v));
    await waitFor(() => expect(puts).toEqual([{ negationWaitHours: 12 }]));
  });

  it('refuses 0 and 169 with the range message and sends nothing', async () => {
    const v = render(PageBody, { data: data() });
    for (const bad of ['0', '169', '2.5', '']) {
      await fireEvent.input(field(v), { target: { value: bad } });
      await fireEvent.blur(field(v));
      expect(v.getByText(/The wait time is 1 to 168 hours\./)).toBeTruthy();
      expect(field(v).getAttribute('aria-invalid')).toBe('true');
    }
    expect(puts).toEqual([]);
  });
});
