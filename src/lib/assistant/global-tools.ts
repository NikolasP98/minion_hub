/**
 * Tools available on every page: navigation, page search, spotlight guide,
 * intent choice. Registered once from (app)/+layout.
 */
import { goto } from '$lib/navigation';
import { canViewPath } from '$lib/access/can.svelte';
import { executeTool, getTools, registerTools, waitForTool } from './model-context';
import { resolvePath, searchPages, visiblePages } from './site-map';
import { startGuide, type GuideStep } from './guide.svelte';
import { FORM_CATALOG } from './catalog';
import { fillToolName } from './forms';

const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function registerGlobalTools() {
  // Dev-only console hook so browser e2e can drive the registry without the model:
  // __minionAssist.executeTool('hub.navigate', { path: '/stock' }).
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    (window as unknown as { __minionAssist?: unknown }).__minionAssist = {
      executeTool,
      getTools,
      startGuide,
    };
  }
  return registerTools([
    {
      name: 'hub.navigate',
      description:
        'Open a page of the dashboard for the user. `path` is a canonical path from the page list (e.g. /stock/entries); `params` are optional query params (e.g. {"new":"1"} opens the create form on pages that have one). Returns the tools available on the new page.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          params: { type: 'object', additionalProperties: { type: 'string' } },
        },
        required: ['path'],
      },
      execute: async (input) => {
        const pages = visiblePages(canViewPath);
        const r = resolvePath(str(input.path), pages);
        if (!r.ok) {
          return {
            error: r.reason,
            suggestions: r.suggestions.map((p) => ({ path: p.path, title: p.title })),
          };
        }
        const params = (input.params ?? {}) as Record<string, unknown>;
        const qs = new URLSearchParams(
          Object.entries(params)
            .filter(([, v]) => v !== undefined && v !== null && v !== '')
            .map(([k, v]) => [k, String(v)]),
        ).toString();
        await goto(qs ? `${r.path}?${qs}` : r.path);
        const form = FORM_CATALOG.find(
          (f) =>
            f.route === r.path &&
            (!f.open ||
              Object.entries(f.open).every(([k, v]) => params[k] === v || String(params[k]) === v)),
        );
        const formReady = form ? await waitForTool(fillToolName(form.id)) : false;
        return {
          ok: true,
          path: r.path,
          form: form ? { id: form.id, tool: fillToolName(form.id), mounted: formReady } : null,
        };
      },
      annotations: { readOnlyHint: false },
    },
    {
      name: 'hub.pages',
      description:
        'Search the pages this user can open. Use when the user asks where something is and the page list in context is not enough, or when a module name is unknown/ambiguous.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
      execute: (input) => {
        const pages = visiblePages(canViewPath);
        const hits = searchPages(str(input.query), pages).slice(0, 8);
        return hits.length
          ? {
              pages: hits.map((p) => ({
                path: p.path,
                title: p.title,
                description: p.description,
              })),
            }
          : {
              pages: [],
              note: 'No page matches. The feature may not exist in this dashboard — say so to the user.',
            };
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: 'ui.guide',
      description:
        'Show an interactive step-by-step walkthrough on the current page (use when the user wants to LEARN how to do something). Each step highlights one element (`target` = a data-assist key from the form catalog, e.g. stock_entry.item) with a short instruction written as an ACTION ("Click Add items and pick the product", "Type the quantity you received"). The walkthrough waits for each element to appear and advances when the user interacts with it, so order the steps the way the user will actually do them. Call AFTER hub.navigate to the right page.',
      inputSchema: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: { target: { type: 'string' }, message: { type: 'string' } },
              required: ['target', 'message'],
            },
          },
        },
        required: ['steps'],
      },
      execute: async (input) => {
        const steps = (Array.isArray(input.steps) ? input.steps : []) as GuideStep[];
        // Targets mount with the form; give it a moment after navigation.
        await new Promise((r) => setTimeout(r, 300));
        // A target is valid when it is on screen now OR declared by a catalog form
        // for this route (it appears later in the flow — the guide waits for it).
        const onScreen = new Set(
          [...document.querySelectorAll('[data-assist]')].map((e) => e.getAttribute('data-assist')),
        );
        const path = location.pathname.replace(/^\/(en|es)(?=\/)/, '');
        const declared = new Set(
          FORM_CATALOG.filter((f) => path.startsWith(f.route)).flatMap((f) =>
            (f.guide ?? []).map((g) => g.target),
          ),
        );
        const known = steps.filter((s) => onScreen.has(s.target) || declared.has(s.target));
        const unknownTargets = steps.filter((s) => !known.includes(s)).map((s) => s.target);
        startGuide(known);
        return {
          ok: known.length > 0,
          steps: known.length,
          unknownTargets,
          ...(unknownTargets.length
            ? {
                hint: `Valid targets here: ${[...new Set([...onScreen, ...declared])].filter(Boolean).join(', ')}`,
              }
            : {}),
        };
      },
    },
    {
      name: 'ui.choice',
      description:
        'Ask the user to pick one option with buttons (e.g. "Show me how" vs "Do it for me" when intent is ambiguous). The picked option is sent back as the user\'s next message. Ask ONE question at a time.',
      inputSchema: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              properties: { label: { type: 'string' }, value: { type: 'string' } },
              required: ['label'],
            },
          },
        },
        required: ['question', 'options'],
      },
      // Rendered inline by MarkdownMessage from the reply text itself; nothing to run.
      execute: () => ({ ok: true }),
    },
  ]);
}
