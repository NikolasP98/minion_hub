// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import * as m from '$lib/paraglide/messages';
import {
  publishGatewaySessionOwner,
  retireGatewaySessionOwner,
} from '$lib/services/gateway/session-owner.svelte';
import {
  beginEffectReceipt,
  clearInterruptedEffects,
  interruptEffectRun,
  settleEffectReceipt,
  type InterruptionOwner,
} from '$lib/assistant/interrupted-effects';
import InterruptedEffectsNotice from './InterruptedEffectsNotice.svelte';

const owner: InterruptionOwner = {
  actorId: 'actor',
  orgId: 'org',
  agentId: 'agent',
  sessionKey: 'agent:agent:main',
  hostId: 'host',
  hostUrl: 'wss://fixture.invalid',
};
function interrupted(tool = 'sandbox.upsert_element') {
  publishGatewaySessionOwner({
    ...owner,
    methods: null,
    current: () => true,
    request: async () => null,
  });
  const handle = beginEffectReceipt({ ...owner, runId: 'run' }, tool, false);
  interruptEffectRun('run');
  return handle;
}
afterEach(() => {
  cleanup();
  clearInterruptedEffects();
  retireGatewaySessionOwner();
});

describe('mounted interrupted effect notice', () => {
  it('shows uncertainty, resolves a late save receipt and only dismisses metadata', async () => {
    const handle = interrupted();
    render(InterruptedEffectsNotice, { owner });
    expect(screen.getByRole('status').textContent).toContain(
      m.assistant_interruption_unknown({ count: 1 }),
    );
    expect(screen.getByRole('status').textContent).toContain(m.assistant_interruption_noReplay());
    settleEffectReceipt(handle, '{"id":"saved","private":"never rendered"}');
    await tick();
    expect(screen.getByRole('status').textContent).toContain(m.assistant_interruption_confirmed());
    expect(screen.getByRole('status').textContent).not.toContain('never rendered');
    await fireEvent.click(screen.getByRole('button', { name: m.assistant_interruption_dismiss() }));
    expect(screen.queryByRole('status')).toBeNull();
  });
  it.each(['actorId', 'orgId', 'agentId', 'sessionKey', 'hostId', 'hostUrl'] as const)(
    'hides/discards the old %s notice and cannot resurface a late receipt',
    async (field) => {
      const handle = interrupted();
      const view = render(InterruptedEffectsNotice, { owner });
      expect(screen.getByRole('status')).toBeTruthy();
      await view.rerender({ owner: { ...owner, [field]: 'replacement' } });
      expect(screen.queryByRole('status')).toBeNull();
      settleEffectReceipt(handle, '{"id":"late"}');
      await view.rerender({ owner });
      expect(screen.queryByRole('status')).toBeNull();
    },
  );
  it('does not claim a generic ok response was saved', async () => {
    const handle = interrupted('fill_stock_entry');
    render(InterruptedEffectsNotice, { owner });
    settleEffectReceipt(handle, '{"ok":true,"filled":["qty"]}');
    await tick();
    expect(screen.getByRole('status').textContent).toContain(m.assistant_interruption_returned());
    expect(screen.getByRole('status').textContent).not.toContain(
      m.assistant_interruption_confirmed(),
    );
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
  it('distinguishes already confirmed saves from another unknown action', async () => {
    const saved = interrupted();
    settleEffectReceipt(saved, '{"id":"saved"}');
    beginEffectReceipt({ ...owner, runId: 'run' }, 'other.write', false);
    interruptEffectRun('run');
    render(InterruptedEffectsNotice, { owner });
    expect(screen.getByRole('status').textContent).toContain(m.assistant_interruption_partial());
    expect(screen.getByRole('status').textContent).toContain(m.assistant_interruption_noReplay());
  });
});
