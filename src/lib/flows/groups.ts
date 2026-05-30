/** Client+server pure helpers for flow groups. */
export type FlowGroupMeta = {
  id: string;
  name: string;
  /** Owning plugin id when plugin-managed; null for user groups. */
  pluginId: string | null;
  /** True ⇒ owning plugin disabled → render dimmed. */
  disabled: boolean;
  createdAt: number;
};

export function isPluginGroup(group: Pick<FlowGroupMeta, 'pluginId'>): boolean {
  return typeof group.pluginId === 'string' && group.pluginId.length > 0;
}

/** User groups first (by createdAt asc), then plugin groups (by createdAt asc). */
export function sortGroups<T extends FlowGroupMeta>(groups: T[]): T[] {
  return [...groups].sort((a, b) => {
    const ap = isPluginGroup(a) ? 1 : 0;
    const bp = isPluginGroup(b) ? 1 : 0;
    if (ap !== bp) return ap - bp;
    return a.createdAt - b.createdAt;
  });
}
