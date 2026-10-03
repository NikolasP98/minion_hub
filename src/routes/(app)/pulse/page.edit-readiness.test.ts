// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { PulseProposalRow } from '$server/db/pg-schema/pulse';
import { createActionRuntime } from '$lib/services/actions/runtime.svelte';

const invalidate = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('$app/navigation', () => ({ invalidate }));
const tryUseActions = vi.hoisted(() => vi.fn());
vi.mock('$lib/services/actions/context', () => ({ tryUseActions }));
let runtime: ReturnType<typeof createActionRuntime> | undefined;

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
  invalidate.mockResolvedValue(undefined);
  vi.unstubAllGlobals();
  runtime?.dispose();
  runtime = undefined;
  tryUseActions.mockReset();
});

describe('Pulse proposal edit readiness', () => {
  it.each([false, true])(
    'requires read repair after a lost reply (replacement editor: %s)',
    async (replaceEditor) => {
      runtime = createActionRuntime();
      runtime.setScope('org-a');
      tryUseActions.mockReturnValue(runtime);
      let rejectWrite!: (error: Error) => void;
      const fetchMock = vi.fn(
        () =>
          new Promise<Response>((_, reject) => {
            rejectWrite = reject;
          }),
      );
      vi.stubGlobal('fetch', fetchMock);
      render(PulsePage, {
        props: {
          data: {
            proposals: [proposal, { ...proposal, id: 'proposal-2', title: 'Second proposal' }],
          },
        },
      });
      await fireEvent.click(screen.getAllByRole('button', { name: /^edit$/i })[0]);
      await fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
      if (replaceEditor) await fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
      const editor = screen.getByLabelText('Arguments') as HTMLTextAreaElement;
      await fireEvent.input(editor, { target: { value: '{"title":"Retained draft"}' } });
      rejectWrite(new TypeError('reply lost'));
      await screen.findByRole('alert');
      const save = screen.getByRole('button', { name: /^save$/i });
      expect(save.hasAttribute('disabled')).toBe(true);
      await fireEvent.click(save);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const reload = screen.getByRole('button', { name: /reload current data/i });
      invalidate.mockRejectedValueOnce(new Error('read unavailable'));
      await fireEvent.click(reload);
      await vi.waitFor(() => expect(reload.hasAttribute('disabled')).toBe(false));
      expect(save.hasAttribute('disabled')).toBe(true);
      await fireEvent.click(reload);
      await vi.waitFor(() => expect(save.hasAttribute('disabled')).toBe(false));
      expect(editor.value).toBe('{"title":"Retained draft"}');
      expect(screen.getByRole('alert').textContent).toMatch(/outcome unknown/i);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(invalidate).toHaveBeenCalledTimes(2);
      expect(runtime.attention).toHaveLength(1);
      expect(runtime.attention[0].status).toBe('unknown');
    },
  );

  it('isolates a delayed save acknowledgement from a replacement organization', async () => {
    runtime = createActionRuntime();
    runtime.setScope('org-a');
    tryUseActions.mockReturnValue(runtime);
    let acknowledge!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          acknowledge = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const view = render(PulsePage, { props: { data: { proposals: [proposal] } } });
    await fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    await fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    runtime.setScope('org-b');
    await view.rerender({
      data: { proposals: [{ ...proposal, id: 'proposal-b', orgId: 'org-b' }] },
    });
    await tick();
    expect(screen.queryByLabelText('Arguments')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    const replacement = screen.getByLabelText('Arguments') as HTMLTextAreaElement;
    await fireEvent.input(replacement, { target: { value: '{"title":"Organization B draft"}' } });
    const response = new Response(null, { status: 200 });
    const acknowledged = vi.fn(() => true);
    Object.defineProperty(response, 'ok', { get: acknowledged });
    acknowledge(response);
    await vi.waitFor(() => expect(acknowledged).toHaveBeenCalledTimes(1));
    await tick();
    expect(invalidate).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Arguments')).toBe(replacement);
    expect(replacement.value).toBe('{"title":"Organization B draft"}');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not publish an old read repair into a replacement organization', async () => {
    runtime = createActionRuntime();
    runtime.setScope('org-a');
    tryUseActions.mockReturnValue(runtime);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    invalidate.mockRejectedValueOnce(new Error('refresh failed'));
    const view = render(PulsePage, { props: { data: { proposals: [proposal] } } });
    await fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    await fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await screen.findByRole('alert');
    let finishRead!: () => void;
    invalidate.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRead = resolve;
        }),
    );
    await fireEvent.click(screen.getByRole('button', { name: /reload current data/i }));
    expect(invalidate).toHaveBeenCalledTimes(2);
    runtime.setScope('org-b');
    await view.rerender({
      data: { proposals: [{ ...proposal, id: 'proposal-b', orgId: 'org-b' }] },
    });
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    const replacement = screen.getByLabelText('Arguments') as HTMLTextAreaElement;
    await fireEvent.input(replacement, { target: { value: '{"title":"Organization B draft"}' } });
    finishRead();
    await tick();
    expect(screen.getByLabelText('Arguments')).toBe(replacement);
    expect(replacement.value).toBe('{"title":"Organization B draft"}');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: /reload current data/i })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it('repairs an acknowledged save with a read and never repeats PATCH', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    invalidate.mockRejectedValueOnce(new Error('refresh failed'));
    render(PulsePage, { props: { data: { proposals: [proposal] } } });
    await fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    await fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await screen.findByRole('alert');
    expect(screen.queryByLabelText('Arguments')).toBeNull();
    expect(screen.getByRole('button', { name: /^approve$/i }).hasAttribute('disabled')).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: /reload current data/i }));
    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it('keeps newer edits to the same proposal after its earlier draft acknowledges', async () => {
    let acknowledge!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          acknowledge = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(PulsePage, { props: { data: { proposals: [proposal] } } });
    await fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    const editor = screen.getByLabelText('Arguments') as HTMLTextAreaElement;
    await fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await fireEvent.input(editor, { target: { value: '{"title":"Later draft"}' } });
    acknowledge(new Response(null, { status: 200 }));
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Arguments')).toBe(editor);
    expect(editor.value).toBe('{"title":"Later draft"}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not refresh the replacement route after the editor unmounts', async () => {
    let acknowledge!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            acknowledge = resolve;
          }),
      ),
    );
    const view = render(PulsePage, { props: { data: { proposals: [proposal] } } });
    await fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    await fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    view.unmount();
    const response = new Response(null, { status: 200 });
    const acknowledged = vi.fn(() => true);
    Object.defineProperty(response, 'ok', { get: acknowledged });
    acknowledge(response);
    await vi.waitFor(() => expect(acknowledged).toHaveBeenCalledTimes(1));
    await tick();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('does not close a replacement editor when an earlier proposal save acknowledges', async () => {
    let acknowledge!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          acknowledge = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(PulsePage, {
      props: {
        data: {
          proposals: [
            proposal,
            { ...proposal, id: 'proposal-2', title: 'Second proposal', dedupKey: 'second' },
          ],
        },
      },
    });
    await fireEvent.click(screen.getAllByRole('button', { name: /^edit$/i })[0]);
    await fireEvent.input(screen.getByLabelText('Arguments'), {
      target: { value: '{"title":"First saved draft"}' },
    });
    await fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    const replacement = screen.getByLabelText('Arguments') as HTMLTextAreaElement;
    await fireEvent.input(replacement, { target: { value: '{"title":"Unsaved replacement"}' } });
    acknowledge(new Response(null, { status: 200 }));
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Arguments')).toBe(replacement);
    expect(replacement.value).toBe('{"title":"Unsaved replacement"}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

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
