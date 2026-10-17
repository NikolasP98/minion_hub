// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import AiPromptInput from './AiPromptInput.svelte';
import AiReasoning from './AiReasoning.svelte';
import AiApproval from './AiApproval.svelte';
import AiToolCall from './AiToolCall.svelte';
import AiSources from './AiSources.svelte';
import AiSteps from './AiSteps.svelte';

// happy-dom has no Web Animations API; Svelte transitions call element.animate.
if (typeof Element.prototype.animate !== 'function') {
  Element.prototype.animate = function () {
    const a = { onfinish: null as null | (() => void), cancel() {}, finish() {}, currentTime: 0 };
    queueMicrotask(() => a.onfinish?.());
    return a as unknown as Animation;
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('AiPromptInput', () => {
  it('sends on Enter, breaks the line on Shift+Enter, ignores blank drafts', async () => {
    const onsubmit = vi.fn();
    const { getByRole } = render(AiPromptInput, { props: { value: 'hola', onsubmit } });
    const box = getByRole('textbox');
    await fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(onsubmit).not.toHaveBeenCalled();
    await fireEvent.keyDown(box, { key: 'Enter' });
    expect(onsubmit).toHaveBeenCalledExactlyOnceWith('hola');

    const blank = vi.fn();
    cleanup();
    const r = render(AiPromptInput, { props: { value: '   ', onsubmit: blank } });
    await fireEvent.keyDown(r.getByRole('textbox'), { key: 'Enter' });
    expect(blank).not.toHaveBeenCalled();
  });

  it('turns submit into Stop while a reply runs and calls onstop instead of sending', async () => {
    const onsubmit = vi.fn();
    const onstop = vi.fn();
    const { getByRole } = render(AiPromptInput, {
      props: { value: 'next', status: 'streaming', onsubmit, onstop },
    });
    const stop = getByRole('button', { name: 'Stop generating' });
    await fireEvent.click(stop);
    expect(onstop).toHaveBeenCalledOnce();
    expect(onsubmit).not.toHaveBeenCalled();
  });

  it('shows the counter only from 80% of the limit', async () => {
    const { queryByText, rerender } = render(AiPromptInput, {
      props: { value: 'abc', maxLength: 10 },
    });
    expect(queryByText('3/10')).toBeNull();
    await rerender({ value: 'abcdefghi', maxLength: 10 });
    expect(queryByText('9/10')).not.toBeNull();
  });
});

describe('AiReasoning', () => {
  it('opens while active, reports the duration and collapses after the end', async () => {
    vi.useFakeTimers();
    const { getByRole, rerender, queryByText } = render(AiReasoning, {
      props: { text: 'step one', active: true },
    });
    expect(getByRole('button').getAttribute('aria-expanded')).toBe('true');
    vi.advanceTimersByTime(1500);
    await rerender({ text: 'step one', active: false });
    await tick();
    expect(getByRole('button').getAttribute('aria-label')).toMatch(/^Thought for 1\.5 s$/);
    expect(queryByText('step one')).not.toBeNull();
    vi.advanceTimersByTime(650);
    await tick();
    expect(getByRole('button').getAttribute('aria-expanded')).toBe('false');
  });

  it('never auto-collapses once the reader toggled it', async () => {
    vi.useFakeTimers();
    const { getByRole, rerender } = render(AiReasoning, { props: { text: 'mine', active: true } });
    await fireEvent.click(getByRole('button')); // close
    await fireEvent.click(getByRole('button')); // reopen by hand
    await rerender({ text: 'mine', active: false });
    vi.advanceTimersByTime(2000);
    await tick();
    expect(getByRole('button').getAttribute('aria-expanded')).toBe('true');
  });
});

describe('AiApproval', () => {
  it('accepts one decision and collapses the alternatives', async () => {
    const onDecide = vi.fn();
    const { getByRole, queryByRole, findByRole } = render(AiApproval, {
      props: {
        question: 'How?',
        options: [
          { id: 'show', label: 'Show me how' },
          { id: 'do', label: 'Do it for me' },
        ],
        onDecide,
      },
    });
    await fireEvent.click(getByRole('button', { name: 'Do it for me' }));
    expect(onDecide).toHaveBeenCalledExactlyOnceWith({ id: 'do', label: 'Do it for me' });
    const status = await findByRole('status');
    expect(status.textContent).toContain('Do it for me');
    await vi.waitFor(() => expect(queryByRole('button', { name: 'Show me how' })).toBeNull());
  });

  it('renders a resolved decision without asking again, and is read-only without a send path', () => {
    const r = render(AiApproval, {
      props: { options: [{ id: 'a', label: 'Approve' }], resolvedId: 'a' },
    });
    expect(r.getByRole('status').textContent).toContain('Approve');
    expect(r.queryByRole('button')).toBeNull();
    cleanup();
    const ro = render(AiApproval, { props: { options: [{ id: 'a', label: 'Approve' }] } });
    expect((ro.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('AiToolCall', () => {
  it('names its status for assistive tech and keeps detail collapsed until asked', async () => {
    const { getByRole, queryByText } = render(AiToolCall, {
      props: { name: 'web_search', status: 'error', input: '{"q":"x"}', result: 'boom' },
    });
    const head = getByRole('button', { name: 'web_search — Failed' });
    expect(queryByText('boom')).toBeNull();
    await fireEvent.click(head);
    expect(queryByText('boom')).not.toBeNull();
  });
});

describe('AiSources', () => {
  const src = (n: number) => ({ url: `https://s${n}.io/p`, host: `s${n}.io`, title: `Page ${n}` });

  it('stacks three marks plus a count, then lists every page as a safe new-tab link', async () => {
    const { container, getByRole, getAllByRole } = render(AiSources, {
      props: { sources: [src(1), src(2), src(3), src(4)] },
    });
    expect(container.querySelectorAll('.stack .mark')).toHaveLength(3);
    expect(container.textContent).toContain('+1');
    const head = getByRole('button', { name: /Sources/ });
    expect(head.getAttribute('aria-expanded')).toBe('false');
    await fireEvent.click(head);
    const links = getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://s1.io/p',
      'https://s2.io/p',
      'https://s3.io/p',
      'https://s4.io/p',
    ]);
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('renders nothing without sources', () => {
    const { container } = render(AiSources, { props: { sources: [] } });
    expect(container.querySelector('.ai-sources')).toBeNull();
  });
});

describe('AiSteps', () => {
  const rows = createRawSnippet(() => ({ render: () => '<p>step rows</p>' }));
  const ok = { kind: 'tool' as const, status: 'success' as const };

  it('folds a finished turn into one summary line that opens to the rows', async () => {
    const { getByRole, queryByText } = render(AiSteps, {
      props: {
        steps: [{ kind: 'thinking', status: 'success' }, ok, { kind: 'tool', status: 'error' }],
        children: rows,
      },
    });
    const head = getByRole('button', { name: '3 steps · 2 tool uses · 1 failed' });
    expect(queryByText('step rows')).toBeNull();
    await fireEvent.click(head);
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(queryByText('step rows')).not.toBeNull();
  });

  it('says how long it has been working, opens the rows itself and caps the stack at five', () => {
    const { getByRole, getByText, queryByText, container } = render(AiSteps, {
      props: { steps: Array.from({ length: 8 }, () => ok), running: true, children: rows },
    });
    expect(getByRole('button', { name: /^Working for \d+ s$/ })).toBeTruthy();
    expect(queryByText('step rows')).not.toBeNull();
    expect(getByText('+3')).toBeTruthy();
    expect(container.querySelectorAll('.stack i:not(.count)')).toHaveLength(5);
  });

  it('reports "Worked for N s" once the turn ends, and for the committed render of the same turn', async () => {
    const live = render(AiSteps, {
      props: { steps: [ok], running: true, turnKey: 'turn-1', children: rows },
    });
    await live.rerender({ steps: [ok], running: false, turnKey: 'turn-1', children: rows });
    expect(live.getByRole('button', { name: /^Worked for \d+ s · 1 tool uses$/ })).toBeTruthy();
    live.unmount();
    const committed = render(AiSteps, {
      props: { steps: [ok], turnKey: 'turn-1', children: rows },
    });
    expect(committed.getByRole('button', { name: /^Worked for \d+ s/ })).toBeTruthy();
  });
});
