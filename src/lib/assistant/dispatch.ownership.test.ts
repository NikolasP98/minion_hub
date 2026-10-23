import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPendingSubmissions } from './pending-submission';
import {
  claimRunFinal,
  createAcceptedSurface,
  getAcceptedRun,
  isRunCurrent,
  registerSubmittedRun,
  resetAcceptedRuns,
  observeRunTransport,
  beginInvocation,
  settleInvocation,
} from './accepted-runs';
import {
  createPageContextLease,
  getPageContextRevision,
  onPageContextChange,
  setPageContextLocation,
} from './page-context';
import { registerTool } from './model-context';
import { runAssistantUiCalls } from './dispatch';
import { registerSandboxTools } from '$lib/sandbox/tools';
import { createSandboxHost, type SandboxElementRecord } from '$lib/sandbox/host.svelte';
const disposers: Array<() => void> = [];
afterEach(() => {
  disposers
    .splice(0)
    .reverse()
    .forEach((off) => off());
  resetAcceptedRuns();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function setup() {
  const scope = {
    actorId: 'actor',
    orgId: 'org',
    agentId: 'agent',
    sessionKey: 'agent:agent:main',
  };
  const followUp = vi.fn(async () => true);
  const surface = createAcceptedSurface({ readScope: () => scope, followUp });
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
  return { scope, followUp, surface, pending, submit };
}
const text = (tools: string[]) =>
  '```minion-ui\n' + JSON.stringify(tools.map((tool) => ({ tool, input: {} }))) + '\n```';
describe('actual live dispatch ownership', () => {
  it('claims final before ack once; cleanup leaves accepted signal live and late ack cannot revive Stop', async () => {
    const s = setup();
    const execute = vi.fn((_input, ctx) => {
      expect(ctx.signal.aborted).toBe(false);
      return { rows: [] };
    });
    disposers.push(
      registerTool({
        name: 'test.read',
        description: '',
        inputSchema: {},
        execute,
        annotations: { readOnlyHint: true },
      }),
    );
    const binding = s.submit();
    expect(binding.controller.signal.aborted).toBe(false);
    const claimed = claimRunFinal(binding.runId, binding.sessionKey);
    expect(claimRunFinal(binding.runId, binding.sessionKey)).toBeUndefined();
    await runAssistantUiCalls('agent', text(['test.read']), binding.sessionKey, claimed);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(s.followUp).toHaveBeenCalledTimes(1);
    s.surface.stop(); // finished runs no longer have automatic work
    const pending = s.submit();
    s.surface.stop();
    observeRunTransport(pending, 'accepted');
    expect(pending.controller.signal.aborted).toBe(true);
    expect(claimRunFinal(pending.runId, pending.sessionKey)).toBeUndefined();
  });
  it.each(['owner', 'page', 'stop', 'dispose'] as const)(
    'revokes held tools and all remaining calls on %s',
    async (kind) => {
      const s = setup();
      let release!: () => void;
      const next = vi.fn();
      disposers.push(
        registerTool({
          name: 'hold',
          description: '',
          inputSchema: {},
          execute: () => new Promise<void>((done) => (release = done)),
        }),
      );
      disposers.push(
        registerTool({ name: 'next', description: '', inputSchema: {}, execute: next }),
      );
      const binding = s.submit();
      const running = runAssistantUiCalls(
        'agent',
        text(['hold', 'next']),
        binding.sessionKey,
        claimRunFinal(binding.runId, binding.sessionKey),
      );
      if (kind === 'owner') {
        s.scope.actorId = 'b';
        s.surface.updateScope();
        s.scope.actorId = 'actor';
        s.surface.updateScope();
      }
      if (kind === 'page') {
        setPageContextLocation('/b');
        setPageContextLocation('/a');
      }
      if (kind === 'stop') s.surface.stop();
      if (kind === 'dispose') s.surface.dispose();
      release();
      await running;
      expect(next).not.toHaveBeenCalled();
      expect(s.followUp).not.toHaveBeenCalled();
      expect(binding.controller.signal.aborted).toBe(true);
    },
  );
  it('expires at two hours and evicts the 257th oldest binding; reset cannot restore lineage', () => {
    vi.useFakeTimers();
    const s = setup();
    const oldest = s.submit();
    for (let i = 0; i < 256; i++) s.submit();
    expect(getAcceptedRun(oldest.runId)).toBeUndefined();
    expect(oldest.controller.signal.aborted).toBe(true);
    const last = s.surface.latest()!;
    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    expect(getAcceptedRun(last.runId)).toBeUndefined();
    expect(last.controller.signal.aborted).toBe(true);
    const fresh = s.submit();
    resetAcceptedRuns();
    expect(claimRunFinal(fresh.runId, fresh.sessionKey)).toBeUndefined();
  });
  it.each(['valid', 'user_navigation', 'registry', 'forged', 'failed_refresh', 'expired'] as const)(
    'real sandbox tool/host/lease handoff: %s',
    async (variant) => {
      const lease = createPageContextLease('initial');
      disposers.push(lease.dispose);
      const host = createSandboxHost([], {
        begin: lease.invalidate,
        publish: (elements, capability) => lease.update(JSON.stringify(elements), capability),
      });
      const ac = new AbortController();
      disposers.push(() => ac.abort());
      registerSandboxTools({ signal: ac.signal, acknowledge: host.load });
      const s = setup();
      const next = vi.fn();
      disposers.push(
        registerTool({ name: 'next', description: '', inputSchema: {}, execute: next }),
      );
      let release!: (response: Response) => void;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: unknown, init?: RequestInit) =>
          init?.method === 'POST'
            ? Response.json({ id: 'saved' })
            : new Promise<Response>((done) => (release = done)),
        ),
      );
      const binding = s.submit();
      const running = runAssistantUiCalls(
        'agent',
        text(['sandbox.upsert_element', 'next']),
        binding.sessionKey,
        claimRunFinal(binding.runId, binding.sessionKey),
      );
      await vi.waitFor(() => expect(release).toBeDefined());
      if (variant === 'user_navigation') {
        setPageContextLocation('/other');
        setPageContextLocation('/sandbox');
      }
      if (variant === 'registry')
        disposers.push(
          registerTool({ name: 'unrelated', description: '', inputSchema: {}, execute() {} }),
        );
      if (variant === 'forged') lease.update('forged', { token: Symbol('forged') });
      if (variant === 'expired') {
        vi.useFakeTimers();
        vi.advanceTimersByTime(30_001);
      }
      release(
        variant === 'failed_refresh'
          ? new Response('', { status: 503 })
          : Response.json({ elements: [{ id: 'saved' } as SandboxElementRecord] }),
      );
      await running;
      expect(next).not.toHaveBeenCalled();
      expect(s.followUp).toHaveBeenCalledTimes(variant === 'valid' ? 1 : 0);
      expect(
        vi
          .mocked(fetch)
          .mock.calls.filter(
            ([url, init]) => url === '/api/sandbox/elements' && init?.method === 'POST',
          ),
      ).toHaveLength(1);
    },
  );
  it('capability is private, single publication/consumption, registration/lease bound', () => {
    const lease = createPageContextLease('start');
    disposers.push(lease.dispose);
    disposers.push(
      registerTool({ name: 'sandbox.arrange', description: '', inputSchema: {}, execute() {} }),
    );
    const s = setup(),
      binding = s.submit();
    const capability = beginInvocation(binding, 'sandbox.arrange')!;
    expect(lease.update('next', capability)).toBe(true);
    expect(settleInvocation(capability)).toBe(true);
    expect(settleInvocation(capability)).toBe(false);
    expect(lease.update('duplicate', capability)).toBe(false);
    expect(isRunCurrent(binding)).toBe(false);
  });
});

it('retains the five-follow-up cap under one root, with transport unknown never granting a second final claim', () => {
  const s = setup();
  let parent = s.submit();
  observeRunTransport(parent, 'unknown');
  expect(claimRunFinal(parent.runId, parent.sessionKey)).toBe(parent);
  expect(claimRunFinal(parent.runId, parent.sessionKey)).toBeUndefined();
  for (let i = 1; i <= 5; i++) {
    const turn = s.pending.begin(0, getPageContextRevision());
    const child = registerSubmittedRun(turn.submissionId, {
      pending: turn,
      surface: s.surface,
      origin: 'ui_followup',
      parent,
    });
    expect(child?.followUpCount).toBe(i);
    expect(child?.taskRootId).toBe(parent.taskRootId);
    parent = child!;
  }
  const sixth = s.pending.begin(0, getPageContextRevision());
  expect(
    registerSubmittedRun(sixth.submissionId, {
      pending: sixth,
      surface: s.surface,
      origin: 'ui_followup',
      parent,
    }),
  ).toBeNull();
});

it.each(['ui_choice', 'artifact'] as const)(
  'explicit %s preserves a live root at five without reopening automatic slots',
  (origin) => {
    const s = setup();
    let parent = s.submit();
    const child = (
      origin: import('./accepted-runs').TurnOrigin,
      parent: import('./accepted-runs').AcceptedBinding,
    ) => {
      const pending = s.pending.begin(0, getPageContextRevision());
      return registerSubmittedRun(pending.submissionId, {
        pending,
        surface: s.surface,
        origin,
        parent,
      });
    };
    for (let i = 0; i < 5; i++) parent = child('ui_followup', parent)!;
    expect(child('ui_followup', parent)).toBeNull();
    const explicit = child(origin, parent)!;
    expect(explicit).toMatchObject({
      origin,
      parentRunId: parent.runId,
      taskRootId: parent.taskRootId,
      followUpCount: 5,
    });
    expect(child('ui_followup', explicit)).toBeNull();
    s.surface.stop();
    expect(child(origin, explicit)).toBeNull();
    s.scope.sessionKey = 'agent:agent:other';
    s.surface.updateScope();
    s.scope.sessionKey = 'agent:agent:main';
    s.surface.updateScope();
    expect(child(origin, parent)).toBeNull();
    const typed = s.submit();
    expect(typed.taskRootId).toBe(typed.submissionId);
    expect(typed.followUpCount).toBe(0);
  },
);

it('unknown automatic lineage cannot start a root; typed text never inherits a supplied parent', () => {
  const s = setup(),
    parent = s.submit();
  const pending = s.pending.begin(0, getPageContextRevision());
  expect(
    registerSubmittedRun(pending.submissionId, {
      pending,
      surface: s.surface,
      origin: 'ui_followup',
    }),
  ).toBeNull();
  const typed = registerSubmittedRun(pending.submissionId, {
    pending,
    surface: s.surface,
    origin: 'user',
    parent,
  })!;
  expect(typed).toMatchObject({
    parentRunId: null,
    taskRootId: typed.submissionId,
    followUpCount: 0,
  });
});

it('folded callback aliases require every exact source to share one live binding', async () => {
  const { associateRunMessage, associateDerivedRunMessage, sourceMessageRun, finishRun } =
    await import('./accepted-runs');
  const { foldToolTurns } = await import('$lib/chat/blocks');
  const s = setup(),
    first = s.submit(),
    second = s.submit();
  const message = () => ({
    role: 'assistant',
    content: [
      {
        type: 'toolCall',
        id: crypto.randomUUID(),
        name: 'chat_artifact',
        arguments: { html: '', buttons: [{ text: 'Fixture', callback_data: 'FIXTURE' }] },
      },
    ],
  });
  const a = message(),
    b = message(),
    history = message();
  associateRunMessage(a, first);
  associateRunMessage(b, second);
  expect(sourceMessageRun(foldToolTurns([a], associateDerivedRunMessage)[0])).toBe(first);
  expect(
    sourceMessageRun(foldToolTurns([history, a], associateDerivedRunMessage)[0]),
  ).toBeUndefined();
  expect(sourceMessageRun(foldToolTurns([a, b], associateDerivedRunMessage)[0])).toBeUndefined();
  let active: unknown;
  const off = s.surface.activity.subscribe((value) => (active = value));
  expect(active).toBe(second);
  claimRunFinal(second.runId, second.sessionKey);
  finishRun(second);
  expect(active).toBe(first);
  s.surface.stop();
  expect(active).toBeUndefined();
  expect(sourceMessageRun(foldToolTurns([a], associateDerivedRunMessage)[0])).toBeUndefined();
  off();
});

it('late transport observations cannot enter a successor actor buffer', async () => {
  const { decisionEvents } = await import('./decision-events');
  const seen: unknown[] = [];
  const off = decisionEvents.subscribe((event) => seen.push(event));
  try {
    const s = setup(),
      run = s.submit();
    s.scope.actorId = 'successor';
    s.surface.updateScope();
    seen.length = 0;
    observeRunTransport(run, 'unknown');
    observeRunTransport(run, 'accepted');
    expect(seen).toHaveLength(0);
    expect(run.controller.signal.aborted).toBe(true);
  } finally {
    off();
  }
});

it('lazy TTL expiry stops serial sandbox writes and refresh but preserves the first received commit', async () => {
  vi.useFakeTimers();
  const s = setup();
  const controller = new AbortController();
  disposers.push(() => controller.abort());
  const acknowledge = vi.fn(async () => true);
  registerSandboxTools({ signal: controller.signal, acknowledge });
  let release!: (response: Response) => void;
  const fetcher = vi.fn(
    (_url: string, _init?: RequestInit) =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  const binding = s.submit();
  const running = runAssistantUiCalls(
    'agent',
    '```minion-ui\n' +
      JSON.stringify({ tool: 'sandbox.arrange', input: { order: ['a', 'b'] } }) +
      '\n```',
    binding.sessionKey,
    claimRunFinal(binding.runId, binding.sessionKey),
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  // Suspend the clock without firing timers or looking up the accepted store.
  vi.setSystemTime(binding.expiresAt + 1);
  release(Response.json({ id: 'a' }));
  await running;
  expect(
    fetcher.mock.calls.filter(([url]) => String(url).startsWith('/api/sandbox/elements/')),
  ).toHaveLength(1);
  expect(acknowledge).not.toHaveBeenCalled();
  expect(s.followUp).not.toHaveBeenCalled();
  expect(binding.controller.signal.aborted).toBe(true);
});

it('enrolled serial writes cannot outlive their private 30 second invocation lease', async () => {
  vi.useFakeTimers();
  const pageLease = createPageContextLease('serial-deadline');
  disposers.push(pageLease.dispose);
  const controller = new AbortController();
  disposers.push(() => controller.abort());
  const acknowledge = vi.fn(async () => true);
  registerSandboxTools({ signal: controller.signal, acknowledge });
  const s = setup(),
    binding = s.submit();
  let release!: (value: Response) => void;
  const fetcher = vi.fn(
    (_url: string, _init?: RequestInit) =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  const running = runAssistantUiCalls(
    'agent',
    '```minion-ui\n' +
      JSON.stringify({ tool: 'sandbox.arrange', input: { order: ['a', 'b'] } }) +
      '\n```',
    binding.sessionKey,
    claimRunFinal(binding.runId, binding.sessionKey),
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  vi.setSystemTime(binding.createdAt + 30_001);
  release(Response.json({ id: 'a' }));
  await running;
  expect(fetcher.mock.calls.filter(([url]) => url.startsWith('/api/sandbox/'))).toHaveLength(1);
  expect(binding.controller.signal.aborted).toBe(true);
  expect(acknowledge).not.toHaveBeenCalled();
  expect(s.followUp).not.toHaveBeenCalled();
});
