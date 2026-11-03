import { createHash, randomUUID } from 'node:crypto';
import { assertAiCallAllowed, isEnforced } from '$server/services/entitlements.service';
/**
 * The JEV classifier call behind `POST /api/assistant/route`.
 *
 * One request to OpenRouter's decisions endpoint (model `~typesafe/jev-latest`)
 * carrying both typed stages: ONE `choice` over the turn modes and one `noul`
 * per context manifest. Typed decisions only — bounded answers with a
 * probability per option, never free text, so nothing the model emits can reach
 * the user or steer the agent.
 *
 * The hub has no committed JEV client to reuse (`crm-jev.ts` never shipped to
 * master), and this is a one-shot JSON POST, so it stays here rather than
 * becoming a second HTTP abstraction. Reuses the existing `OPENROUTER_API_KEY`.
 *
 * Never throws: every failure path returns `null` and the caller fails open to
 * the full context envelope.
 */
import {
  CONTEXT_MANIFESTS,
  ROUTE_MODES,
  type ManifestId,
  type RouteDecision,
  type RouteMode,
  type RouteEvidence,
  type RouteAttempt,
  canonicalUuid,
} from '$lib/assistant/turn-router';

const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';
const JEV_MODEL = '~typesafe/jev-latest';
/** Matches the client's AbortSignal budget — a slow classifier must not delay a send. */
const TIMEOUT_MS = 1500;
/** The classifier only ever needs the gist; a pasted wall of text is not a better signal. */
const MAX_TEXT_CHARS = 2000;
/** A canonical route, not a URL: `/sandbox`, `/crm/<id>`. */
const MAX_PAGE_CHARS = 120;
const MAX_RESPONSE_BYTES = 32_768;

const MODE_CRITERIA: Readonly<Record<RouteMode, string>> = {
  navigate: 'The user wants to go somewhere in the dashboard, or to see a page, list or view.',
  record_action:
    'The user wants to create, fill in, edit or delete a record (a sale, booking, invoice, customer, stock entry).',
  data_question:
    "A question about this organization's live business data: totals, counts, who/when/how much.",
  knowledge_question:
    'A question about the organization’s own knowledge, history, past conversations, or about this dashboard itself (its updates, releases, settings, how to use it).',
  chat: 'Small talk, thanks, an acknowledgement, or a follow-up that needs no new context.',
};

/** A canonical in-app path, or nothing. Caller-supplied, so it is validated
 * here too: anything that is not a short single-line absolute path is dropped
 * rather than echoed into the classifier state. */
export function canonicalPage(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const path = value.trim();
  return path.startsWith('/') && path.length <= MAX_PAGE_CHARS && !/\s/.test(path)
    ? path
    : undefined;
}

/** The state the classifier reads. Fenced and labelled as data, never instructions. */
function buildState(text: string, locale: string | undefined, page?: string): string {
  const route = canonicalPage(page);
  return [
    `ui_locale: ${locale ?? 'en'}`,
    ...(route ? [`page: ${route}`] : []),
    '',
    'REQUEST:',
    text.slice(0, MAX_TEXT_CHARS),
  ].join('\n');
}

function buildQuestions(): Record<string, unknown> {
  const questions: Record<string, unknown> = {
    mode: {
      type: 'choice',
      instructions:
        'Which kind of request is this? The request is written by a user of a business ' +
        'dashboard, talking to its in-app assistant.',
      criteria: MODE_CRITERIA,
    },
  };
  for (const manifest of CONTEXT_MANIFESTS) {
    questions[manifest.id] = { type: 'noul', instructions: manifest.question };
  }
  return questions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function probability(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : undefined;
}

/** Read the `choice` answer: the winning mode plus its full distribution. */
function readMode(
  answer: unknown,
): { mode: RouteMode; probabilities: Partial<Record<RouteMode, number>> } | null {
  if (!isRecord(answer)) return null;
  const probabilities: Partial<Record<RouteMode, number>> = {};
  const raw = isRecord(answer.probabilities) ? answer.probabilities : {};
  for (const mode of ROUTE_MODES) {
    const p = probability(raw[mode]);
    if (p !== undefined) probabilities[mode] = p;
  }
  // Trust the provider's own argmax only when it names a mode we asked for;
  // otherwise take the argmax of the distribution we validated ourselves.
  const declared = answer.choice;
  if (typeof declared === 'string' && (ROUTE_MODES as readonly string[]).includes(declared)) {
    return { mode: declared as RouteMode, probabilities };
  }
  const entries = Object.entries(probabilities) as Array<[RouteMode, number]>;
  if (entries.length === 0) return null;
  return {
    mode: entries.reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0],
    probabilities,
  };
}

export interface ClassifyDeps {
  apiKey: string;
  fetcher?: typeof fetch;
}

/**
 * Classify one assistant turn. Returns `null` on a missing key, a timeout, a
 * non-200, an oversized body, malformed JSON or an unusable answer — the caller
 * turns `null` into today's full envelope.
 */
export async function classifyAssistantTurnWithEvidence(
  input: { text: string; locale?: string; page?: string; submissionId?: string },
  deps: ClassifyDeps,
): Promise<RouteEvidence> {
  const text = input.text.trim();
  if (!text || !deps.apiKey) return { decision: null, attempt: null };
  if (isEnforced()) await assertAiCallAllowed('assistant-router'); // spec 043 backstop, no-op unless enforced
  const started = Date.now();
  const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const questions = buildQuestions();
  const attempt: RouteAttempt = {
    attemptId: randomUUID(),
    submissionId: canonicalUuid(input.submissionId) ? input.submissionId : null,
    requestedModel: JEV_MODEL,
    resolvedModel: null,
    schemaRevision: sha({
      mode: ROUTE_MODES,
      manifests: CONTEXT_MANIFESTS.map((m) => m.id),
      answer: ['choice', 'probabilities', 'noul'],
    }),
    questionRevision: sha(questions),
    gateRevision: sha(
      CONTEXT_MANIFESTS.map(({ id, mode, threshold }) => ({ id, mode, threshold })),
    ),
    elapsedMs: 0,
    serverDeadlineMs: TIMEOUT_MS,
    disposition: 'error',
    cost: { status: 'unknown', usd: null },
  };
  let decision: RouteDecision | null = null;
  try {
    const response = await (deps.fetcher ?? fetch)(DECISIONS_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deps.apiKey}` },
      body: JSON.stringify({
        model: JEV_MODEL,
        state: buildState(text, input.locale, input.page),
        questions,
      }),
    });
    // Parse bounded provider receipts even on HTTP-error/invalid-decision responses.
    const reader = response.body?.getReader();
    let raw = '',
      bytes = 0;
    if (reader) {
      const decoder = new TextDecoder();
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          attempt.disposition = 'invalid';
          return { decision, attempt };
        }
        raw += decoder.decode(part.value, { stream: true });
      }
      raw += decoder.decode();
    }
    attempt.disposition = response.ok ? 'invalid' : 'error';
    const body: unknown = JSON.parse(raw);
    if (!isRecord(body)) return { decision, attempt };
    if (typeof body.model === 'string' && /^[A-Za-z0-9~_.:/+-]{1,160}$/.test(body.model))
      attempt.resolvedModel = body.model;
    const usage = isRecord(body.usage) ? body.usage : {};
    if (typeof usage.cost === 'number' && Number.isFinite(usage.cost) && usage.cost >= 0)
      attempt.cost = { status: 'known', usd: usage.cost };
    for (const [sources, target] of [
      [['input_tokens', 'prompt_tokens'], 'inputTokens'],
      [['output_tokens', 'completion_tokens'], 'outputTokens'],
    ] as const) {
      const value = usage[sources[0]] ?? usage[sources[1]];
      if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
        attempt[target] = value;
    }
    if (!response.ok) return { decision, attempt };
    const answers = isRecord(body.answers) ? body.answers : null;
    if (!answers) return { decision, attempt };
    const mode = readMode(answers.mode);
    if (!mode) return { decision, attempt };
    const manifests: Partial<Record<ManifestId, number>> = {};
    for (const manifest of CONTEXT_MANIFESTS) {
      const answer = answers[manifest.id];
      const p = isRecord(answer) ? probability(answer.noul) : undefined;
      if (p !== undefined) manifests[manifest.id] = p;
    }
    if (!Object.keys(manifests).length) return { decision, attempt };
    attempt.disposition = 'ok';
    decision = {
      mode: mode.mode,
      probabilities: mode.probabilities,
      manifests,
      ms: Date.now() - started,
      cost: attempt.cost.usd ?? 0,
    };
    return { decision, attempt };
  } catch (error) {
    attempt.disposition =
      error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
        ? 'timeout'
        : attempt.disposition;
    return { decision: null, attempt };
  } finally {
    attempt.elapsedMs = Date.now() - started;
  }
}
export async function classifyAssistantTurn(
  input: { text: string; locale?: string; page?: string },
  deps: ClassifyDeps,
): Promise<RouteDecision | null> {
  return (await classifyAssistantTurnWithEvidence(input, deps)).decision;
}
