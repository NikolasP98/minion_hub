import { expect, type Page, type TestInfo } from '@playwright/test';
import type {
  EvalMainResult,
  EvalReset,
  EvalTransition,
} from '../../fixtures/critical-journeys/eval-protocol';
import type { DecisionEvent } from '../../../src/lib/assistant/decision-lineage';
export type Surface = 'home' | 'floating';
export interface ProviderRequest {
  requestId: string;
  kind: 'main';
  runId: string;
  sessionKey: string;
  message: string;
  messages: Array<{ role: string; content: string }>;
}
interface RunBinding {
  state: string;
  transport: string;
  signalAborted: boolean;
  taskRootId: string;
  parentRunId: string | null;
  origin: string;
  followUpCount: number;
}
export interface AssistantSnapshot {
  observations: DecisionEvent[];
  receipts: Array<{
    actionId: string;
    runId: string;
    tool: string;
    disposition: string;
    beforeStateHash: string;
    afterStateHash: string;
  }>;
  http: Array<{ method: string; path: string }>;
  violations: string[];
  answerTexts: string[];
  renderedAnswers: string[];
  pendingProviders: number;
  pendingUiRuns: number;
  pendingReloads: number;
  pendingHistoryReplies: number;
  state: { elements: Array<{ id: string; title: string }> };
  tools: string[];
  chat: { runId: string | null; sending: boolean; streaming: boolean };
  runBindings: Array<{ runId: string; binding: RunBinding | null }>;
}
export interface EvalApi {
  takeProviders(): Array<ProviderRequest | { requestId: string; kind: 'classifier' }>;
  resolveProvider(
    requestId: string,
    result: EvalMainResult,
    options?: { ack?: 'before' | 'after' | 'missing'; duplicateFinal?: boolean; error?: string },
  ): Promise<void>;
  rejectAcknowledgement(requestId: string): void;
  receiveUnknownFinal(runId: string, sessionKey: string, result: EvalMainResult): void;
  holdHistory(hold: boolean): void;
  releaseHistory(): void;
  transition(input: EvalTransition): Promise<void>;
  collect(): Promise<AssistantSnapshot>;
}
export type AssistantWindow = typeof window & {
  __eval: EvalApi;
  __critical: {
    snapshot(): {
      connected: boolean;
      unexpected: string[];
      requests: Array<{
        method: string;
        params?: { idempotencyKey?: string; runId?: string; sessionKey?: string; message?: string };
      }>;
    };
  };
};
export const assistantSnapshot = (page: Page) =>
  page.evaluate(() => (window as AssistantWindow).__eval.collect());
export const bindingFor = (snapshot: AssistantSnapshot, runId: string) =>
  snapshot.runBindings.find((row) => row.runId === runId)?.binding;
export const actualSends = (page: Page) =>
  page.evaluate(() =>
    (window as AssistantWindow).__critical
      .snapshot()
      .requests.filter((request) => request.method === 'chat.send'),
  );
export const uiCalls = (calls: Array<{ tool: string; input: Record<string, unknown> }>) =>
  '```minion-ui\n' + JSON.stringify(calls) + '\n```';
const clocked = new WeakSet<Page>();
export async function pauseAssistantTimers(page: Page) {
  if (!clocked.has(page)) {
    await page.clock.install();
    clocked.add(page);
  }
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(new Date(now + 20));
}
export async function advanceAssistantTime(page: Page, milliseconds: number) {
  const now = await page.evaluate(() => Date.now());
  await page.clock.setFixedTime(new Date(now + milliseconds));
  clocked.add(page);
}
export async function openAssistant(
  page: Page,
  surface: Surface,
  locale: 'en' | 'es',
  options: { sandbox?: boolean; arm?: EvalReset['arm'] } = {},
) {
  if (clocked.has(page)) await page.clock.setFixedTime(new Date());
  const reset: EvalReset = {
    episodeId: `installed-${surface}-${locale}`,
    arm: options.arm ?? 'full',
    seed: 7,
    persona: 'owner',
    initialState: 'empty',
    locale,
    surface,
    sandbox: options.sandbox ?? true,
    model: { requestedModel: 'fixture/main', boundDescriptor: 'fixture/bounded-v1' },
  };
  await page.addInitScript((value) => {
    (window as typeof window & { __evalBootstrap: EvalReset }).__evalBootstrap = value;
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      /* first opaque document has no storage */
    }
  }, reset);
  await page.goto('/eval.html');
  await expect
    .poll(() =>
      page.evaluate(() => (window as AssistantWindow).__critical?.snapshot().connected ?? false),
    )
    .toBe(true);
  await expect(page.getByRole('textbox').first()).toBeVisible();
  if (reset.sandbox)
    await expect
      .poll(async () => (await assistantSnapshot(page)).tools.includes('sandbox.upsert_element'))
      .toBe(true);
  expect((await assistantSnapshot(page)).violations).toEqual([]);
}
export async function sendUser(page: Page, text: string) {
  const input = page.getByRole('textbox').first();
  await input.fill(text);
  await input.press('Enter');
  return nextMain(page);
}
export async function nextMain(page: Page) {
  let requests: ReturnType<EvalApi['takeProviders']> = [];
  await expect
    .poll(async () => {
      requests = await page.evaluate(() => (window as AssistantWindow).__eval.takeProviders());
      return requests.length > 0;
    })
    .toBe(true);
  expect(requests).toHaveLength(1);
  expect(requests[0].kind).toBe('main');
  if (requests[0].kind !== 'main')
    throw Error('Installed assistant journeys cannot admit a classifier provider');
  return requests[0];
}
export async function respond(
  page: Page,
  request: ProviderRequest,
  result: EvalMainResult,
  options: Parameters<EvalApi['resolveProvider']>[2] = {},
) {
  await page.evaluate(
    async ({ requestId, result, options }) =>
      (window as AssistantWindow).__eval.resolveProvider(requestId, result, options),
    { requestId: request.requestId, result, options },
  );
}
export async function transition(page: Page, input: EvalTransition) {
  await page.evaluate((value) => (window as AssistantWindow).__eval.transition(value), input);
}
export async function settled(page: Page) {
  await expect
    .poll(async () => {
      const s = await assistantSnapshot(page);
      return s.pendingUiRuns + s.pendingReloads + s.pendingProviders + Number(s.chat.streaming);
    })
    .toBe(0);
}
export async function keyboardStop(page: Page) {
  const stop = page.getByRole('button', { name: /^(?:Stop|Detener)/i }).first();
  await expect(stop).toBeVisible();
  await stop.focus();
  await page.keyboard.press('Enter');
}
export async function attachAssistantEvidence(
  info: TestInfo,
  page: Page,
  label: string,
  values: unknown[],
) {
  expect(
    await page.evaluate(() => (window as AssistantWindow).__critical.snapshot().unexpected),
  ).toEqual([]);
  expect((await assistantSnapshot(page)).violations).toEqual([]);
  await info.attach('assistant-runtime', {
    body: JSON.stringify({ label, values }),
    contentType: 'application/json',
  });
  const screenshot = info.outputPath(`${label}.png`);
  await page.screenshot({ path: screenshot });
  await info.attach(`${label}-render`, { path: screenshot, contentType: 'image/png' });
}
export const contexts: ReadonlyArray<readonly [Surface, 'en' | 'es']> = [
  ['home', 'en'],
  ['home', 'es'],
  ['floating', 'en'],
  ['floating', 'es'],
];
export const mutationResult: EvalMainResult = {
  text: uiCalls([
    {
      tool: 'sandbox.upsert_element',
      input: { title: 'Installed fixture visual', html: '<p>Fixture</p>', js: '' },
    },
    { tool: 'sandbox.list_elements', input: {} },
  ]),
};
export async function assertRevoked(page: Page, runId: string) {
  await expect
    .poll(async () => {
      const s = await assistantSnapshot(page);
      return s.pendingUiRuns + s.pendingReloads;
    })
    .toBe(0);
  const s = await assistantSnapshot(page);
  expect(s.receipts).toHaveLength(1);
  expect(s.receipts[0]).toMatchObject({
    runId,
    tool: 'sandbox.upsert_element',
    disposition: 'committed',
  });
  expect(s.receipts[0].beforeStateHash).not.toBe(s.receipts[0].afterStateHash);
  expect(await actualSends(page)).toHaveLength(1);
  expect(s.pendingProviders).toBe(0);
  expect(s.violations).toEqual([]);
  const binding = bindingFor(s, runId);
  expect(binding === null || binding === undefined || binding.signalAborted).toBe(true);
  return s;
}
