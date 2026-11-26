// @vitest-environment happy-dom
/**
 * Spec 152 PR E2b — the modals that draw their own surface render through the shared
 * dialog (`bare`): a named native modal that closes on Escape. No `animationend` is
 * dispatched anywhere here: a `bare` dialog has no exit animation to wait for.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';

vi.mock('$app/state', async () => ({
  page: (await import('../../../../../tests/fixtures/branding/consumer-page.svelte')).consumerPage,
}));
vi.mock('$lib/services/gateway.svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/services/gateway.svelte')>()),
  sendRequest: vi.fn().mockRejectedValue(new Error('not connected')),
  readSectionProse: vi.fn().mockRejectedValue(new Error('not connected')),
}));

import AgentCreateWizard from '$lib/components/builder/AgentCreateWizard.svelte';
import AgentCreatorWizard from '$lib/components/marketplace/AgentCreatorWizard.svelte';
import SectionProseEditor from '$lib/components/agents/SectionProseEditor.svelte';
import CommandPalette from '$lib/components/layout/CommandPalette.svelte';
import { palette } from '$lib/state/ui/command-palette.svelte';

afterEach(() => {
  palette.open = false;
  cleanup();
  vi.unstubAllGlobals();
});
const settle = async () => {
  await tick();
  await new Promise((r) => setTimeout(r, 30));
  await tick();
};
const openDialog = () => document.querySelector<HTMLDialogElement>('dialog[open]');
const escape = async () => {
  openDialog()!.dispatchEvent(new Event('cancel', { cancelable: true }));
  await settle();
};
const named = (d: HTMLDialogElement) =>
  (
    d.getAttribute('aria-label') ??
    document.getElementById(d.getAttribute('aria-labelledby') ?? '')?.textContent ??
    ''
  ).trim();

describe('modals with their own surface use the shared dialog (spec 152)', () => {
  it('the builder wizard is a named modal; Escape closes it once', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { status: 200 })));
    const onClose = vi.fn();
    render(AgentCreateWizard, { props: { onComplete: vi.fn(), onClose } });
    await settle();
    const d = openDialog()!;
    expect(d.dataset.presentation).toBe('bare');
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(named(d)).not.toBe('');
    await escape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the marketplace wizard is a named modal and now has an Escape path', async () => {
    const onClose = vi.fn();
    render(AgentCreatorWizard, { props: { onClose } });
    await settle();
    const d = openDialog()!;
    expect(d.dataset.presentation).toBe('bare');
    expect(named(d)).not.toBe('');
    await escape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the prose editor is a modal named by its heading; Escape closes it', async () => {
    const view = render(SectionProseEditor, {
      props: {
        open: true,
        agentId: 'agent-1',
        layer: 'identity',
        sectionId: 'soul',
        sectionLabel: 'Soul',
      },
    });
    await settle();
    const d = openDialog()!;
    expect(d.dataset.presentation).toBe('bare');
    expect(d.dataset.size).toBe('xl');
    expect(named(d)).toMatch(/Soul/);
    await escape();
    expect(openDialog()).toBeNull();
    view.unmount();
  });

  it('only the command palette sits at the top; the others are centred', async () => {
    render(CommandPalette);
    palette.open = true;
    await settle();
    expect(openDialog()!.dataset.align).toBe('top');
    palette.open = false;
    await settle();
    cleanup();
    render(AgentCreatorWizard, { props: { onClose: vi.fn() } });
    await settle();
    expect(openDialog()!.dataset.align).toBeUndefined();
  });
});
