/**
 * Live prompt-contract check: does the real model, given the exact envelope the
 * hub ships, emit valid `minion-ui` blocks for the use-case corpus?
 *
 * Skipped unless LIVE_LLM=1 (needs OPENROUTER_API_KEY in .env). Reports every
 * case and asserts a pass-rate floor rather than per-case determinism.
 *
 *   LIVE_LLM=1 bun run vitest run src/lib/assistant/prompt-contract.live.test.ts
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';

vi.mock('$lib/navigation', () => ({ goto: vi.fn(async () => {}) }));
vi.mock('$lib/access/can.svelte', () => ({ canViewPath: () => true }));
vi.mock('./guide.svelte', () => ({ askChoice: vi.fn(), startGuide: vi.fn() }));

import { registerGlobalTools } from './global-tools';
import { getTools } from './model-context';
import { uiToolsBriefing } from './briefing';
import { allPages, resolvePath } from './site-map';
import { FORM_CATALOG } from './catalog';
import { parseUiBlocks } from './ui-blocks';
import { USE_CASES, type UseCase } from './use-cases';

const LIVE = process.env.LIVE_LLM === '1';
const MODEL = process.env.LIVE_LLM_MODEL || 'anthropic/claude-sonnet-5';

function apiKey(): string {
  for (const f of ['.env.local', '.env']) {
    try {
      const m = readFileSync(f, 'utf8').match(/^OPENROUTER_API_KEY=(.+)$/m);
      if (m?.[1]) return m[1].trim().replace(/^"|"$/g, '');
    } catch {
      /* next */
    }
  }
  return process.env.OPENROUTER_API_KEY ?? '';
}

function envelope(): string {
  registerGlobalTools();
  return [
    '[In-app assistant context — the user is in the Minion dashboard for FACES Sculptors.',
    'Current page: /overview — Overview dashboard.',
    uiToolsBriefing(getTools(), allPages(), FORM_CATALOG),
    "Keep replies tight. Don't restate this context.]",
  ].join('\n');
}

async function ask(system: string, user: string): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1600,
      temperature: 0,
      messages: [
        { role: 'system', content: 'You are the Minion Hub in-app assistant.' },
        { role: 'user', content: `${system}\n\n${user}` },
      ],
    }),
  });
  const j = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    error?: unknown;
  };
  if (!j.choices?.[0]?.message?.content)
    throw new Error(`no reply: ${JSON.stringify(j.error ?? j).slice(0, 300)}`);
  return j.choices[0].message.content;
}

function judge(c: UseCase, reply: string): { ok: boolean; why: string } {
  const { calls, text } = parseUiBlocks(reply);
  const pages = allPages();
  const navs = calls.filter((x) => x.tool === 'hub.navigate');
  const fills = calls.filter((x) => x.tool.startsWith('fill_'));
  const guides = calls.filter((x) => x.tool === 'ui.guide');
  const choices = calls.filter((x) => x.tool === 'ui.choice');
  const searches = calls.filter((x) => x.tool === 'hub.pages');
  // Every navigate target must be a real, visible page (never an invented path).
  for (const n of navs) {
    const r = resolvePath(String(n.input.path ?? ''), pages);
    if (!r.ok) return { ok: false, why: `invented path ${String(n.input.path)}` };
  }
  const navTo = (p: string) =>
    navs.some(
      (n) =>
        resolvePath(String(n.input.path), pages).ok &&
        resolvePath(String(n.input.path), pages).ok &&
        String(n.input.path).replace(/\/$/, '') === p,
    );
  switch (c.stage) {
    case 'I':
      if (!c.expectPath) return { ok: navs.length === 0, why: 'no page expected' };
      if (navs.length === 0 && choices.length > 0)
        return { ok: true, why: 'asked to disambiguate' };
      return navTo(c.expectPath)
        ? { ok: true, why: 'navigated' }
        : {
            ok: false,
            why: `expected navigate ${c.expectPath}, got ${navs.map((n) => n.input.path).join(',') || 'none'}`,
          };
    case 'II':
      if (c.expectPath && !navTo(c.expectPath))
        return { ok: false, why: `expected navigate ${c.expectPath}` };
      return guides.length > 0 || choices.length > 0
        ? { ok: true, why: guides.length ? 'guided' : 'asked intent' }
        : { ok: false, why: 'no ui.guide / ui.choice' };
    case 'III': {
      if (c.expectPath && !navTo(c.expectPath))
        return { ok: false, why: `expected navigate ${c.expectPath}` };
      const f = fills.find((x) => !c.expectForm || x.tool === `fill_${c.expectForm}`);
      if (f && Object.keys(f.input).length > 0)
        return { ok: true, why: `filled ${Object.keys(f.input).join(',')}` };
      const hasForm = FORM_CATALOG.some((d) => d.route === c.expectPath);
      if (!hasForm && navs.length > 0)
        return { ok: true, why: 'navigated (no fillable form there)' };
      return choices.length > 0 ? { ok: true, why: 'asked intent' } : { ok: false, why: 'no fill' };
    }
    case 'ambiguous':
      if (choices.length > 0) return { ok: true, why: 'asked intent' };
      if (c.expectPath && navTo(c.expectPath)) return { ok: true, why: 'navigated (acceptable)' };
      return {
        ok: !!text && navs.length === 0 && fills.length === 0,
        why: 'plain answer without action',
      };
    case 'nonexistent': {
      const wrong = navs.filter(
        (n) => c.expectSuggestion && String(n.input.path) !== c.expectSuggestion,
      );
      if (wrong.length)
        return {
          ok: false,
          why: `navigated to ${wrong.map((n) => n.input.path).join(',')} for a nonexistent module`,
        };
      if (navs.length === 0 && !c.expectSuggestion) return { ok: true, why: 'no navigation' };
      const admits =
        /(\bno\b|\bnot\b|n'?t\b|closest|nearest|instead|there is no|no existe|no hay|no tenemos|no cuenta|más cercan|en su lugar|no disponible|aún no|todavía no|no está|outside|fuera de)/i.test(
          text,
        );
      return admits || searches.length > 0
        ? { ok: true, why: 'said it does not exist / searched' }
        : { ok: false, why: `did not admit: ${text.slice(0, 120)}` };
    }
  }
}

describe.skipIf(!LIVE)('live prompt contract', () => {
  it('the model emits valid minion-ui blocks for the corpus', async () => {
    const sys = envelope();
    const results: { c: UseCase; ok: boolean; why: string; reply: string }[] = [];
    const queue = [...USE_CASES];
    const worker = async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        try {
          const reply = await ask(sys, c.text);
          results.push({ c, ...judge(c, reply), reply });
        } catch (e) {
          results.push({
            c,
            ok: false,
            why: `error: ${e instanceof Error ? e.message : String(e)}`,
            reply: '',
          });
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    const byStage: Record<string, { ok: number; n: number }> = {};
    for (const r of results) {
      const s = (byStage[r.c.stage] ??= { ok: 0, n: 0 });
      s.n++;
      if (r.ok) s.ok++;
    }
    const lines = results
      .sort((a, b) => a.c.stage.localeCompare(b.c.stage))
      .map(
        (r) =>
          `${r.ok ? 'PASS' : 'FAIL'} [${r.c.stage}/${r.c.lang}] ${r.c.text} → ${r.why}${r.ok ? '' : `\n      reply: ${r.reply.replace(/\s+/g, ' ').slice(0, 300)}`}`,
      );
    const report =
      `model=${MODEL} envelope=${sys.length} chars\n` +
      lines.join('\n') +
      '\n' +
      JSON.stringify(byStage);
    console.log('\n' + report);
    if (process.env.LIVE_LLM_REPORT) writeFileSync(process.env.LIVE_LLM_REPORT, report + '\n');
    const total = results.length;
    const okCount = results.filter((r) => r.ok).length;
    expect(okCount / total).toBeGreaterThanOrEqual(0.85);
  }, 600_000);
});
