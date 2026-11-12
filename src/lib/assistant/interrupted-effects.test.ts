import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { createPendingSubmissions } from './pending-submission';
import {
  createAcceptedSurface,
  registerSubmittedRun,
  claimRunFinal,
  resetAcceptedRuns,
  isRunCurrent,
} from './accepted-runs';
import { getPageContextRevision } from './page-context';
import { registerTool } from './model-context';
import { runAssistantUiCalls } from './dispatch';
import {
  publishGatewaySessionOwner,
  retireGatewaySessionOwner,
} from '$lib/services/gateway/session-owner.svelte';
import {
  beginEffectReceipt,
  clearInterruptedEffects,
  dismissInterruptedEffect,
  finishEffectRun,
  interruptedEffects,
  interruptEffectRun,
  refreshInterruptedEffects,
  settleEffectReceipt,
  INTERRUPTION_TTL,
  type InterruptionOwner,
} from './interrupted-effects';

const off: Array<() => void> = [];
const scope = { actorId: 'actor', orgId: 'org', agentId: 'agent', sessionKey: 'agent:agent:main' };
const owner: InterruptionOwner = { ...scope, hostId: 'host', hostUrl: 'wss://fixture.invalid' };
const gateway = (patch = {}) => ({
  actorId: scope.actorId,
  orgId: scope.orgId,
  hostId: owner.hostId,
  hostUrl: owner.hostUrl,
  methods: null,
  current: () => true,
  request: async () => null,
  ...patch,
});
afterEach(() => {
  off
    .splice(0)
    .reverse()
    .forEach((fn) => fn());
  resetAcceptedRuns();
  retireGatewaySessionOwner();
  clearInterruptedEffects();
  vi.useRealTimers();
});
function submit() {
  const localScope = { ...scope };
  const followUp = vi.fn(async () => true);
  const surface = createAcceptedSurface({ readScope: () => localScope, followUp });
  off.push(() => surface.dispose());
  const pending = createPendingSubmissions();
  pending.setScope(localScope);
  const turn = pending.begin(0, getPageContextRevision());
  const binding = registerSubmittedRun(turn.submissionId, { pending: turn, surface })!;
  claimRunFinal(binding.runId, binding.sessionKey);
  return { binding, surface, followUp, localScope };
}
const text = (...tools: string[]) =>
  '```minion-ui\n' + JSON.stringify(tools.map((tool) => ({ tool, input: {} }))) + '\n```';

describe('actual interrupted dispatch retains only receipt metadata', () => {
  it('reports interruption before a waiting form invocation starts without executing it', async () => {
    publishGatewaySessionOwner(gateway());
    const run = submit();
    const running = runAssistantUiCalls(
      'agent',
      text('fill_not_mounted'),
      scope.sessionKey,
      run.binding,
    );
    retireGatewaySessionOwner();
    await running;
    expect(get(interruptedEffects)).toMatchObject([{ started: 0, confirmed: 0, unknown: 0 }]);
    expect(run.followUp).not.toHaveBeenCalled();
  });
  it('keeps revocation and never replays or follows up after a late save receipt', async () => {
    publishGatewaySessionOwner(gateway());
    let resolve!: (value: object) => void;
    const execute = vi.fn(
      () =>
        new Promise<object>((done) => {
          resolve = done;
        }),
    );
    const next = vi.fn();
    off.push(
      registerTool({ name: 'sandbox.upsert_element', description: '', inputSchema: {}, execute }),
    );
    off.push(registerTool({ name: 'test.next', description: '', inputSchema: {}, execute: next }));
    const run = submit();
    const running = runAssistantUiCalls(
      'agent',
      text('sandbox.upsert_element', 'test.next'),
      scope.sessionKey,
      run.binding,
    );
    retireGatewaySessionOwner();
    expect(run.binding.controller.signal.aborted).toBe(true);
    expect(get(interruptedEffects)).toMatchObject([{ unknown: 1, confirmed: 0 }]);
    publishGatewaySessionOwner(gateway());
    resolve({ id: 'saved-fixture', committed: true, secret: 'must-not-be-retained' });
    await running;
    expect(get(interruptedEffects)).toMatchObject([{ unknown: 0, confirmed: 1 }]);
    expect(JSON.stringify(get(interruptedEffects))).not.toContain('must-not-be-retained');
    expect(JSON.stringify(get(interruptedEffects))).not.toContain('saved-fixture');
    expect(isRunCurrent(run.binding)).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
    expect(run.followUp).not.toHaveBeenCalled();
  });
  it.each([
    { error: 'canceled' },
    { error: 'network unavailable' },
    { ok: true },
    { id: 'not-confirmed', committed: false },
    { id: 'not-confirmed', canceled: true },
    { id: 'not-confirmed', ok: false },
  ])('does not turn a generic/canceled result into durable confirmation: %j', async (result) => {
    publishGatewaySessionOwner(gateway());
    let resolve!: (value: object) => void;
    off.push(
      registerTool({
        name: 'sandbox.upsert_element',
        description: '',
        inputSchema: {},
        execute: () =>
          new Promise<object>((done) => {
            resolve = done;
          }),
      }),
    );
    const run = submit();
    const running = runAssistantUiCalls(
      'agent',
      text('sandbox.upsert_element'),
      scope.sessionKey,
      run.binding,
    );
    retireGatewaySessionOwner();
    resolve(result);
    await running;
    expect(get(interruptedEffects)[0].confirmed).toBe(0);
    expect(get(interruptedEffects)[0].unknown + get(interruptedEffects)[0].returned).toBe(1);
    expect(run.followUp).not.toHaveBeenCalled();
  });
  it.each(['actorId', 'orgId', 'hostId', 'hostUrl'] as const)(
    'discards old %s metadata and late results',
    async (field) => {
      publishGatewaySessionOwner(gateway());
      let resolve!: (value: object) => void;
      off.push(
        registerTool({
          name: 'sandbox.upsert_element',
          description: '',
          inputSchema: {},
          execute: () =>
            new Promise<object>((done) => {
              resolve = done;
            }),
        }),
      );
      const run = submit();
      const running = runAssistantUiCalls(
        'agent',
        text('sandbox.upsert_element'),
        scope.sessionKey,
        run.binding,
      );
      retireGatewaySessionOwner();
      publishGatewaySessionOwner(gateway({ [field]: 'replacement' }));
      resolve({ id: 'saved-fixture' });
      await running;
      publishGatewaySessionOwner(gateway());
      expect(get(interruptedEffects)).toEqual([]);
      expect(run.followUp).not.toHaveBeenCalled();
    },
  );
  it('discards old agent/session records on scope change rather than resurfacing them', async () => {
    publishGatewaySessionOwner(gateway());
    let resolve!: (value: object) => void;
    off.push(
      registerTool({
        name: 'sandbox.upsert_element',
        description: '',
        inputSchema: {},
        execute: () =>
          new Promise<object>((done) => {
            resolve = done;
          }),
      }),
    );
    const run = submit();
    const running = runAssistantUiCalls(
      'agent',
      text('sandbox.upsert_element'),
      scope.sessionKey,
      run.binding,
    );
    retireGatewaySessionOwner();
    run.localScope.sessionKey = 'agent:agent:new';
    run.surface.updateScope();
    resolve({ id: 'saved-fixture' });
    await running;
    run.localScope.sessionKey = scope.sessionKey;
    run.surface.updateScope();
    expect(get(interruptedEffects)).toEqual([]);
  });
  it('keeps earlier receipts when a later effect loses its response', async () => {
    publishGatewaySessionOwner(gateway());
    off.push(
      registerTool({
        name: 'sandbox.remove_element',
        description: '',
        inputSchema: {},
        execute: () => ({ ok: true, id: 'removed' }),
      }),
    );
    let resolve!: (value: object) => void;
    off.push(
      registerTool({
        name: 'hold.write',
        description: '',
        inputSchema: {},
        execute: () =>
          new Promise<object>((done) => {
            resolve = done;
          }),
      }),
    );
    const run = submit();
    const running = runAssistantUiCalls(
      'agent',
      text('sandbox.remove_element', 'hold.write'),
      scope.sessionKey,
      run.binding,
    );
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    retireGatewaySessionOwner();
    expect(get(interruptedEffects)).toMatchObject([{ confirmed: 1, unknown: 1 }]);
    resolve({ error: 'canceled' });
    await running;
    expect(get(interruptedEffects)).toMatchObject([{ confirmed: 1, unknown: 1 }]);
  });
  it('removes cleanly completed runs and does not publish an interruption', async () => {
    publishGatewaySessionOwner(gateway());
    off.push(
      registerTool({
        name: 'test.read',
        description: '',
        inputSchema: {},
        annotations: { readOnlyHint: true },
        execute: () => ({ rows: [] }),
      }),
    );
    const run = submit();
    await runAssistantUiCalls('agent', text('test.read'), scope.sessionKey, run.binding);
    expect(get(interruptedEffects)).toEqual([]);
    expect(run.followUp).toHaveBeenCalledTimes(1);
  });
  it('retains returned receipts if transport dies while the follow-up is awaiting acceptance', async () => {
    publishGatewaySessionOwner(gateway());
    off.push(
      registerTool({
        name: 'sandbox.upsert_element',
        description: '',
        inputSchema: {},
        execute: () => ({ id: 'saved-fixture', note: 'saved' }),
      }),
    );
    const run = submit();
    let complete!: (value: boolean) => void;
    run.followUp.mockImplementationOnce(
      () =>
        new Promise<boolean>((done) => {
          complete = done;
        }),
    );
    const running = runAssistantUiCalls(
      'agent',
      text('sandbox.upsert_element'),
      scope.sessionKey,
      run.binding,
    );
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    retireGatewaySessionOwner();
    expect(get(interruptedEffects)).toMatchObject([{ confirmed: 1, unknown: 0 }]);
    complete(false);
    await running;
    expect(get(interruptedEffects)).toMatchObject([{ confirmed: 1, unknown: 0 }]);
    expect(run.followUp).toHaveBeenCalledTimes(1);
  });
});

describe('bounded interruption journal', () => {
  it('expires records and refuses late settlements without restoring them', () => {
    vi.useFakeTimers();
    publishGatewaySessionOwner(gateway());
    const handle = beginEffectReceipt({ ...scope, runId: 'run' }, 'sandbox.upsert_element', false);
    interruptEffectRun('run');
    vi.advanceTimersByTime(INTERRUPTION_TTL);
    refreshInterruptedEffects();
    settleEffectReceipt(handle, '{"id":"late"}');
    expect(get(interruptedEffects)).toEqual([]);
  });
  it('bounds runs/calls, limits receipts and requires the same owner to dismiss', () => {
    publishGatewaySessionOwner(gateway());
    for (let i = 0; i < 34; i++) {
      beginEffectReceipt({ ...scope, runId: String(i) }, 'write', false);
      interruptEffectRun(String(i));
    }
    expect(get(interruptedEffects)).toHaveLength(32);
    for (let i = 0; i < 30; i++) beginEffectReceipt({ ...scope, runId: '33' }, 'write', false);
    interruptEffectRun('33');
    expect(get(interruptedEffects).at(-1)?.unknown).toBe(31);
    dismissInterruptedEffect('33', { ...owner, sessionKey: 'other' });
    expect(get(interruptedEffects)).toHaveLength(32);
    dismissInterruptedEffect('33', owner);
    expect(get(interruptedEffects)).toHaveLength(31);
    finishEffectRun('32');
    expect(get(interruptedEffects)).toHaveLength(31);
  });
});
