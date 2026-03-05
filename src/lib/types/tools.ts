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
}

export interface ToolsStatusReport {
  tools: ToolStatusEntry[];
  groups: Record<string, string[]>;
  profile: string;
}
