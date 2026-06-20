# Artifact Builder Self-Repair (Subsystem 5c.1)

**Date:** 2026-06-20
**Status:** Approved design (user selected all 5c increments + "build it") — ready for plan
**Scope:** First of four 5c sub-projects. Make `generateArtifactHtml` (5b.2) **self-repairing**:
strengthen validation modestly and **retry with the validation error fed back to the
LLM** so a malformed generation fixes itself before storage. Server-only; no UX change.

> 5c decomposition (build order): **5c.1 self-repair** → 5c.2 regenerate/iterate + versions → 5c.3 async + progress → 5c.4 builder-as-agent card.

## Context (verified)

- `src/lib/server/artifacts/builder.ts` `generateArtifactHtml(ctx, {agentId, prompt})`: assembles the prompt (`buildBuilderPrompt`), one `generateText` call, `extractHtml`, `validateBundle` (throws), returns html. A single failed generation → throws → the route returns 502 (nothing stored).
- `src/lib/server/artifacts/builder-prompt.ts` (pure, tested): `buildBuilderPrompt`, `extractHtml`, `validateBundle(html)` — currently requires non-empty + `<` + `hub.artifact.context.get`.
- The bundle runs in the sandboxed iframe; runtime safety is not the concern here — **structural validity + "does it use the bridge / look like a real artifact"** is.

## Decisions

1. **Retry-with-feedback, not DOM render-check.** A real headless render is unreliable server-side (the bundle expects a live bridge). Instead: on `validateBundle` failure, re-call the model with a **repair instruction** embedding the validation error + the previous (bad) output, up to `MAX_ATTEMPTS` total. Cheap, model-agnostic, and directly fixes the common failures (fenced/truncated output, missing bridge call).
2. **Modestly stronger validation** (still pure, still cheap): in addition to the current checks, require the output to contain a `<script` (an artifact with no JS can't use the bridge) and either `<!doctype` or `<html` (a real document, not a fragment). No DOM, no parsing.
3. **Attempts:** `MAX_ATTEMPTS = 3` (1 initial + 2 repairs), a plain const (ponytail: a retry-count env knob is config nobody sets). Temperature unchanged (0.3).
4. **Failure:** if all attempts fail validation, throw the **last** validation error (→ 502, nothing stored) — same contract as today, just after retries.

## Architecture

### `builder-prompt.ts` (pure, tested)
- Strengthen `validateBundle(html)`: keep current throws; add `if (!/<script/i.test(h)) throw …` and `if (!/<!doctype|<html/i.test(h)) throw …`. Clear messages (each becomes the repair feedback).
- Add `buildRepairPrompt(basePrompt: string, previous: string, error: string): string` — the original prompt + a clearly-delimited "Your previous attempt was rejected: {error}. Here is what you produced (fix it, output only the corrected full HTML):\n{previous}" block.

### `builder.ts`
- Extract the single attempt into an inner function `attempt(prompt)`: `generateText` → `extractHtml` → return raw html (no validate). Loop:
  ```
  let prompt = basePrompt; let last = ''; let lastErr: Error | null = null;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    last = await attempt(prompt);
    try { validateBundle(last); return last; }
    catch (e) { lastErr = e as Error; prompt = buildRepairPrompt(basePrompt, last, lastErr.message); }
  }
  throw lastErr ?? new Error('artifact generation failed');
  ```
- `MAX_ATTEMPTS = Number(env.ARTIFACT_BUILDER_MAX_ATTEMPTS) || 3` (guard NaN/≤0 → 3).
- Everything else (schema assembly, model, key guard) unchanged.

## Components & files

| File | Change |
|---|---|
| `src/lib/server/artifacts/builder-prompt.ts` | EDIT — stronger `validateBundle` (+`<script`, +doctype/html); add `buildRepairPrompt` |
| `src/lib/server/artifacts/builder-prompt.test.ts` | EDIT — tests for the 2 new validate rules + `buildRepairPrompt` includes error + previous |
| `src/lib/server/artifacts/builder.ts` | EDIT — retry-with-feedback loop (`MAX_ATTEMPTS`) |

## Out of scope (later 5c)

- Headless/DOM render validation. Regenerate/versions (5c.2), async/progress (5c.3), builder-as-agent (5c.4).

## Testing

- `builder-prompt.ts` pure: `validateBundle` rejects no-`<script` and fragment-without-doctype; passes a full bundle. `buildRepairPrompt` contains the error + the previous output + the base prompt. (vitest)
- `builder.ts` loop: covered by `bun run check` + live (a deliberately-weak first generation self-corrects). No live LLM in unit tests.

## Success criteria

- A generation that first returns invalid output (e.g. missing the bridge call) is **re-prompted with the error and retried**; a valid bundle on a later attempt is returned + stored.
- After `MAX_ATTEMPTS` failures, a clear 502 (nothing stored) — unchanged contract.
- `validateBundle` rejects scriptless / fragment output. `bun run check` clean; pure unit tests pass.
