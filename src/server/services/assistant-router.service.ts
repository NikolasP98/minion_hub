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
} from '$lib/assistant/turn-router';

const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';
const JEV_MODEL = '~typesafe/jev-latest';
/** Matches the client's AbortSignal budget — a slow classifier must not delay a send. */
const TIMEOUT_MS = 1500;
/** The classifier only ever needs the gist; a pasted wall of text is not a better signal. */
const MAX_TEXT_CHARS = 2000;
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

/** The state the classifier reads. Fenced and labelled as data, never instructions. */
function buildState(text: string, locale: string | undefined): string {
  return [`ui_locale: ${locale ?? 'en'}`, '', 'REQUEST:', text.slice(0, MAX_TEXT_CHARS)].join('\n');
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
export async function classifyAssistantTurn(
  input: { text: string; locale?: string },
  deps: ClassifyDeps,
): Promise<RouteDecision | null> {
  const text = input.text.trim();
  if (!text || !deps.apiKey) return null;
  const started = Date.now();
  try {
    const response = await (deps.fetcher ?? fetch)(DECISIONS_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deps.apiKey}` },
      body: JSON.stringify({
        model: JEV_MODEL,
        state: buildState(text, input.locale),
        questions: buildQuestions(),
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    const raw = await response.text();
    if (raw.length > MAX_RESPONSE_BYTES) return null;
    const body: unknown = JSON.parse(raw);
    const answers = isRecord(body) && isRecord(body.answers) ? body.answers : null;
    if (!answers) return null;
    const mode = readMode(answers.mode);
    if (!mode) return null;

    const manifests: Partial<Record<ManifestId, number>> = {};
    for (const manifest of CONTEXT_MANIFESTS) {
      const answer = answers[manifest.id];
      const p = isRecord(answer) ? probability(answer.noul) : undefined;
      if (p !== undefined) manifests[manifest.id] = p;
    }
    // A decision that answered no manifest question gates nothing usefully;
    // treat it as a failure so the caller sends the full envelope.
    if (Object.keys(manifests).length === 0) return null;

    const usage = isRecord(body) && isRecord(body.usage) ? body.usage : {};
    return {
      mode: mode.mode,
      probabilities: mode.probabilities,
      manifests,
      ms: Date.now() - started,
      cost: typeof usage.cost === 'number' && Number.isFinite(usage.cost) ? usage.cost : 0,
    };
  } catch {
    // Timeout, abort, network error, malformed JSON — all fail open.
    return null;
  }
}
