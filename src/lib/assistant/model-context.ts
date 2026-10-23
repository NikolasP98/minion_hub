import { bindEffectLease, isEffectCurrent, type EffectLease } from './effect-lease';
import type { InvocationCapability } from './accepted-runs';
/**
 * WebMCP-shaped tool registry for the hub assistant.
 *
 * Mirrors the `document.modelContext` contract from the WebMCP proposal
 * (registerTool / getTools / executeTool / `toolchange`) so pages register
 * their capabilities once and both consumers work unchanged:
 *   1. the hub's own assistant chat (today) — reads this registry, ships the
 *      schemas to the server, executes tool calls the model makes in-page;
 *   2. a WebMCP-capable browser agent (tomorrow) — every registration is
 *      forwarded to the native `document.modelContext` when it exists.
 *
 * Tools live in the page, not on the server: navigation, highlighting, form
 * filling all need the running Svelte app. The server only sees schemas.
 */

export type JsonSchema = Record<string, unknown>;

export interface ModelContextTool<I = Record<string, unknown>> {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /** Returns a string result (WebMCP contract). Objects are JSON-stringified. */
  execute: (
    input: I,
    ctx: { signal: AbortSignal; capability?: InvocationCapability },
  ) => Promise<string | object | void> | string | object | void;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
}

export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: ModelContextTool['annotations'];
}

type NativeModelContext = {
  registerTool: (tool: unknown, opts?: { signal?: AbortSignal }) => unknown;
};

const registry = new Map<string, ModelContextTool>();
const listeners = new Set<() => void>();

function native(): NativeModelContext | undefined {
  if (typeof document === 'undefined') return undefined;
  return (document as unknown as { modelContext?: NativeModelContext }).modelContext;
}

function emit() {
  for (const l of listeners) l();
}

/** Register one tool. Aborting `signal` unregisters it (WebMCP semantics). */
export function registerTool(tool: ModelContextTool, opts: { signal?: AbortSignal } = {}) {
  if (opts.signal?.aborted) return () => {};
  registry.set(tool.name, tool as ModelContextTool);
  try {
    native()?.registerTool(
      {
        ...tool,
        execute: async (input: Record<string, unknown>, ctx: { signal: AbortSignal }) =>
          toResultString(await tool.execute(input, ctx)),
      },
      opts,
    );
  } catch {
    // Native API is optional; the in-page registry is the source of truth.
  }
  const off = () => {
    if (registry.get(tool.name) === tool) {
      registry.delete(tool.name);
      emit();
    }
  };
  opts.signal?.addEventListener('abort', off, { once: true });
  if (opts.signal?.aborted) off();
  else emit();
  return off;
}

/**
 * Register a set of tools for a component's lifetime. Use inside `$effect` /
 * `onMount` and return the disposer.
 */
export function registerTools(tools: ModelContextTool[]) {
  const ac = new AbortController();
  for (const t of tools) registerTool(t, { signal: ac.signal });
  return () => ac.abort();
}

export function getTools(): ToolDescriptor[] {
  return [...registry.values()]
    .map(({ name, description, inputSchema, annotations }) => ({
      name,
      description,
      inputSchema,
      annotations,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Declared read-only (WebMCP `readOnlyHint`): its result is information the model asked for. */
export function isReadOnly(name: string) {
  return registry.get(name)?.annotations?.readOnlyHint === true;
}

export function hasTool(name: string) {
  return registry.has(name);
}

export function toolRegistration(name: string): object | undefined {
  return registry.get(name);
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  opts: { signal?: AbortSignal; capability?: InvocationCapability; lease?: EffectLease } = {},
): Promise<string> {
  const tool = registry.get(name);
  if (!tool) return JSON.stringify({ error: `tool "${name}" is not available on this page` });
  const signal = opts.signal ?? new AbortController().signal;
  if (signal.aborted || !isEffectCurrent(opts.lease)) return JSON.stringify({ error: 'canceled' });
  try {
    const context = bindEffectLease({ signal, capability: opts.capability }, () =>
      isEffectCurrent(opts.lease),
    );
    return toResultString(await tool.execute(input, context));
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
  }
}

/** Subscribe to registry changes (WebMCP `toolchange`). Returns unsubscribe. */
export function onToolChange(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function toResultString(r: unknown): string {
  if (r === undefined || r === null) return JSON.stringify({ ok: true });
  return typeof r === 'string' ? r : JSON.stringify(r);
}

/** Resolve after `name` registers (a form mounting after navigation) or the timeout. */
export function waitForTool(name: string, ms = 6000, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  if (hasTool(name)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (found: boolean) => {
      off();
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve(found);
    };
    const abort = () => finish(false);
    const off = onToolChange(() => {
      if (hasTool(name)) finish(true);
    });
    const timer = setTimeout(() => finish(false), ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
