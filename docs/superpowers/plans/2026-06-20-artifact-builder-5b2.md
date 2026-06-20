# LLM Artifact Builder (5b.2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A hub-side LLM builder that turns an admin prompt + an autonomous agent's exported-variable schema (5b.1) + the artifact design contract into a self-contained HTML bundle, stored via 5a and surfaced as a **Generate** tab on the gallery `+`.

**Architecture:** pure prompt/extract/validate helpers + a `generateArtifactHtml` OpenRouter call (Vercel AI SDK) + a `POST /api/artifacts/generate` admin route + a Generate/Paste tabbed create modal. Whole-bundle generation using the overview bundle as the canonical reference; the sandboxed iframe is the safety net.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, TypeScript, Vercel AI SDK (`ai` + `@ai-sdk/openai` via OpenRouter), Paraglide, Vitest, Bun. Hub, branch `dev`.

## Global Constraints

- Svelte 5 runes; TS strict, no `any`; no `@ts-nocheck`.
- i18n in BOTH `messages/en.json` + `messages/es.json`; `bun run i18n:compile` before `bun run check`.
- `bun run check` 0/0; `bun run test` green. Commits UNSIGNED (`git -c commit.gpgsign=false`); never `git add` a lockfile or `sdd/`.
- Svelte MCP autofixer on the modal before committing.
- Server-only modules under `src/lib/server/` or `$server`; the OpenRouter key (`env.OPENROUTER_API_KEY`) never reaches the client. Write API requires `requireAdmin(locals)` + `requireCoreCtx(locals)`.
- No live LLM in unit tests (test the pure helpers only).

## Reference: verified shapes

- OpenRouter call (copy the pattern from `src/server/services/reminder-compose.ts`): `import { createOpenAI } from '@ai-sdk/openai'; import { generateText } from 'ai'; import { env } from '$env/dynamic/private';` → `const openrouter = createOpenAI({ apiKey: env.OPENROUTER_API_KEY, baseURL: 'https://openrouter.ai/api/v1' }); const res = await generateText({ model: openrouter(MODEL), prompt, temperature }); res.text`. (Confirm the exact `env`/`createOpenAI` import in `reminder-compose.ts` before writing `builder.ts`.)
- 5a: `createArtifactRow(ctx, { agentId, title, description, icon, html })` + `artifactRowToDescriptor(row)` (`src/lib/server/artifacts/store.ts`). `POST /api/artifacts/+server.ts` is the route pattern (requireAdmin → requireCoreCtx → createArtifactRow → json(descriptor, {status:201})).
- 5b.1: `flowExportedSpecs(flow)` + `flowVariableSchema(specs, toggles)` (`$lib/flows/...`); `getMasterFlow(flowId)`; `listExportToggles(ctx, flowId)` (`$lib/server/flows/exports-store`); `VariableSpec { key, type, label, description?, sample?, defaultExported? }`.
- System agents: `getSystemAgentDescriptors()` → `{ id, name, role, trigger, flowId, … }` (`$lib/server/system-agents/registry`).
- Reference bundle: `import overviewHtml from '$lib/artifacts/builtin/overview/index.html?raw'`.
- `requireAdmin` (`$server/auth/authorize`), `requireCoreCtx` (`$server/auth/core-ctx`), `CoreCtx { db, tenantId, profileId? }`.
- `ArtifactCreateModal.svelte` (5a): `{ open=$bindable, agentId, oncreated }`; fields title/description/icon/html; `POST /api/artifacts`.
- Autonomous loads (5b.1) already build `flowTogglesByFlow`; `+page.server.ts` (roster) + `[id]/+page.server.ts` (detail) have `ctx`.

---

### Task 1: Pure builder helpers (prompt / extract / validate)

**Files:** Create `src/lib/server/artifacts/builder-prompt.ts`, `src/lib/server/artifacts/builder-prompt.test.ts`.

**Interfaces — Produces:**
- `buildBuilderPrompt(args: { agent: { name: string; role: string; trigger: string }; schema: VariableSpec[]; userPrompt: string; reference: string }): string`
- `extractHtml(text: string): string`
- `validateBundle(html: string): void` (throws `Error` on invalid)

- [ ] **Step 1: Failing tests** — `builder-prompt.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildBuilderPrompt, extractHtml, validateBundle } from './builder-prompt';
import type { VariableSpec } from '$lib/flows/master-flows';

describe('extractHtml', () => {
  it('strips ```html fences', () => {
    expect(extractHtml('```html\n<!doctype html><html></html>\n```')).toBe('<!doctype html><html></html>');
  });
  it('strips prose before the doctype', () => {
    expect(extractHtml('Here is your artifact:\n<!doctype html><html></html>')).toBe('<!doctype html><html></html>');
  });
  it('returns raw html unchanged', () => {
    expect(extractHtml('<!doctype html><html></html>')).toBe('<!doctype html><html></html>');
  });
});
describe('validateBundle', () => {
  it('passes a bundle that uses the bridge', () => {
    expect(() => validateBundle("<html><script>bridge.call('hub.artifact.context.get')</script></html>")).not.toThrow();
  });
  it('throws on empty', () => { expect(() => validateBundle('   ')).toThrow(); });
  it('throws when the bridge call is missing', () => { expect(() => validateBundle('<html><body>hi</body></html>')).toThrow(); });
});
describe('buildBuilderPrompt', () => {
  it('includes the agent name, every schema key, and the user prompt', () => {
    const schema: VariableSpec[] = [{ key: 'reminders.sent', type: 'int', label: 'Sent', sample: 42 }];
    const p = buildBuilderPrompt({ agent: { name: 'Reminders', role: 'Appt', trigger: 'cron' }, schema, userPrompt: 'a sent/failed card', reference: '<!doctype html>' });
    expect(p).toContain('Reminders');
    expect(p).toContain('reminders.sent');
    expect(p).toContain('a sent/failed card');
  });
});
```

- [ ] **Step 2: Run red** — `bun run test -- src/lib/server/artifacts/builder-prompt.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `builder-prompt.ts`:
```ts
import type { VariableSpec } from '$lib/flows/master-flows';

export function extractHtml(text: string): string {
  let t = text.trim();
  const fence = t.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const i = t.search(/<!doctype html|<html/i);
  return i >= 0 ? t.slice(i).trim() : t;
}

export function validateBundle(html: string): void {
  const h = html.trim();
  if (!h) throw new Error('builder returned empty output');
  if (!h.includes('<')) throw new Error('builder output is not HTML');
  if (!h.includes('hub.artifact.context.get'))
    throw new Error('builder output does not use the artifact context bridge');
}

export function buildBuilderPrompt(args: {
  agent: { name: string; role: string; trigger: string };
  schema: VariableSpec[];
  userPrompt: string;
  reference: string;
}): string {
  const vars = args.schema.length
    ? args.schema.map((s) => `- ${s.key} (${s.type}) — ${s.label}${s.sample !== undefined ? `, e.g. ${JSON.stringify(s.sample)}` : ''}`).join('\n')
    : '(none — render the base fields only)';
  return [
    'You generate ONE self-contained HTML artifact (a small dashboard) for an AI agent.',
    'Output ONLY the HTML document — no prose, no markdown fences.',
    '',
    'CONTRACT (follow exactly):',
    "- Reuse the reference's <script> bridge client VERBATIM — the plugin:ready / host:hello / hub.artifact.context.get handshake and origin checks MUST be byte-identical. Only change the render() body + the markup/styles.",
    '- Theme with the CSS custom properties applied from host:hello (use var(--color-…) etc.); no hard-coded hex except as var() fallbacks.',
    '- Get data by calling the bridge for "hub.artifact.context.get". The context shape is:',
    '  { agentName, agentRole, agentDescription, status, trigger, vars: { <key>: value } }',
    '  where vars holds the agent variables listed below (bind to vars["the.key"]).',
    '- Render a loading state, an empty/missing state, and an error state.',
    '- Self-contained: inline CSS + JS only. No external network, CDN, fonts, or imports.',
    '',
    `AGENT: ${args.agent.name} — ${args.agent.role}. Trigger: ${args.agent.trigger}.`,
    'AVAILABLE VARIABLES (context.vars keys):',
    vars,
    '',
    `USER REQUEST: ${args.userPrompt}`,
    '',
    'REFERENCE ARTIFACT (copy its bridge <script> verbatim; adapt the render + styles):',
    args.reference,
  ].join('\n');
}
```

- [ ] **Step 4: Run green + commit** — test PASS; `bun run check` 0.
```bash
git add src/lib/server/artifacts/builder-prompt.ts src/lib/server/artifacts/builder-prompt.test.ts
git -c commit.gpgsign=false commit -m "feat(builder): pure artifact-builder prompt + extractHtml + validateBundle"
```

---

### Task 2: The builder (OpenRouter call)

**Files:** Create `src/lib/server/artifacts/builder.ts`.

**Interfaces — Produces:** `generateArtifactHtml(ctx: CoreCtx, args: { agentId: string; prompt: string }): Promise<string>`.

> No unit test (LLM glue; pure parts are tested in T1). Verified by `bun run check` + live smoke.

- [ ] **Step 1: Read** `src/server/services/reminder-compose.ts` for the exact `createOpenAI`/`generateText`/`env` imports + usage. Mirror them.

- [ ] **Step 2: Implement** — `builder.ts`:
```ts
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { env } from '$env/dynamic/private';
import type { CoreCtx } from '$server/auth/core-ctx';
import { getSystemAgentDescriptors } from '$lib/server/system-agents/registry';
import { getMasterFlow, flowExportedSpecs } from '$lib/flows/master-flows';
import { flowVariableSchema } from '$lib/flows/flow-variables';
import { listExportToggles } from '$lib/server/flows/exports-store';
import overviewHtml from '$lib/artifacts/builtin/overview/index.html?raw';
import { buildBuilderPrompt, extractHtml, validateBundle } from './builder-prompt';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const BUILDER_MODEL = env.ARTIFACT_BUILDER_MODEL || 'anthropic/claude-3.7-sonnet';

export async function generateArtifactHtml(
  ctx: CoreCtx,
  args: { agentId: string; prompt: string },
): Promise<string> {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('artifact builder unavailable: OPENROUTER_API_KEY not set');

  const desc = getSystemAgentDescriptors().find((d) => d.id === args.agentId);
  if (!desc?.flowId) throw new Error('unknown agent or agent has no flow');
  const flow = getMasterFlow(desc.flowId);
  const specs = flow ? flowExportedSpecs(flow) : [];
  const toggles = await listExportToggles(ctx, desc.flowId).catch(() => ({}));
  const schema = flowVariableSchema(specs, toggles);

  const prompt = buildBuilderPrompt({
    agent: { name: desc.name, role: desc.role, trigger: desc.trigger },
    schema,
    userPrompt: args.prompt,
    reference: overviewHtml,
  });

  const openrouter = createOpenAI({ apiKey, baseURL: OPENROUTER_BASE_URL });
  const res = await generateText({ model: openrouter(BUILDER_MODEL), prompt, temperature: 0.3 });
  const html = extractHtml(res.text);
  validateBundle(html);
  return html;
}
```
(Adjust imports to match `reminder-compose.ts` exactly if it differs, e.g. `env` source.)

- [ ] **Step 3: Verify + commit** — `bun run check` 0.
```bash
git add src/lib/server/artifacts/builder.ts
git -c commit.gpgsign=false commit -m "feat(builder): generateArtifactHtml — OpenRouter build from agent variable schema"
```

---

### Task 3: Generate API

**Files:** Create `src/routes/api/artifacts/generate/+server.ts`.

> No unit test (route glue); admin-gating + generation verified live.

- [ ] **Step 1: POST** —
```ts
import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { generateArtifactHtml } from '$lib/server/artifacts/builder';
import { createArtifactRow, artifactRowToDescriptor } from '$lib/server/artifacts/store';

export const POST: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const ctx = await requireCoreCtx(locals);
  const body = (await request.json().catch(() => null)) as
    | { agentId?: string; title?: string; icon?: string; description?: string; prompt?: string }
    | null;
  if (!body?.agentId || !body.title || !body.prompt) throw error(400, 'agentId, title, prompt required');
  let html: string;
  try {
    html = await generateArtifactHtml(ctx, { agentId: body.agentId, prompt: body.prompt });
  } catch (e) {
    throw error(502, `generation failed: ${(e as Error).message}`);
  }
  const row = await createArtifactRow(ctx, {
    agentId: body.agentId, title: body.title, description: body.description ?? '',
    icon: body.icon || 'LayoutDashboard', html,
  });
  return json(artifactRowToDescriptor(row), { status: 201 });
};
```

- [ ] **Step 2: Verify + commit** — `bun run check` 0.
```bash
git add "src/routes/api/artifacts/generate/+server.ts"
git -c commit.gpgsign=false commit -m "feat(builder): POST /api/artifacts/generate (admin, org-scoped)"
```

---

### Task 4: Modal Generate/Paste tabs

**Files:** Modify `src/lib/components/artifacts/ArtifactCreateModal.svelte`, `messages/en.json`, `messages/es.json`.

> Ponytail cut: no "available variables" hint / `flowSchemaByFlow` load / card prop — the builder already has the real schema server-side, so generation binds correctly without it. (Fast-follow if admins struggle to write prompts.)

- [ ] **Step 1: i18n** — both locales: `artifact_gen_tab` ("Generate"/"Generar"), `artifact_paste_tab` ("Paste HTML"/"Pegar HTML"), `artifact_gen_prompt` ("Describe the artifact"/"Describe el artefacto"), `artifact_gen_prompt_ph` ("e.g. a card showing reminders sent vs failed this month"/"p. ej. una tarjeta con recordatorios enviados vs fallidos este mes"), `artifact_gen_submit` ("Generate"/"Generar"), `artifact_gen_loading` ("Generating…"/"Generando…").

- [ ] **Step 2: Modal tabs** — `ArtifactCreateModal.svelte`: add `let mode = $state<'generate' | 'paste'>('generate')` with a 2-button tab switch. **Generate** tab (default): title, icon, description, a `prompt` textarea (placeholder `artifact_gen_prompt_ph`). Submit (disabled unless `title.trim() && prompt.trim()`) → `let generating = $state(false)`; `POST /api/artifacts/generate` `{agentId, title, icon, description, prompt}`; show spinner + `artifact_gen_loading` while `generating`; on 201 → `oncreated()` + close + reset; on error → inline message (the route's reason). **Paste** tab: the existing title/icon/description/html → `POST /api/artifacts` (unchanged). Svelte 5 runes; reuse the icon picker; keep the existing `{ open=$bindable, agentId, oncreated }` props (no new `schema` prop).

- [ ] **Step 3: Validate + verify** — Svelte autofixer on the modal; `bun run i18n:compile && bun run check` 0.

- [ ] **Step 4: Commit**
```bash
git add src/lib/components/artifacts/ArtifactCreateModal.svelte messages/en.json messages/es.json
git -c commit.gpgsign=false commit -m "feat(builder): Generate/Paste tabs in the artifact create modal (prompt → LLM)"
```

---

### Task 5: Full verification

- [ ] **Step 1:** `bun run i18n:compile && bun run check` → 0/0.
- [ ] **Step 2:** `bun run test` → green; `builder-prompt.test.ts` passes; pre-existing `aci-backend` flake (if any) unrelated — confirm no NEW failures.
- [ ] **Step 3: Live smoke (best-effort, needs OPENROUTER_API_KEY + a connected instance)** — as admin, gallery `+` → Generate → title + prompt ("a card showing reminders sent/failed/skipped") → submit → after the spinner, the artifact appears + renders bound to live vars in a window. Generation error path surfaces a message; nothing stored. Paste tab still works. If no key/instance, note deferred.
- [ ] **Step 4:** Commit any fixes.

---

## Self-Review

**Spec coverage:** pure prompt/extract/validate (T1, tested) ✓; `generateArtifactHtml` OpenRouter + schema assembly (T2) ✓; generate API admin/org-scoped + 502 on failure (T3) ✓; Generate/Paste tabs + spinner (T4) ✓; whole-bundle generation w/ reference + light validation + sandbox safety-net (T1/T2) ✓; both modes kept (T4) ✓; model env-configurable (T2) ✓; i18n en/es (T4) ✓. **Ponytail cut:** the "available variables" hint (`flowSchemaByFlow` load + card prop) is dropped — the builder has the schema server-side; fast-follow if needed. Out-of-scope (template injection, async/jobs, builder-as-agent) absent.

**Placeholder scan:** none — complete code/commands. T2 step 1 ("read reminder-compose for exact imports") is a real grounding step (the AI-SDK import path must match), not vague.

**Type consistency:** `buildBuilderPrompt`/`extractHtml`/`validateBundle` (T1) consumed by `builder.ts` (T2). `generateArtifactHtml(ctx,{agentId,prompt})` (T2) consumed by the API (T3). `createArtifactRow`/`artifactRowToDescriptor` (5a) used in T3. `flowVariableSchema`/`flowExportedSpecs`/`getMasterFlow`/`listExportToggles` (5b.1) used in T2 + the loads (T4). `VariableSpec` schema flows load → card → modal (T4). `requireAdmin`/`requireCoreCtx` per real signatures. `env.OPENROUTER_API_KEY`/`ARTIFACT_BUILDER_MODEL` via `$env/dynamic/private`.
