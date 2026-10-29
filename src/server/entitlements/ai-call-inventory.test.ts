import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Spec 043: every AI call site in `src/` has a decided gate. A new call site fails CI until someone
 * adds a row here. `scripts/**` is excluded by rule (owner-run scripts). Test files are excluded.
 *
 * Kinds: `route-gate` (the route calls requireFeature/requireOrgFeature), `service-gate` (the
 * service checks the feature itself), `tick`, `job:<type>`, `browser-gateway` (a browser call the
 * gateway allowlist refuses for Base sessions), `backstop-only` (reached only through a gated
 * route or job; the model-call backstop also holds), `platform` (no org-scoped AI work).
 */
type Kind =
  | 'route-gate'
  | 'service-gate'
  | 'tick'
  | `job:${string}`
  | 'browser-gateway'
  | 'backstop-only'
  | 'platform';

const AI_CALL_SITES: Record<string, { kind: Kind; reason?: string }> = {
  // Routes
  'src/routes/api/builder/ai/analyze-run/+server.ts': { kind: 'route-gate' },
  'src/routes/api/builder/ai/dry-run/+server.ts': { kind: 'route-gate' },
  'src/routes/api/builder/ai/suggest-chapter/+server.ts': { kind: 'route-gate' },
  'src/routes/api/builder/ai/suggest-prompts/+server.ts': { kind: 'route-gate' },
  'src/routes/api/builder/ai/suggest-skill/+server.ts': { kind: 'route-gate' },
  'src/routes/api/crm/cleanup/review/+server.ts': { kind: 'route-gate' },
  'src/routes/api/crm/contacts/[id]/funnel/analyze/+server.ts': { kind: 'route-gate' },
  'src/routes/api/crm/tags/[id]/evaluate/+server.ts': { kind: 'route-gate' },
  'src/routes/api/flows/[id]/copilot/+server.ts': { kind: 'route-gate' },
  'src/routes/api/marketplace/generate-agent/+server.ts': { kind: 'route-gate' },
  'src/routes/api/notes/autocomplete/+server.ts': { kind: 'route-gate' },
  'src/routes/api/notes/polish/+server.ts': { kind: 'route-gate' },
  'src/routes/api/notes/refine/+server.ts': { kind: 'route-gate' },
  'src/routes/api/notes/spelling/+server.ts': { kind: 'route-gate' },
  'src/routes/api/notes/transcribe/+server.ts': { kind: 'route-gate' },
  'src/routes/api/personal-agent/create/+server.ts': { kind: 'route-gate' },
  'src/routes/api/structured-stream/+server.ts': { kind: 'route-gate' },
  'src/routes/api/voice/tts/+server.ts': { kind: 'route-gate' },
  // Services that check the feature themselves
  'src/server/services/personal-agent-provisioner.ts': {
    kind: 'service-gate',
    reason: 'orgAllows(ai) before provisioning or reporting a pending agent',
  },
  // Ticks
  'src/server/services/crm-conversation-analysis.service.ts': {
    kind: 'tick',
    reason: 'api/crm/conversations/analyze/tick checks ai.proactive per org',
  },
  'src/server/services/crm-relationship-inference.service.ts': {
    kind: 'tick',
    reason: 'api/crm/relationship/tick checks ai.proactive per org',
  },
  'src/server/services/reminder-compose.ts': {
    kind: 'tick',
    reason: 'reminders.service reads personalize/inferConfirmation as false without ai.proactive',
  },
  // Background jobs (bg-runtime checks JobHandler.feature)
  'src/server/services/pulse-digest.reasoning.ts': { kind: 'job:pulse_digest' },
  'src/server/services/groupchat.service.ts': {
    kind: 'job:groupchat',
    reason: 'playground.complete inside the groupchat job (feature ai)',
  },
  // Browser gateway calls (gateway allowlist refuses them for Base sessions)
  'src/lib/state/features/personal-agent.svelte.ts': {
    kind: 'browser-gateway',
    reason: 'agents.create; the hub reports no pending agent for an org without ai',
  },
  'src/lib/state/workshop/experiments.svelte.ts': {
    kind: 'browser-gateway',
    reason: 'playground.complete; the workshop page is hidden',
  },
  'src/lib/services/gateway/chat-rpc.ts': {
    kind: 'browser-gateway',
    reason: 'chat.send; refused by the gateway allowlist for Base sessions (S4)',
  },
  'src/lib/services/my-agent-rpc.ts': {
    kind: 'browser-gateway',
    reason: 'myAgent.emailSummary/emailDraftReply; gateway allowlist (S4), controls hidden (S3)',
  },
  'src/lib/services/gateway-rpc.ts': {
    kind: 'browser-gateway',
    reason: 'agent.install from the marketplace page; gateway allowlist (S4), page hidden (S3)',
  },
  'src/lib/workshop/gateway-bridge.ts': {
    kind: 'browser-gateway',
    reason: 'chat.send from the workshop canvas; the workshop page is hidden',
  },
  // Reached only through a gated route or job
  'src/lib/server/artifacts/builder.ts': {
    kind: 'backstop-only',
    reason: 'api/artifacts/generate and api/artifacts/[id]/regenerate',
  },
  'src/server/services/crm-insights.service.ts': {
    kind: 'backstop-only',
    reason: 'api/crm/insights/{win-index,sentiment}',
  },
  'src/server/services/crm-journey.service.ts': {
    kind: 'backstop-only',
    reason: 'api/crm/contacts/[id]/journey/analyze',
  },
  'src/server/services/crm-similarity.service.ts': {
    kind: 'backstop-only',
    reason: 'api/crm/contacts/[id]/similar-wins',
  },
  'src/server/services/doors-faq-draft.service.ts': {
    kind: 'backstop-only',
    reason: 'api/crm/doors/[id]/faq-draft',
  },
  'src/server/services/assistant-router.service.ts': {
    kind: 'backstop-only',
    reason: 'api/assistant/route (ai.chat); calls assertAiCallAllowed itself',
  },
  'src/server/services/embeddings.ts': {
    kind: 'backstop-only',
    reason:
      'the embeddings chokepoint (assertAiCallAllowed); brains, agent-memories, vectorize tick',
  },
  'src/server/services/builder-agent-publisher.ts': {
    kind: 'backstop-only',
    reason: 'agents.create, reached only from api/builder/agents/[id] (route-gate)',
  },
  'src/server/services/brain-agents.service.ts': {
    kind: 'backstop-only',
    reason:
      'agents.create/agents.delete, reached only from api/brains/* and the hidden /brains/template',
  },
  // Platform
  'src/server/llm.ts': {
    kind: 'platform',
    reason: 'the provider factory and usage middleware backstop',
  },
  'src/server/db/pg-schema/ai-usage.ts': {
    kind: 'platform',
    reason: 'metering schema; comment only',
  },
};

const ROOT = process.cwd();
// Any literal of an AI gateway method counts, however the caller names its RPC helper
// (gatewayCall, sendRequest, beginRequest, an injected `rpc`/`call`).
const AI_METHODS =
  /['"](media\.transcribe|playground\.complete|agents\.create|agents\.delete|chat\.send|myAgent\.emailSummary|myAgent\.emailDraftReply|agent\.install)['"]/;
const DIRECT_AI = /getOpenRouterModel\(|openrouter\.ai|elevenlabs\.io/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|js|svelte)$/.test(name) && !/\.(test|spec)\.ts$/.test(name)) out.push(full);
  }
  return out;
}

function scan(): string[] {
  return walk(join(ROOT, 'src'))
    .filter((file) => !file.includes('/src/lib/paraglide/'))
    .filter((file) => {
      const text = readFileSync(file, 'utf8');
      return DIRECT_AI.test(text) || AI_METHODS.test(text);
    })
    .map((file) => relative(ROOT, file))
    .sort();
}

describe('AI call inventory (spec 043)', () => {
  const found = scan();

  it('every AI call site in src/ has a decided gate', () => {
    expect(found.filter((f) => !AI_CALL_SITES[f])).toEqual([]);
  });

  it('no stale rows', () => {
    expect(Object.keys(AI_CALL_SITES).filter((f) => !found.includes(f))).toEqual([]);
  });

  it('every route-gate file calls requireFeature or requireOrgFeature', () => {
    const ungated = Object.entries(AI_CALL_SITES)
      .filter(([, row]) => row.kind === 'route-gate')
      .map(([file]) => file)
      .filter((file) => !/require(Org)?Feature\(/.test(readFileSync(join(ROOT, file), 'utf8')));
    expect(ungated).toEqual([]);
  });

  it('every service-gate file checks the feature itself', () => {
    const ungated = Object.entries(AI_CALL_SITES)
      .filter(([, row]) => row.kind === 'service-gate')
      .map(([file]) => file)
      .filter(
        (file) => !/orgAllows\(|assertAiCallAllowed\(/.test(readFileSync(join(ROOT, file), 'utf8')),
      );
    expect(ungated).toEqual([]);
  });

  it('non-route rows say why they are covered', () => {
    const silent = Object.entries(AI_CALL_SITES)
      .filter(([, row]) => !['route-gate'].includes(row.kind) && !row.kind.startsWith('job:'))
      .filter(([, row]) => !row.reason)
      .map(([file]) => file);
    expect(silent).toEqual([]);
  });
});
