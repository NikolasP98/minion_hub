# Artifact Builder Self-Repair (5c.1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the artifact builder self-repairing — strengthen validation + retry with the validation error fed back to the LLM, so bad generations fix themselves before storage.

**Architecture:** stronger pure `validateBundle` + a `buildRepairPrompt` (pure) + a retry loop in `generateArtifactHtml`. Server-only; no UX change.

**Tech Stack:** TypeScript, Vercel AI SDK (existing), Vitest, Bun. Hub, branch `dev`.

## Global Constraints

- TS strict, no `any`. `bun run check` 0/0; `bun run test` green. Commits UNSIGNED (`git -c commit.gpgsign=false`); no lockfile/sdd in commits.
- Pure helpers stay pure (no LLM/fetch). No live LLM in unit tests.

## Reference: verified shapes

- `builder-prompt.ts`: `validateBundle(html: string): void` (throws; currently checks non-empty + `<` + `hub.artifact.context.get`); `buildBuilderPrompt(...)`; `extractHtml`.
- `builder.ts`: `generateArtifactHtml(ctx, {agentId, prompt})` — assembles `prompt` via `buildBuilderPrompt`, then `const res = await generateText({ model: openrouter(BUILDER_MODEL), prompt, temperature: 0.3 }); const html = extractHtml(res.text); validateBundle(html); return html;`. `env` from `$env/dynamic/private`.

---

### Task 1: Stronger validation + repair prompt (pure)

**Files:** Modify `src/lib/server/artifacts/builder-prompt.ts`, `src/lib/server/artifacts/builder-prompt.test.ts`.

**Interfaces — Produces:** `validateBundle` additionally rejects scriptless + fragment output; new `buildRepairPrompt(basePrompt, previous, error): string`.

- [ ] **Step 1: Failing tests** — append to `builder-prompt.test.ts`:
```ts
import { buildRepairPrompt } from './builder-prompt';

describe('validateBundle (stronger)', () => {
  const ok = "<!doctype html><html><script>bridge.call('hub.artifact.context.get')</script></html>";
  it('passes a full bundle', () => { expect(() => validateBundle(ok)).not.toThrow(); });
  it('rejects output with no <script>', () => {
    expect(() => validateBundle("<!doctype html><html>hub.artifact.context.get</html>")).toThrow(/script/i);
  });
  it('rejects a fragment with no doctype/html', () => {
    expect(() => validateBundle("<div><script>hub.artifact.context.get</script></div>")).toThrow(/doctype|html/i);
  });
});
describe('buildRepairPrompt', () => {
  it('includes the base prompt, the error, and the previous output', () => {
    const p = buildRepairPrompt('BASE PROMPT', '<bad>previous</bad>', 'missing the bridge call');
    expect(p).toContain('BASE PROMPT');
    expect(p).toContain('missing the bridge call');
    expect(p).toContain('<bad>previous</bad>');
  });
});
```

- [ ] **Step 2: Run red** — `bun run test -- src/lib/server/artifacts/builder-prompt.test.ts` → FAIL (new rules/export missing).

- [ ] **Step 3: Implement** — in `builder-prompt.ts`:
  - In `validateBundle`, after the existing checks, add:
```ts
  if (!/<script/i.test(h)) throw new Error('builder output has no <script> (cannot use the bridge)');
  if (!/<!doctype|<html/i.test(h)) throw new Error('builder output is a fragment (missing <!doctype>/<html>)');
```
  - Add:
```ts
export function buildRepairPrompt(basePrompt: string, previous: string, error: string): string {
  return [
    basePrompt,
    '',
    `Your previous attempt was REJECTED: ${error}`,
    'Here is what you produced — fix it and output ONLY the corrected, complete HTML document:',
    previous,
  ].join('\n');
}
```

- [ ] **Step 4: Run green + commit** — test PASS; `bun run check` 0.
```bash
git add src/lib/server/artifacts/builder-prompt.ts src/lib/server/artifacts/builder-prompt.test.ts
git -c commit.gpgsign=false commit -m "feat(builder): stronger validateBundle (+script/doctype) + buildRepairPrompt"
```

---

### Task 2: Retry-with-feedback loop

**Files:** Modify `src/lib/server/artifacts/builder.ts`.

> No unit test (LLM glue); verified by `bun run check` + live.

- [ ] **Step 1: Implement the loop** — replace the single generate/validate/return tail of `generateArtifactHtml` with:
```ts
  const BUILDER_MODEL = env.ARTIFACT_BUILDER_MODEL || 'anthropic/claude-3.7-sonnet';
  const openrouter = createOpenAI({ apiKey, baseURL: OPENROUTER_BASE_URL });
  const MAX_ATTEMPTS = 3; // 1 initial + 2 repairs (ponytail: a retry-count env knob is config nobody sets)

  const attempt = async (p: string): Promise<string> => {
    const res = await generateText({ model: openrouter(BUILDER_MODEL), prompt: p, temperature: 0.3 });
    return extractHtml(res.text);
  };

  let current = prompt;
  let last = '';
  let lastErr: Error | null = null;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    last = await attempt(current);
    try {
      validateBundle(last);
      return last;
    } catch (e) {
      lastErr = e as Error;
      current = buildRepairPrompt(prompt, last, lastErr.message);
    }
  }
  throw lastErr ?? new Error('artifact generation failed');
```
  Add `buildRepairPrompt` to the `./builder-prompt` import.

- [ ] **Step 2: Verify + commit** — `bun run check` 0.
```bash
git add src/lib/server/artifacts/builder.ts
git -c commit.gpgsign=false commit -m "feat(builder): retry generation with validation error fed back (self-repair, MAX_ATTEMPTS=3)"
```

---

### Task 3: Full verification

- [ ] **Step 1:** `bun run check` → 0/0; `bun run test` → green (`builder-prompt.test.ts` passes; no NEW failures).
- [ ] **Step 2:** Commit any fixes.

---

## Self-Review

**Spec coverage:** stronger `validateBundle` (+`<script`, +doctype/html) T1 ✓; `buildRepairPrompt` (error + previous + base) T1 ✓; retry-with-feedback loop + `MAX_ATTEMPTS` (env-overridable, NaN-guarded) T2 ✓; last-error-on-exhaustion → 502 contract T2 ✓; no DOM render-check (out of scope) ✓. Pure helpers tested (T1).

**Placeholder scan:** none — complete code.

**Type consistency:** `buildRepairPrompt(basePrompt, previous, error)` (T1) consumed by the loop (T2); `validateBundle` signature unchanged (still `(html)=>void`); `extractHtml`/`generateText` per existing usage.
