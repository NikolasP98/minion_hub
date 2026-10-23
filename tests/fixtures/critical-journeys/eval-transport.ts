import { normalizeBlocks, stringifyToolResult } from '$lib/chat/blocks';
import { install, fixtureBridge, type FixtureSocket } from './gateway-transport';
import { bootstrap, page } from './eval-page.svelte';
import { decisionEvents } from '$lib/assistant/decision-events';
import {
  getTools,
  registerTool,
  onToolChange,
  toolRegistration,
  type ModelContextTool,
} from '$lib/assistant/model-context';
import { setPageContextLocation } from '$lib/assistant/page-context';
import { ensureAgentChat } from '$lib/state/chat/chat.svelte';
import { loadChatHistory } from '$lib/services/gateway/chat-rpc';
import { languageTag, setLanguageTag } from '$lib/paraglide/runtime';
import type { EvalTransition, EvalMainResult } from './eval-protocol';
import { initialSandboxElements } from './eval-state';
import { extractText } from '$lib/utils/text';
import { getAcceptedRun } from '$lib/assistant/accepted-runs';
interface ProviderRequest {
  requestId: string;
  kind: 'classifier' | 'main';
  [key: string]: unknown;
}
const providers: ProviderRequest[] = [];
const observations: unknown[] = [];
const receipts: unknown[] = [];
const http: Array<{ method: string; path: string }> = [];
const violations: string[] = [];
const routeResolvers = new Map<string, (value: unknown) => void>();
const turns = new Map<
  string,
  {
    runId: string;
    sessionKey: string;
    message: string;
    socket: FixtureSocket;
    ack: () => void;
    rejectAck: () => void;
  }
>();
const knownRunIds = new Set<string>();
let elements: Record<string, unknown>[] = initialSandboxElements(
  bootstrap?.initialState ?? 'empty',
).map((element) => ({ ...element }));
let lastFinal:
  { runId: string; sessionKey: string; message: unknown; socket: FixtureSocket } | undefined;
let holdReload = false;
const heldReloads: Array<(fail: boolean) => void> = [];
let holdHistory = false;
const heldHistory: Array<() => void> = [];
const json = (value: unknown, status = 200) => Response.json(value, { status });
const hash = async (value: unknown) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
const state = () => ({
  elements,
  persona: bootstrap?.persona ?? 'owner',
  seed: bootstrap?.seed ?? 0,
  actorId: page.data.user.id,
  orgId: page.data.activeOrgId,
  page: page.url.pathname,
  sessionKey: ensureAgentChat('fixture-agent').sessionKey ?? 'agent:fixture-agent:main',
  allowedTools: [...(bootstrap?.allowedTools ?? [])].sort(),
});
const assistantMessage = (result: unknown) => {
  const value = result as EvalMainResult | null;
  const text = value?.text ?? value?.choices?.[0]?.message?.content ?? '';
  return {
    role: 'assistant',
    content: value?.message?.content ?? [{ type: 'text', text }],
    timestamp: Date.now(),
  };
};
/** Provider input only. Serialized history never reconstitutes an accepted UI lease. */
function providerHistory(sessionKey: string): Array<{ role: string; content: string }> {
  return fixtureBridge.history(sessionKey).map((message) => {
    if (!message || typeof message !== 'object') throw Error('Invalid fixture history message');
    const entry = message as Record<string, unknown>;
    if (!['system', 'user', 'assistant', 'toolResult'].includes(String(entry.role)))
      throw Error('Invalid fixture history role');
    const content =
      entry.role === 'toolResult'
        ? stringifyToolResult(entry.content)
        : normalizeBlocks(entry.content)
            .map((block) => {
              if (block.kind === 'text') return block.text;
              if (block.kind === 'tool')
                return `[Tool: ${block.name}] ${JSON.stringify(block.input)}`;
              if (block.kind === 'image') return '[Image]';
              return '';
            })
            .filter((text) => text !== '')
            .join('\n');
    return { role: entry.role === 'toolResult' ? 'user' : String(entry.role), content };
  });
}
export function installEval() {
  install();
  fixtureBridge.historyGate = (complete) => {
    if (!holdHistory) return false;
    if (heldHistory.length >= 16) throw Error('Held history capacity');
    heldHistory.push(complete);
    return true;
  };
  fixtureBridge.violation = (kind) => violations.push(kind);
  const guarded = new WeakSet<object>();
  const enforceFixtureCapabilities = () => {
    for (const descriptor of getTools()) {
      const registered = toolRegistration(descriptor.name) as ModelContextTool | undefined;
      if (!registered || guarded.has(registered)) continue;
      const execute = registered.execute;
      guarded.add(registered);
      registered.execute = (input, ctx) => {
        if (bootstrap?.allowedTools && !bootstrap.allowedTools.includes(descriptor.name)) {
          violations.push('forbidden_tool:' + descriptor.name);
          return { error: 'Fixture episode capability denied' };
        }
        return execute(input, ctx);
      };
    }
  };
  enforceFixtureCapabilities();
  onToolChange(enforceFixtureCapabilities);
  if (navigator.serviceWorker)
    Object.defineProperty(navigator.serviceWorker, 'register', {
      configurable: true,
      value: async () => {
        violations.push('service_worker_denied');
        throw new DOMException('Fixture service worker denied', 'SecurityError');
      },
    });
  if (bootstrap?.locale) setLanguageTag(bootstrap.locale);
  const priorFetch = globalThis.fetch;
  decisionEvents.subscribe((event) =>
    observations.push({
      version: 1,
      ...event,
      episodeId: bootstrap?.episodeId,
      arm: bootstrap?.arm,
      observedAt: Date.now(),
    }),
  );
  fixtureBridge.main = (turn, socket, ack, rejectAck) => {
    const requestId = crypto.randomUUID();
    turns.set(requestId, { ...turn, socket, ack, rejectAck });
    knownRunIds.add(turn.runId);
    providers.push({
      requestId,
      kind: 'main',
      runId: turn.runId,
      sessionKey: turn.sessionKey,
      message: turn.message,
      messages: [...providerHistory(turn.sessionKey), { role: 'user', content: turn.message }],
      model: bootstrap?.model.requestedModel,
      boundDescriptor: bootstrap?.model.boundDescriptor,
    });
  };
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    const method = init?.method ?? 'GET';
    http.push({ method, path: url.pathname });
    if (url.origin !== location.origin) {
      violations.push('external_fetch');
      throw Error('External fetch denied');
    }
    if (url.pathname === '/api/assistant/decision-events' && method === 'POST')
      return json({ accepted: JSON.parse(String(init?.body)).events.length });
    if (url.pathname === '/api/assistant/route' && method === 'POST') {
      if (bootstrap?.arm === 'core_discovery')
        return json({
          decision: { mode: 'chat', probabilities: { chat: 1 }, manifests: {}, ms: 0, cost: 0 },
          attempt: null,
        });
      const requestId = crypto.randomUUID();
      const request = JSON.parse(String(init?.body));
      const headers = new Headers(init?.headers);
      return new Promise<Response>((resolve, reject) => {
        routeResolvers.set(requestId, (value) => resolve(json(value)));
        init?.signal?.addEventListener(
          'abort',
          () => {
            routeResolvers.delete(requestId);
            reject(new DOMException('canceled', 'AbortError'));
          },
          { once: true },
        );
        providers.push({
          requestId,
          kind: 'classifier',
          input: request,
          submissionId: headers.get('x-minion-run-id'),
        });
      });
    }
    if (url.pathname === '/api/sandbox/elements' && method === 'GET') {
      if (holdReload)
        await new Promise<void>((resolve, reject) => {
          if (heldReloads.length >= 4) {
            violations.push('held_reload_overflow');
            reject(Error('Held reload capacity'));
            return;
          }
          const finish = (fail: boolean) => {
            init?.signal?.removeEventListener('abort', abort);
            fail ? reject(Error('Held refresh failed')) : resolve();
          };
          const abort = () => {
            const index = heldReloads.indexOf(finish);
            if (index >= 0) heldReloads.splice(index, 1);
            reject(new DOMException('canceled', 'AbortError'));
          };
          if (init?.signal?.aborted) {
            abort();
            return;
          }
          heldReloads.push(finish);
          init?.signal?.addEventListener('abort', abort, { once: true });
        });
      return json({ elements });
    }
    if (url.pathname === '/api/sandbox/datasets' && method === 'GET')
      return json({
        datasets: [
          {
            id: 'fixture.sales',
            label: 'Disposable sales',
            columns: [{ id: 'amount', type: 'number' }],
          },
        ],
      });
    if (url.pathname === '/api/sandbox/query' && method === 'POST')
      return json({ columns: ['amount'], rows: [[7]] });
    if (
      /^\/api\/sandbox\/elements(?:\/[^/]+)?$/.test(url.pathname) &&
      ['POST', 'PATCH', 'DELETE'].includes(method)
    ) {
      const tool =
        method === 'POST'
          ? 'sandbox.upsert_element'
          : method === 'DELETE'
            ? 'sandbox.remove_element'
            : 'sandbox.arrange';
      if (
        bootstrap?.persona === 'reader' ||
        (bootstrap?.allowedTools &&
          !bootstrap.allowedTools.includes(tool) &&
          !(method === 'PATCH' && bootstrap.allowedTools.includes('sandbox.upsert_element')))
      ) {
        violations.push('forbidden_tool');
        return json({ error: 'Fixture capability denied' }, 403);
      }
      const authority = {
        actorId: page.data.user.id,
        orgId: page.data.activeOrgId,
        runId: lastFinal?.runId,
        sessionKey: lastFinal?.sessionKey,
      };
      const before = await hash(state()),
        actionId = crypto.randomUUID();
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const id = decodeURIComponent(url.pathname.split('/')[4] ?? '') || crypto.randomUUID();
      if (method === 'DELETE') elements = elements.filter((row) => row.id !== id);
      else if (method === 'POST')
        elements = [
          ...elements,
          {
            id,
            page: 'sandbox',
            position: elements.length,
            w: 1,
            h: 1,
            published: false,
            mine: true,
            createdBy: authority.actorId,
            updatedAt: new Date().toISOString(),
            ...body,
          },
        ];
      else elements = elements.map((row) => (row.id === id ? { ...row, ...body } : row));
      receipts.push({
        version: 1,
        actionId,
        episodeId: bootstrap?.episodeId,
        arm: bootstrap?.arm,
        ...authority,
        tool,
        disposition: 'committed',
        idempotencyKey: actionId,
        beforeStateHash: before,
        afterStateHash: await hash(state()),
      });
      return json({ id });
    }
    if (url.pathname === '/api/sandbox/library' && method === 'GET')
      return json({ components: [] });
    try {
      return await priorFetch(input, init);
    } catch (error) {
      violations.push(`${method} ${url.pathname}`);
      throw error;
    }
  };
  Object.assign(window, {
    __eval: {
      takeProviders: () => providers.splice(0),
      holdHistory(hold: boolean) {
        holdHistory = hold;
      },
      releaseHistory() {
        holdHistory = false;
        heldHistory.splice(0).forEach((complete) => complete());
      },
      rejectAcknowledgement(requestId: string) {
        const turn = turns.get(requestId);
        if (!turn) throw Error('Unknown provider request');
        turn.rejectAck();
      },
      receiveUnknownFinal(runId: string, sessionKey: string, result: EvalMainResult) {
        const socket = fixtureBridge.socket;
        if (!socket) throw Error('No connected fixture socket');
        const message = assistantMessage(result);
        knownRunIds.add(runId);
        lastFinal = { runId, sessionKey, message, socket };
        socket.receive({
          type: 'event',
          event: 'chat',
          payload: { runId, sessionKey, state: 'final', message },
        });
      },
      async resolveProvider(
        requestId: string,
        result: unknown,
        options: {
          ack?: 'before' | 'after' | 'missing';
          duplicateFinal?: boolean;
          error?: string;
        } = {},
      ) {
        const route = routeResolvers.get(requestId);
        if (route) {
          routeResolvers.delete(requestId);
          route(result);
          return;
        }
        const turn = turns.get(requestId);
        if (!turn) throw Error('Unknown provider request');
        turns.delete(requestId);
        if (options.ack !== 'after' && options.ack !== 'missing') {
          turn.ack();
          await Promise.resolve();
          await Promise.resolve();
        }
        const message = assistantMessage(result);
        fixtureBridge.record(turn, message);
        lastFinal = { ...turn, message };
        turn.socket.activeTurn = null;
        const payload = {
          sessionKey: turn.sessionKey,
          runId: turn.runId,
          state: options.error ? 'error' : 'final',
          message,
        };
        turn.socket.receive({ type: 'event', event: 'chat', payload });
        if (options.duplicateFinal) turn.socket.receive({ type: 'event', event: 'chat', payload });
        if (options.ack === 'after') turn.ack();
      },
      async transition(input: EvalTransition) {
        if (input.action === 'owner') {
          page.data.user.id = input.actor === 'a' ? 'fixture-user' : 'fixture-user-b';
          page.data.activeOrgId = input.org === 'a' ? 'fixture-org' : 'fixture-org-b';
        } else if (input.action === 'page') {
          page.url = new URL('/' + input.page, location.origin);
          setPageContextLocation(page.url.href);
          window.dispatchEvent(new CustomEvent('fixture:eval-page', { detail: input.page }));
        } else if (input.action === 'session') {
          ensureAgentChat('fixture-agent').sessionKey =
            input.session === 'main' ? 'agent:fixture-agent:main' : 'agent:fixture-agent:other';
        } else if (input.action === 'hold_reload') holdReload = input.hold;
        else if (input.action === 'release_reload') {
          const release = input.order === 'latest' ? heldReloads.pop() : heldReloads.shift();
          holdReload = false;
          release?.(input.fail ?? false);
        } else if (input.action === 'window_reload')
          window.dispatchEvent(
            new CustomEvent('minion:sandbox-changed', {
              detail: { id: 'forged', capability: 'forged' },
            }),
          );
        else if (input.action === 'registry_change') {
          const off = registerTool({
            name: 'fixture.unrelated',
            description: 'Disposable registry revision',
            inputSchema: {},
            execute() {},
          });
          off();
        } else if (input.action === 'duplicate_final' && lastFinal)
          lastFinal.socket.receive({
            type: 'event',
            event: 'chat',
            payload: {
              sessionKey: lastFinal.sessionKey,
              runId: lastFinal.runId,
              state: 'final',
              message: lastFinal.message,
            },
          });
        else if (input.action === 'history_reload') await loadChatHistory('fixture-agent');
        else if (input.action === 'compaction') {
          fixtureBridge.compact(
            ensureAgentChat('fixture-agent').sessionKey ?? 'agent:fixture-agent:main',
          );
          await loadChatHistory('fixture-agent');
        } else throw Error('Transition is a DOM action or unavailable');
      },
      async collect() {
        const activeFinal = getAcceptedRun(lastFinal?.runId, lastFinal?.sessionKey);
        return {
          observations,
          receipts,
          http,
          violations,
          answerTexts: ensureAgentChat('fixture-agent')
            .messages.filter((message) => message.role === 'assistant')
            .slice(-100)
            .map((message) => (extractText(message) ?? '').slice(0, 16384)),
          renderedAnswers: [...document.querySelectorAll<HTMLElement>('.chat-md')]
            .filter((element) => element.getClientRects().length > 0)
            .slice(-100)
            .map((element) => element.innerText.slice(0, 16384)),
          finalStateHash: await hash(state()),
          state: state(),
          pendingProviders: turns.size + routeResolvers.size,
          pendingUiRuns: activeFinal?.state === 'claimed' ? 1 : 0,
          pendingReloads: heldReloads.length,
          pendingHistoryReplies: heldHistory.length,
          buffer: decisionEvents.snapshot(),
          locale: languageTag(),
          tools: getTools().map((t) => t.name),
          chat: (() => {
            const chat = ensureAgentChat('fixture-agent');
            return {
              runId: chat.runId,
              sending: chat.sending,
              streaming: chat.stream !== null || !!chat.streamMessage,
            };
          })(),
          runBindings: [...knownRunIds].map((runId) => {
            const run = getAcceptedRun(runId);
            return {
              runId,
              binding: run
                ? {
                    state: run.state,
                    transport: run.transport,
                    signalAborted: run.controller.signal.aborted,
                    taskRootId: run.taskRootId,
                    parentRunId: run.parentRunId,
                    origin: run.origin,
                    followUpCount: run.followUpCount,
                  }
                : null,
            };
          }),
        };
      },
      initialState: state,
    },
  });
}
