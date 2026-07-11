/** RBAC permission a tool requires (C1, gateway `ToolMeta.permission`). Absent = no hub permission required. */
export interface ToolPermission {
  module: string;
  action: 'view' | 'create' | 'edit' | 'delete' | 'export' | 'manage';
}

export interface ToolStatusEntry {
  id: string;
  groups: string[];
  requires?: { bins?: string[]; env?: string[] };
  install?: { kind: string; formula?: string; bins?: string[]; label?: string }[];
  optional?: boolean;
  mcpExport?: boolean;
  multi?: boolean;
  condition?: string;
  enabled: boolean;
  /** RBAC permission gate (C7 — optional until the gateway ships WP-1). */
  permission?: ToolPermission;
  /** Registry display meta (emoji + human title) — optional until the gateway ships tools.inspect. */
  display?: { emoji?: string; title?: string };
}

export interface ToolsStatusReport {
  tools: ToolStatusEntry[];
  groups: Record<string, string[]>;
  /** group id → one-line description (C7 — optional until the gateway ships WP-1). */
  groupDescriptions?: Record<string, string>;
  profile: string;
}
