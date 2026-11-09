import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPendingSubmissions } from './pending-submission';
import {
  claimRunFinal,
  createAcceptedSurface,
  isRunCurrent,
  observeRunTransport,
  pendingRuns,
  registerSubmittedRun,
  resetAcceptedRuns,
} from './accepted-runs';
import {
  getPageContextRevision,
  onPageContextChange,
  setPageContextLocation,
} from './page-context';
import { registerTool } from './model-context';
import { findRunReply, reconcilePendingRuns, RECONCILE_MAX_AGE_MS } from './dispatch';
import {
  publishGatewaySessionOwner,
  retireGatewaySessionOwner,
} from '$lib/services/gateway/session-owner.svelte';

const disposers: Array<() => void> = [];
afterEach(() => {
  disposers
    .splice(0)
    .reverse()
    .forEach((off) => off());
  resetAcceptedRuns();
  retireGatewaySessionOwner();
  vi.useRealTimers();
});

const scope = { actorId: 'actor', orgId: 'org', agentId: 'agent', sessionKey: 'agent:agent:main' };
function setup() {
  const surface = createAcceptedSurface({ readScope: () => scope, followUp: async () => true });
  disposers.push(
    () => surface.dispose(),
    onPageContextChange((change) => surface.contextChanged(change)),
  );
  const pending = createPendingSubmissions();
  pending.setScope(scope);
  const submit = () => {
    const turn = pending.begin(0, getPageContextRevision());
    const binding = registerSubmittedRun(turn.submissionId, { pending: turn, surface })!;
    pending.commit(turn, getPageContextRevision(), () => ({
      status: 'submitted',
      runId: binding.runId,
    }));
    pending.finish(turn);
    return binding;
  };
  const execute = vi.fn(() => ({ id: 'el-1' }));
  disposers.push(registerTool({ name: 'test.upsert', description: '', inputSchema: {}, execute }));
  return { surface, submit, execute };
}
const owner = (hostId = 'h1') => ({
  actorId: 'actor',
  orgId: 'org',
  hostId,
  hostUrl: 'wss://gw.example',
  methods: null,
  current: () => true,
  request: async () => null,
});
/** The recorded user turn, as the gateway stores it (metadata fence first, then the stamp). */
const stamped = (runId: string) => ({
  role: 'user',
  content: [
    {
      type: 'text',
      text:
        'Conversation info (untrusted metadata):\n```json\n{\n  "message_id": "' +
        runId +
        '",\n  "sender": "minion-control-ui"\n}\n```\n\n[Sun 2026-11-08 06:44 UTC] hola',
    },
  ],
});
const reply = (tools: string[]) => ({
  role: 'assistant',
  content: [
    {
      type: 'text',
      text:
        'Key Metrics listo.\n\n```minion-ui\n' +
        JSON.stringify(tools.map((tool) => ({ tool, input: {} }))) +
        '\n```',
    },
  ],
});

describe('findRunReply', () => {
  it('takes the last assistant message after the stamped user turn, before the next user turn', () => {
    const msgs = [
      stamped('run-a'),
      { role: 'assistant', content: 'tool call' },
      reply(['x']),
      stamped('run-b'),
      reply(['y']),
    ];
    expect(findRunReply(msgs, 'run-a')).toBe(msgs[2]);
    expect(findRunReply(msgs, 'run-b')).toBe(msgs[4]);
    expect(findRunReply(msgs, 'run-c')).toBeUndefined();
    expect(findRunReply([stamped('run-a')], 'run-a')).toBeUndefined();
  });
});

describe('reconcilePendingRuns', () => {
  it('claims the transcript reply for a pending run once and runs its blocks', async () => {
    publishGatewaySessionOwner(owner());
    const s = setup();
    const binding = s.submit();
    observeRunTransport(binding, 'unknown');
    const msgs = [stamped(binding.runId), reply(['test.upsert'])];
    expect(reconcilePendingRuns('agent', scope.sessionKey, msgs)).toEqual([
      { runId: binding.runId, outcome: 'dispatched' },
    ]);
    await vi.waitFor(() => expect(s.execute).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(binding.state).toBe('finished'));
    // A second reload must not run the same block again.
    expect(reconcilePendingRuns('agent', scope.sessionKey, msgs)).toEqual([]);
    expect(s.execute).toHaveBeenCalledTimes(1);
  });

  it('stays pending while the transcript has no reply yet', () => {
    publishGatewaySessionOwner(owner());
    const s = setup();
    const binding = s.submit();
    expect(reconcilePendingRuns('agent', scope.sessionKey, [stamped(binding.runId)])).toEqual([
      { runId: binding.runId, outcome: 'no_reply' },
    ]);
    expect(pendingRuns(scope.sessionKey)).toEqual([binding]);
    expect(s.execute).not.toHaveBeenCalled();
  });

  it('defers to a live final that already claimed the run', () => {
    publishGatewaySessionOwner(owner());
    const s = setup();
    const binding = s.submit();
    expect(claimRunFinal(binding.runId, scope.sessionKey)).toBe(binding);
    expect(
      reconcilePendingRuns('agent', scope.sessionKey, [
        stamped(binding.runId),
        reply(['test.upsert']),
      ]),
    ).toEqual([]);
    expect(s.execute).not.toHaveBeenCalled();
  });

  it('runs nothing once the page context moved on', () => {
    publishGatewaySessionOwner(owner());
    const s = setup();
    const binding = s.submit();
    setPageContextLocation('https://hub.test/es/stock');
    expect(
      reconcilePendingRuns('agent', scope.sessionKey, [
        stamped(binding.runId),
        reply(['test.upsert']),
      ]),
    ).toEqual([]);
    expect(s.execute).not.toHaveBeenCalled();
  });

  it.each(['unknown', 'accepted'] as const)(
    'a pending run (transport %s) survives a reconnect to the same user, org and host',
    async (transport) => {
      publishGatewaySessionOwner(owner());
      const s = setup();
      const binding = s.submit();
      observeRunTransport(binding, transport); // ack lost, or acked then the stream died
      retireGatewaySessionOwner(); // socket closed
      expect(pendingRuns(scope.sessionKey)).toEqual([binding]);
      publishGatewaySessionOwner(owner()); // hello on the new socket, same identity
      expect(isRunCurrent(binding)).toBe(true);
      expect(
        reconcilePendingRuns('agent', scope.sessionKey, [
          stamped(binding.runId),
          reply(['test.upsert']),
        ]),
      ).toEqual([{ runId: binding.runId, outcome: 'dispatched' }]);
      await vi.waitFor(() => expect(s.execute).toHaveBeenCalledTimes(1));
    },
  );

  it('a second retire (socket close, then wsConnect) keeps the run awaiting', async () => {
    publishGatewaySessionOwner(owner());
    const s = setup();
    const binding = s.submit();
    retireGatewaySessionOwner(); // socket close
    retireGatewaySessionOwner(); // top of wsConnect
    expect(pendingRuns(scope.sessionKey)).toEqual([binding]);
    publishGatewaySessionOwner(owner());
    expect(isRunCurrent(binding)).toBe(true);
  });

  it('a pending run older than the reconcile window is dropped, not executed', () => {
    vi.useFakeTimers();
    publishGatewaySessionOwner(owner());
    const s = setup();
    const binding = s.submit();
    vi.setSystemTime(Date.now() + RECONCILE_MAX_AGE_MS + 1);
    expect(
      reconcilePendingRuns('agent', scope.sessionKey, [
        stamped(binding.runId),
        reply(['test.upsert']),
      ]),
    ).toEqual([{ runId: binding.runId, outcome: 'expired' }]);
    expect(binding.state).toBe('invalidated');
    expect(s.execute).not.toHaveBeenCalled();
  });

  it('an older pending run superseded by a newer user prompt is dropped, not executed', () => {
    publishGatewaySessionOwner(owner());
    const s = setup();
    const older = s.submit();
    const next = s.submit(); // default origin 'user'
    expect(
      reconcilePendingRuns('agent', scope.sessionKey, [
        stamped(older.runId),
        reply(['test.upsert']),
      ]),
    ).toEqual([
      { runId: older.runId, outcome: 'not_current' },
      { runId: next.runId, outcome: 'no_reply' },
    ]);
    expect(older.state).toBe('invalidated');
    expect(s.execute).not.toHaveBeenCalled();
  });

  it('reconciles nothing while no gateway session is published', () => {
    publishGatewaySessionOwner(owner());
    const s = setup();
    const binding = s.submit();
    retireGatewaySessionOwner();
    expect(
      reconcilePendingRuns('agent', scope.sessionKey, [
        stamped(binding.runId),
        reply(['test.upsert']),
      ]),
    ).toEqual([]);
    expect(s.execute).not.toHaveBeenCalled();
  });

  it('a run leased with no gateway session at all is revoked on any session change', () => {
    const s = setup();
    const binding = s.submit(); // no owner published → lease has no identity
    publishGatewaySessionOwner(owner());
    expect(binding.state).toBe('invalidated');
    expect(pendingRuns(scope.sessionKey)).toEqual([]);
  });

  it('a pending run is revoked when the replacement session is another host, and a claimed run on any change', () => {
    publishGatewaySessionOwner(owner('h1'));
    const s = setup();
    const pendingRun = s.submit();
    const claimed = s.submit();
    claimRunFinal(claimed.runId, scope.sessionKey);
    retireGatewaySessionOwner();
    expect(claimed.state).toBe('invalidated');
    expect(pendingRuns(scope.sessionKey)).toEqual([pendingRun]);
    publishGatewaySessionOwner(owner('h2'));
    expect(pendingRun.state).toBe('invalidated');
    expect(pendingRuns(scope.sessionKey)).toEqual([]);
    expect(s.execute).not.toHaveBeenCalled();
  });
});
