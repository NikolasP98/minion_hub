// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { PulseProposalRow } from '$server/db/pg-schema/pulse';

const invalidate = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('$app/navigation', () => ({ invalidate }));

const { default: PulsePage } = await import('./+page.svelte');

const proposal: PulseProposalRow = {
  id: 'proposal-1',
  orgId: 'org-1',
  createdAt: new Date('2026-10-02T12:00:00Z'),
  source: 'calendar',
  kind: 'create_event',
  title: 'Create review event',
  summary: null,
  payload: { args: { title: 'Original' } },
  status: 'pending',
  dedupKey: 'review-event',
  decidedBy: null,
  executedAt: null,
  error: null,
};

afterEach(() => {
  cleanup();
  invalidate.mockClear();
  vi.unstubAllGlobals();
});

describe('Pulse proposal edit readiness', () => {
  it('blocks duplicate saves, retains a rejected draft, and closes after acknowledged retry', async () => {
    let resolveFirst!: (response: Response) => void;
    const first = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(PulsePage, { props: { data: { proposals: [proposal] } } });

    await fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    const editor = screen.getByLabelText('Arguments') as HTMLTextAreaElement;
    const draft = JSON.stringify({ title: 'Changed' }, null, 2);
    await fireEvent.input(editor, { target: { value: draft } });
    const save = screen.getByRole('button', { name: /^save$/i });

    await fireEvent.click(save);
    await fireEvent.click(save);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFirst(
      new Response(JSON.stringify({ error: 'Proposal changed elsewhere' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await screen.findByRole('alert');
    expect(editor.value).toBe(draft);
    expect(invalidate).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(save.hasAttribute('disabled')).toBe(false));

    await fireEvent.click(save);
    await vi.waitFor(() => expect(screen.queryByLabelText('Arguments')).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});
