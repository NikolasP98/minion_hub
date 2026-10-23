// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { createActionRuntime } from '$lib/services/actions/runtime.svelte';
const context = vi.hoisted(() => ({ use: vi.fn(), allowed: true }));
vi.mock('$lib/services/actions/context', () => ({ tryUseActions: context.use }));
vi.mock('$lib/access/can.svelte', () => ({
  canViewPath: () => true,
  canAct: () => context.allowed,
}));
import PulseFeedback from './PulseFeedback.svelte';
let runtime: ReturnType<typeof createActionRuntime>;
const id = '10000000-0000-4000-8000-000000000001';
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const settle = async () => {
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await tick();
};
beforeEach(() => {
  runtime = createActionRuntime();
  runtime.setScope('feedback-owner');
  context.use.mockReturnValue(runtime);
  context.allowed = true;
});
afterEach(() => {
  cleanup();
  runtime.dispose();
  context.use.mockReset();
  vi.unstubAllGlobals();
});
describe('actual mounted Pulse feedback recovery and ownership', () => {
  it('preserves five hundred non-BMP Unicode characters without a UTF16 maxlength truncation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ feedback: [] })),
    );
    render(PulseFeedback, { proposalId: id, revision: 1 });
    await settle();
    const comment = screen.getByRole('textbox') as HTMLTextAreaElement;
    await fireEvent.input(comment, { target: { value: '😀'.repeat(500) } });
    expect(comment.value).toBe('😀'.repeat(500));
    expect(comment.hasAttribute('maxlength')).toBe(false);
    expect(
      (screen.getByRole('button', { name: 'Save feedback' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    await fireEvent.input(comment, { target: { value: '😀'.repeat(501) } });
    expect(
      (screen.getByRole('button', { name: 'Save feedback' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
  it('retains selection comment and stable action UUID after a known rejected save', async () => {
    const writes: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, options?: RequestInit) => {
        if (options?.method === 'POST') {
          writes.push(JSON.parse(String(options.body)));
          return json({ message: 'fixture_rejected' }, 400);
        }
        return json({ feedback: [] });
      }),
    );
    render(PulseFeedback, { proposalId: id, revision: 1 });
    await settle();
    const reason = screen.getByRole('combobox');
    const comment = screen.getByRole('textbox');
    await fireEvent.change(reason, { target: { value: 'fact_error' } });
    await fireEvent.input(comment, { target: { value: 'Keep this correction.' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save feedback' }));
    await settle();
    expect((reason as HTMLSelectElement).value).toBe('fact_error');
    expect((comment as HTMLTextAreaElement).value).toBe('Keep this correction.');
    await fireEvent.click(screen.getByRole('button', { name: 'Save feedback' }));
    await settle();
    expect(writes).toHaveLength(2);
    expect(writes[0].clientActionId).toBe(writes[1].clientActionId);
    expect(writes[0].clientActionId).toMatch(/^[0-9a-f-]{36}$/);
  });
  for (const kind of ['committed-refreshing', 'unknown'] as const)
    it(`reconciles ${kind} by reads and clears the actual action runtime without replay`, async () => {
      let writes = 0,
        fail = false;
      let saved: Record<string, unknown> | null = null;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, options?: RequestInit) => {
          if (options?.method === 'POST') {
            writes++;
            saved = {
              ...JSON.parse(String(options.body)),
              id: '20000000-0000-4000-8000-000000000001',
              proposalId: id,
              contentRevision: 1,
              supersedesFeedbackId: null,
            };
            if (kind === 'unknown') throw new TypeError('lost acknowledgement');
            fail = true;
            return json({ feedback: saved });
          }
          return fail
            ? json({ message: 'read failed' }, 503)
            : json({ feedback: saved ? [saved] : [] });
        }),
      );
      render(PulseFeedback, { proposalId: id, revision: 1 });
      await settle();
      await fireEvent.input(screen.getByRole('textbox'), {
        target: { value: 'A durable reason.' },
      });
      await fireEvent.click(screen.getByRole('button', { name: 'Save feedback' }));
      await settle();
      expect(writes).toBe(1);
      expect(runtime.attention).toHaveLength(1);
      fail = false;
      await fireEvent.click(screen.getByRole('button', { name: 'Reload current data' }));
      await settle();
      expect(writes).toBe(1);
      expect(runtime.attention).toHaveLength(0);
      expect(screen.getByRole('button', { name: 'Save correction' })).toBeTruthy();
    });
  it('retires a held mutation when the actual runtime owner changes', async () => {
    let release!: (response: Response) => void;
    let writes = 0;
    const submitted: { value: Record<string, unknown> | null } = { value: null };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, options?: RequestInit) => {
        if (options?.method === 'POST') {
          writes++;
          submitted.value = JSON.parse(String(options.body));
          return new Promise<Response>((resolve) => {
            release = resolve;
          });
        }
        return json({ feedback: [] });
      }),
    );
    render(PulseFeedback, { proposalId: id, revision: 1 });
    await settle();
    await fireEvent.input(screen.getByRole('textbox'), {
      target: { value: 'Private owner draft.' },
    });
    void fireEvent.click(screen.getByRole('button', { name: 'Save feedback' }));
    await settle();
    context.allowed = false;
    runtime.setScope('another-owner');
    await settle();
    if (!submitted.value) throw new Error('fixture_submission_missing');
    release(
      json({
        feedback: {
          ...submitted.value,
          id: '20000000-0000-4000-8000-000000000001',
          proposalId: id,
          contentRevision: 1,
        },
      }),
    );
    await settle();
    expect(writes).toBe(1);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText(/Recorded:/)).toBeNull();
    expect(runtime.attention).toHaveLength(0);
  });
  it('ignores an older actual component read after its card identity changes', async () => {
    let release!: (response: Response) => void;
    const second = '10000000-0000-4000-8000-000000000002';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes(second)
          ? json({
              feedback: [
                {
                  id: 'f2',
                  clientActionId: 'a2',
                  proposalId: second,
                  contentRevision: 1,
                  reason: 'fact_error',
                  comment: 'new',
                  supersedesFeedbackId: null,
                },
              ],
            })
          : new Promise<Response>((resolve) => {
              release = resolve;
            }),
      ),
    );
    const view = render(PulseFeedback, { proposalId: id, revision: 1 });
    await settle();
    await view.rerender({ proposalId: second, revision: 1 });
    await settle();
    release(
      json({
        feedback: [
          {
            id: 'f1',
            clientActionId: 'a1',
            proposalId: id,
            contentRevision: 1,
            reason: 'irrelevant',
            comment: 'old',
            supersedesFeedbackId: null,
          },
        ],
      }),
    );
    await settle();
    expect(screen.getByText('Recorded: Factual error')).toBeTruthy();
    expect(screen.queryByText('Recorded: Irrelevant')).toBeNull();
  });
});
