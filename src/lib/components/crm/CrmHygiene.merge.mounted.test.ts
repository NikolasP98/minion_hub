// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import * as m from '$lib/paraglide/messages';
vi.mock('$app/environment', () => ({ browser: true }));
import CrmHygiene from './CrmHygiene.svelte';

const group = (key: string, ids: [string, string]) => ({
  key,
  reason: 'dni',
  confidence: 0.9,
  contacts: ids.map((id, i) => ({
    id,
    name: `Contact ${id}`,
    dni: key,
    phone: null,
    messages: 10 - i,
    identities: [],
    customFields: {},
  })),
});
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

let fetcher: ReturnType<typeof vi.fn>;
const posts = () =>
  fetcher.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST');

// Queries go through `screen` (render mounts into document.body); `r` only marks which render a step belongs to.
async function openResolver(r: unknown) {
  await fireEvent.click(
    screen.getByRole('button', { name: new RegExp(m.crm_possible_duplicates()) }),
  );
  await fireEvent.click(groupBtn(r));
}
// Both buttons read "Merge": the group's entry button comes first, the dialog's Confirm last.
const mergeButtons = (_r: unknown) => screen.getAllByRole('button', { name: 'Merge' });
const groupBtn = (r: unknown) => mergeButtons(r)[0];
const confirmBtn = (r: unknown) => mergeButtons(r).at(-1)!;

beforeEach(() => {
  fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CrmHygiene merge outcomes', () => {
  it('a 403 refusal shows its message and allows a new Confirm', async () => {
    fetcher.mockResolvedValue(json(403, { message: 'sensitive_fields_restricted' }));
    const r = render(CrmHygiene, { fixes: [], groups: [group('1', ['a', 'b'])] });
    await openResolver(r);
    await fireEvent.click(confirmBtn(r));
    await waitFor(() => r.getByText(m.crm_merge_sensitive_fields_restricted()));
    expect(confirmBtn(r).hasAttribute('disabled')).toBe(false);
    await fireEvent.click(confirmBtn(r));
    await waitFor(() => expect(posts()).toHaveLength(2));
  });

  it.each([
    ['a 500', () => json(500, {})],
    ['a malformed acknowledgement', () => new Response('nope')],
    ['transport loss', () => Promise.reject(new TypeError('offline'))],
  ])('%s latches unknown, never marks done and sends exactly one POST', async (_n, reply) => {
    fetcher.mockImplementation(async () => reply());
    const r = render(CrmHygiene, { fixes: [], groups: [group('1', ['a', 'b'])] });
    await openResolver(r);
    await fireEvent.click(confirmBtn(r));
    await waitFor(() => r.getByText(m.crm_merge_outcome_unknown()));
    expect(r.queryByText(m.crm_merged())).toBeNull();
    // The merge entry is blocked until a fresh read.
    expect(groupBtn(r).hasAttribute('disabled')).toBe(true);
    expect(posts()).toHaveLength(1);
  });

  it('refresh failure keeps it blocked; an accepted read replaces groups and needs a new selection', async () => {
    fetcher.mockResolvedValueOnce(json(500, {}));
    const r = render(CrmHygiene, { fixes: [], groups: [group('1', ['a', 'b'])] });
    await openResolver(r);
    await fireEvent.click(confirmBtn(r));
    await waitFor(() => r.getByText(m.crm_merge_outcome_unknown()));

    fetcher.mockResolvedValueOnce(json(500, {}));
    await fireEvent.click(r.getByRole('button', { name: m.crm_merge_refresh_contacts() }));
    await waitFor(() => r.getByText(m.crm_merge_refresh_failed()));
    expect(groupBtn(r).hasAttribute('disabled')).toBe(true);

    fetcher.mockResolvedValueOnce(json(200, { groups: [group('2', ['c', 'd'])] }));
    await fireEvent.click(r.getByRole('button', { name: m.crm_merge_refresh_contacts() }));
    await waitFor(() => expect(r.getAllByText('DNI 2').length).toBeGreaterThan(0));
    expect(r.queryByText('DNI 1')).toBeNull();
    expect(r.getByText(m.crm_merge_outcome_unknown())).toBeTruthy();
    expect(posts()).toHaveLength(1);
    // Only a new explicit selection sends a second POST.
    fetcher.mockResolvedValueOnce(json(200, { ok: true }));
    await fireEvent.click(groupBtn(r));
    await fireEvent.click(confirmBtn(r));
    await waitFor(() => expect(posts()).toHaveLength(2));
  });

  it('two quick refresh clicks issue one read', async () => {
    fetcher.mockResolvedValueOnce(json(500, {}));
    const r = render(CrmHygiene, { fixes: [], groups: [group('1', ['a', 'b'])] });
    await openResolver(r);
    await fireEvent.click(confirmBtn(r));
    await waitFor(() => r.getByText(m.crm_merge_outcome_unknown()));
    fetcher.mockImplementationOnce(() => new Promise(() => {}));
    const refresh = r.getByRole('button', { name: m.crm_merge_refresh_contacts() });
    await fireEvent.click(refresh);
    await fireEvent.click(refresh);
    expect(
      fetcher.mock.calls.filter((c) => !(c[1] as RequestInit | undefined)?.method),
    ).toHaveLength(1);
  });

  it('a read resolving after unmount is ignored', async () => {
    fetcher.mockResolvedValueOnce(json(500, {}));
    const r = render(CrmHygiene, { fixes: [], groups: [group('1', ['a', 'b'])] });
    await openResolver(r);
    await fireEvent.click(confirmBtn(r));
    await waitFor(() => r.getByText(m.crm_merge_outcome_unknown()));
    let release!: (v: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise<Response>((res) => (release = res)));
    await fireEvent.click(r.getByRole('button', { name: m.crm_merge_refresh_contacts() }));
    r.unmount();
    release(json(200, { groups: [] }));
    await Promise.resolve();
    expect(posts()).toHaveLength(1);
  });
});
