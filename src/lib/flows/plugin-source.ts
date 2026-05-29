/**
 * Plugin-imported flows carry their origin in the flow row's `config` JSON:
 *   { source: { pluginId, templateId } }
 * set once at import time (see api/flows/sync). It is never overwritten by the
 * editor save (which only writes name/nodes/edges/active), so it durably marks
 * a flow as "managed by a plugin" — used to block deletion and show the pill.
 *
 * Pure + isomorphic (server + client). Accepts the raw JSON string (DB row) or
 * an already-parsed object (API response).
 */
export type FlowSource = { pluginId: string; templateId?: string };

export function flowSourceFrom(config: string | Record<string, unknown> | null | undefined): FlowSource | null {
  if (!config) return null;
  let obj: Record<string, unknown>;
  if (typeof config === 'string') {
    try {
      obj = JSON.parse(config) as Record<string, unknown>;
    } catch {
      return null;
    }
  } else {
    obj = config;
  }
  const src = obj.source as { pluginId?: unknown; templateId?: unknown } | undefined;
  if (src && typeof src.pluginId === 'string' && src.pluginId.length > 0) {
    return {
      pluginId: src.pluginId,
      templateId: typeof src.templateId === 'string' ? src.templateId : undefined,
    };
  }
  return null;
}

/** Convenience: the owning plugin id, or null if the flow is user-authored. */
export function flowPluginId(config: string | Record<string, unknown> | null | undefined): string | null {
  return flowSourceFrom(config)?.pluginId ?? null;
}
