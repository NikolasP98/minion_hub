// @vitest-environment happy-dom
/**
 * HC-028 — every overlay migrated onto the shared Dialog contract opens with
 * `showModal()`, locks body scroll, closes on Escape pressed inside its
 * innermost control, follows its stated outside-click policy (all six are
 * dismissible: Escape/backdrop = Cancel) and returns focus to the trigger.
 *
 * happy-dom has no UA: `installUserAgentEscape` turns a document-level Escape
 * into the native `cancel` (Chromium's close watcher); `:modal`/inert/Tab-trap
 * are proved in real Chromium by `tests/fixtures/overlay-dialog/verify.mjs`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Component } from 'svelte';
import DeleteConfirmModal from '$lib/components/builder/_builder-hub/DeleteConfirmModal.svelte';
import RegistryAgentSheet from '$lib/components/builder/_builder-hub/RegistryAgentSheet.svelte';
import SkillCreateWizard from '$lib/components/builder/SkillCreateWizard.svelte';
import ExportDialog from '$lib/components/data-table/ExportDialog.svelte';
import ConditionModal from '../../../../routes/(app)/flow-editor/skills/[id]/_components/ConditionModal.svelte';
import DeleteChapterModal from '../../../../routes/(app)/flow-editor/skills/[id]/_components/DeleteChapterModal.svelte';
import { skillEditorState } from '$lib/state/builder/skill-editor.svelte';

vi.mock('$lib/state/builder/skill-editor.svelte', () => ({
  skillEditorState: {
    chapterToDelete: null as { id: string; name: string } | null,
    editingCondition: null as { id: string | null } | null,
    conditionName: '',
    conditionText: '',
  },
  skillEditorDerived: { conditionValidation: { valid: true, reason: '' } },
  executeDeleteChapter: vi.fn(),
  saveCondition: vi.fn(),
  updateCondition: vi.fn(),
}));
vi.mock('$lib/state/builder', () => ({
  categoryIcon: () => '#',
  agentIcon: () => '🤖',
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }));
vi.mock('$lib/actions/autosize', () => ({ autosize: () => {} }));

function installUserAgentEscape() {
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    document.querySelector<HTMLDialogElement>('dialog[open]')?.dispatchEvent(
      new Event('cancel', { cancelable: true }),
    );
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}

type Case = {
  name: string;
  component: Component<any>;
  props: () => Record<string, unknown>;
  /** The innermost focusable control Escape is pressed in. */
  inner: string;
  /** Reads whether the overlay reported close through its own channel. */
  closed: () => boolean;
};

const onClose = vi.fn();
const cases: Case[] = [
  {
    name: 'DeleteConfirmModal',
    component: DeleteConfirmModal,
    props: () => ({ type: 'skill', name: 'Draft', onCancel: onClose, onConfirm: vi.fn() }),
    inner: '.confirm-btn.cancel',
    closed: () => onClose.mock.calls.length > 0,
  },
  {
    name: 'RegistryAgentSheet',
    component: RegistryAgentSheet,
    props: () => ({
      agent: {
        id: 'a1',
        name: 'Agent',
        description: 'd',
        categories: ['ops'],
        tags: [],
        source: 's',
        model: null,
      },
      onClose,
    }),
    inner: '.detail-btn.secondary',
    closed: () => onClose.mock.calls.length > 0,
  },
  {
    name: 'SkillCreateWizard',
    component: SkillCreateWizard,
    props: () => ({ onComplete: vi.fn(), onClose }),
    inner: '.name-input',
    closed: () => onClose.mock.calls.length > 0,
  },
  {
    name: 'ExportDialog',
    component: ExportDialog,
    props: () => ({
      open: true,
      columns: [{ key: 'a', label: 'A', default: true }],
      count: 1,
      onexport: vi.fn(),
    }),
    inner: '.fmt-btn, .col',
    // Unbound `open`: the Dialog flips to its exit state (`data-closing`) at once.
    closed: () => document.querySelector('dialog')?.hasAttribute('data-closing') === true,
  },
  {
    name: 'DeleteChapterModal',
    component: DeleteChapterModal,
    props: () => {
      skillEditorState.chapterToDelete = { id: 'c1', name: 'Intro' } as never;
      return {};
    },
    inner: '.confirm-btn.cancel',
    closed: () => skillEditorState.chapterToDelete === null,
  },
  {
    name: 'ConditionModal',
    component: ConditionModal,
    props: () => {
      skillEditorState.editingCondition = { id: '' } as never;
      return {};
    },
    inner: '#cond-text',
    closed: () => skillEditorState.editingCondition === null,
  },
];

let trigger: HTMLButtonElement;
let uninstall: () => void;
let showModal: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  onClose.mockClear();
  trigger = document.createElement('button');
  document.body.append(trigger);
  trigger.focus();
  uninstall = installUserAgentEscape();
  showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
});
afterEach(() => {
  cleanup();
  uninstall();
  trigger.remove();
  showModal.mockRestore();
  skillEditorState.chapterToDelete = null;
  skillEditorState.editingCondition = null;
});

describe.each(cases)('$name', ({ component, props, inner, closed }) => {
  it('opens as a native modal with the body scroll locked', () => {
    render(component, props());
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(document.querySelector('dialog')?.open).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('closes on Escape pressed inside its innermost control', async () => {
    render(component, props());
    const control = document.querySelector<HTMLElement>(inner)!;
    control.focus();
    await fireEvent.keyDown(control, { key: 'Escape' });
    expect(closed()).toBe(true);
  });

  it('dismisses on backdrop click but not on a content click', async () => {
    render(component, props());
    await fireEvent.click(document.querySelector('[data-part="content"]')!);
    expect(closed()).toBe(false);
    await fireEvent.click(document.querySelector('dialog')!);
    expect(closed()).toBe(true);
  });

  it('releases the scroll lock and returns focus to the trigger once closed', async () => {
    const view = render(component, props());
    await fireEvent.click(document.querySelector('dialog')!);
    // Parents mount these behind `{#if …}`: closing unmounts them.
    view.unmount();
    await tick();
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(trigger);
  });
});
