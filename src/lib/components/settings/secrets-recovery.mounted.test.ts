// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import * as m from '$lib/paraglide/messages';
import { SECRETS_METHODS, type SecretsSummary } from '$lib/types/secrets';
import { conn, hostsState, page, resetSecretOwner } from './secrets-recovery.fixture.svelte';
const spies = vi.hoisted(() => ({ send: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('$app/state', async () => ({
  page: (await import('./secrets-recovery.fixture.svelte')).page,
}));
vi.mock('$lib/state/gateway/connection.svelte', async () => ({
  conn: (await import('./secrets-recovery.fixture.svelte')).conn,
}));
vi.mock('$lib/state/features/hosts.svelte', async () => ({
  hostsState: (await import('./secrets-recovery.fixture.svelte')).hostsState,
}));
vi.mock('$lib/services/gateway.svelte', () => ({ sendRequest: spies.send }));
vi.mock('$lib/state/ui/toast.svelte', async (original) => ({
  ...(await original<object>()),
  toastSuccess: spies.success,
  toastError: spies.error,
}));
import SecretsSection from './SecretsSection.svelte';

function secret(label: string): SecretsSummary {
  return {
    rowKey: label,
    groupKey: label,
    instanceId: null,
    kind: 'static',
    ownerPlugin: 'fixture',
    label,
    probe: 'fixture',
    configured: true,
    probeStatus: 'ok',
    probeMessage: null,
    lastProbeAt: null,
    updatedAt: 1,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const calls = (method: string) => spies.send.mock.calls.filter(([name]) => name === method);
async function cancelConfirmation() {
  await fireEvent.click(screen.getByRole('button', { name: m.common_cancel() }));
  const dialog = screen.getByRole('dialog');
  // happy-dom does not run CSS animations; deliver the native completion boundary.
  await fireEvent.animationEnd(dialog.querySelector('[data-part=content]')!);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}
const clearButton = () => screen.getByRole('button', { name: 'Clear' });
const confirmButton = () =>
  screen.getByRole('button', { name: m.common_delete() }) as HTMLButtonElement;
beforeEach(() => {
  resetSecretOwner();
  spies.send.mockReset();
  spies.success.mockReset();
  spies.error.mockReset();
});
afterEach(cleanup);

describe('SecretsSection actual owner and unknown recovery', () => {
  it('unknown clear stays blocked across close/reopen until authoritative read and new intent', async () => {
    spies.send.mockImplementation((method: string) =>
      method === SECRETS_METHODS.list
        ? Promise.resolve({ secrets: [secret('Alpha')] })
        : Promise.reject(new Error('Lost acknowledgement')),
    );
    render(SecretsSection);
    await waitFor(() => expect(clearButton()).toBeTruthy());
    clearButton().focus();
    await fireEvent.click(clearButton());
    await fireEvent.click(confirmButton());
    await waitFor(() => expect(confirmButton().disabled).toBe(true));
    expect(calls(SECRETS_METHODS.clear)).toHaveLength(1);
    await cancelConfirmation();
    expect(document.activeElement).toBe(clearButton());
    clearButton().focus();
    await fireEvent.click(clearButton());
    expect(confirmButton().disabled).toBe(true);
    await fireEvent.click(confirmButton());
    expect(calls(SECRETS_METHODS.clear)).toHaveLength(1);
    await cancelConfirmation();
    expect(document.activeElement).toBe(clearButton());
    await fireEvent.click(screen.getByRole('button', { name: m.record_review_latest() }));
    await waitFor(() => expect(calls(SECRETS_METHODS.list)).toHaveLength(2));
    clearButton().focus();
    await fireEvent.click(clearButton());
    expect(confirmButton().disabled).toBe(false);
    expect(calls(SECRETS_METHODS.clear)).toHaveLength(1);
    expect(spies.success).not.toHaveBeenCalled();
  });

  it.each(['actor', 'organization', 'host', 'connection'] as const)(
    'late list for previous %s cannot replace current secrets',
    async (scope) => {
      const old = deferred<{ secrets: SecretsSummary[] }>();
      spies.send
        .mockImplementationOnce(() => old.promise)
        .mockResolvedValue({ secrets: [secret('Current owner')] });
      render(SecretsSection);
      await waitFor(() => expect(calls(SECRETS_METHODS.list)).toHaveLength(1));
      if (scope === 'actor') page.data.user.id = 'actor-b';
      if (scope === 'organization') page.data.activeOrgId = 'org-b';
      if (scope === 'host') hostsState.activeHostId = 'host-b';
      if (scope === 'connection') conn.connectedAt = 2;
      await tick();
      await waitFor(() => expect(calls(SECRETS_METHODS.list)).toHaveLength(2));
      await waitFor(() => expect(screen.getAllByText('Current owner').length).toBeGreaterThan(0));
      old.resolve({ secrets: [secret('Old owner secret')] });
      await tick();
      expect(screen.queryByText('Old owner secret')).toBeNull();
      expect(calls(SECRETS_METHODS.list)).toHaveLength(2);
      expect(
        (screen.getByRole('button', { name: m.record_review_latest() }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
    },
  );

  it('late clear completion after owner rotation does not refresh or toast current owner', async () => {
    const clearing = deferred<void>();
    spies.send.mockImplementation((method: string) =>
      method === SECRETS_METHODS.clear
        ? clearing.promise
        : Promise.resolve({ secrets: [secret('Alpha')] }),
    );
    render(SecretsSection);
    await waitFor(() => expect(clearButton()).toBeTruthy());
    clearButton().focus();
    await fireEvent.click(clearButton());
    await fireEvent.click(confirmButton());
    expect(calls(SECRETS_METHODS.clear)).toHaveLength(1);
    page.data.activeOrgId = 'org-b';
    await tick();
    await waitFor(() => expect(calls(SECRETS_METHODS.list)).toHaveLength(2));
    clearing.resolve();
    await tick();
    expect(calls(SECRETS_METHODS.list)).toHaveLength(2);
    expect(spies.success).not.toHaveBeenCalled();
  });
});
