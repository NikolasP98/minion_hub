// @vitest-environment happy-dom
/**
 * Spec 152 PR E2 — the workshop's "name this link" prompt is a real modal dialog: named by
 * its title, focus starts in the field, Escape and a click outside cancel. No `animationend`
 * is dispatched here: a `bare` dialog has no exit animation to wait for.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import RelationshipPrompt from './RelationshipPrompt.svelte';

afterEach(cleanup);
const settle = async () => {
  await tick();
  await new Promise((r) => setTimeout(r, 20));
  await tick();
};

function mount() {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  render(RelationshipPrompt, {
    props: { fromName: 'Scout', toName: 'Writer', x: 100, y: 80, onSubmit, onCancel },
  });
  return { onSubmit, onCancel };
}

describe('RelationshipPrompt (spec 152)', () => {
  it('is a modal dialog named by its title, with focus in the field and a clear backdrop', async () => {
    mount();
    await settle();
    const dialog = document.querySelector<HTMLDialogElement>('dialog[open]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.dataset.backdrop).toBe('clear');
    const title = document.getElementById(dialog.getAttribute('aria-labelledby')!);
    expect(title?.textContent).toMatch(/Scout/);
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });

  it('Enter submits the trimmed label; an empty label does not', async () => {
    const { onSubmit } = mount();
    await settle();
    const input = screen.getByRole('textbox');
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
    await fireEvent.input(input, { target: { value: '  reports to ' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('reports to');
  });

  it('a submit is not also reported as a cancel when the prompt goes away', async () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const view = render(RelationshipPrompt, {
      props: { fromName: 'Scout', toName: 'Writer', x: 100, y: 80, onSubmit, onCancel },
    });
    await settle();
    const input = screen.getByRole('textbox');
    await fireEvent.input(input, { target: { value: 'mentor' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    view.unmount(); // what the canvas does after onSubmit
    await settle();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('Escape cancels once', async () => {
    const { onCancel } = mount();
    await settle();
    document
      .querySelector('dialog[open]')!
      .dispatchEvent(new Event('cancel', { cancelable: true }));
    await settle();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
