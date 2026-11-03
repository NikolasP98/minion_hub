/**
 * Flow nodes that call a model (spec 043). Mirrors the runner's list in
 * langgraph-server/src/flow/types.ts and compile-flow.ts; a router is AI only in `llm`/`hybrid` mode.
 */
export const AI_NODE_TYPES: ReadonlySet<string> = new Set([
  'agent',
  'llm',
  'structured',
  'toolAgent',
  'memory',
]);

/**
 * Plugin flow actions that call a model. Same two names as the runner's copy (R20).
 * TODO(handoff): move to an `ai` flag on plugin flow-node manifests when a third AI action
 * appears (spec 043 R20, proposals/2026-10-29-hub-org-entitlements-followups.md).
 */
export const AI_PLUGIN_ACTION_METHODS: ReadonlySet<string> = new Set([
  'alertWatcher.classify',
  'alertWatcher.suggest',
]);

/** Is this palette entry an AI node (built-in type, or a plugin action whose method is AI)? */
export function isAiFlowNode(type: string, method?: string): boolean {
  if (type === 'pluginAction') return AI_PLUGIN_ACTION_METHODS.has(method ?? '');
  return AI_NODE_TYPES.has(type);
}
