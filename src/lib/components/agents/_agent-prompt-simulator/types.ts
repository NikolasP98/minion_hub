// Shared types + helpers for AgentPromptSimulator sub-components.
// Extracted from AgentPromptSimulator.svelte during the DX cleanup
// co-location refactor.

export interface WorkspaceFile {
  name: string;
  path?: string;
  missing: boolean;
  rawChars: number;
  injectedChars: number;
  truncated: boolean;
}

export interface SkillEntry {
  name: string;
  blockChars: number;
}

export interface ToolEntry {
  name: string;
  summaryChars: number;
  schemaChars: number;
  propertiesCount: number;
}

export interface SandboxConfig {
  enabled?: boolean;
  workspaceAccess?: boolean;
  containerDir?: string;
  mode?: string;
  sandboxed?: boolean;
}

export interface SectionEntry {
  id: string;
  layer: string;
  label: string;
  chars: number;
  order: number;
  /** Phase D-0e: rendered text content (gateway-side D-0e #105). May be
   * undefined if the gateway hasn't been updated yet — UI shows a notice. */
  content?: string;
  /** Phase D-0e/f: where this section's content originates. */
  source?: 'static' | 'file' | 'generated' | 'config' | 'custom';
}

export interface SystemPromptReport {
  source?: string;
  generatedAt?: number;
  model?: string;
  provider?: string;
  workspaceDir?: string;
  bootstrapMaxChars?: number;
  bootstrapTotalMaxChars?: number;
  sandbox?: SandboxConfig;
  systemPrompt?: {
    chars: number;
    projectContextChars: number;
    nonProjectContextChars: number;
  };
  injectedWorkspaceFiles?: WorkspaceFile[];
  skills?: {
    promptChars: number;
    entries: SkillEntry[];
  };
  tools?: {
    listChars: number;
    schemaChars: number;
    entries: ToolEntry[];
  };
  sections?: SectionEntry[];
}

export interface BarSegment {
  label: string;
  chars: number;
  color: string;
  layer?: string;
}

export type StepStatus = 'pending' | 'loading' | 'ok' | 'missing';

export interface PipelineStep {
  id: string;
  label: string;
  layer?: string;
  chars?: number;
}

export const SOURCE_META: Record<
  NonNullable<SectionEntry['source']>,
  { label: string; color: string; description: string }
> = {
  static: {
    label: 'Static',
    color: '#6b7280',
    description: 'Hardcoded boilerplate in the gateway section definition.',
  },
  file: {
    label: 'File',
    color: '#06b6d4',
    description: 'Loaded from an agent workspace file (bootstrap or project docs).',
  },
  generated: {
    label: 'Generated',
    color: '#8b5cf6',
    description: 'Produced at request time from runtime state (skills, memory, workspace, time).',
  },
  config: {
    label: 'Config',
    color: '#f59e0b',
    description: 'User-configurable per-agent setting (personality, sandbox, permissions).',
  },
  custom: {
    label: 'Custom',
    color: '#10b981',
    description: 'User-authored YAML section from Phase 19 customisation.',
  },
};

export function fmtChars(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k chars`;
  return `${n} chars`;
}

export function fmtDate(ms?: number): string {
  if (!ms) return '—';
  try {
    return new Date(ms).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return String(ms);
  }
}

export function getContextWindowChars(model: string | undefined): number {
  if (!model) return 800_000;
  const m = model.toLowerCase();
  if (m.includes('claude')) return 800_000;
  if (m.includes('gpt-4o') || m.includes('gpt-4-turbo')) return 512_000;
  if (m.includes('gpt-4')) return 32_768;
  if (m.includes('gpt-3.5-turbo-16k')) return 65_536;
  if (m.includes('gpt-3.5')) return 16_384;
  if (m.includes('gemini-1.5')) return 4_000_000;
  if (m.includes('gemini')) return 400_000;
  return 800_000;
}

export function stepIconFor(status: StepStatus | undefined): string {
  if (!status) return '';
  if (status === 'pending') return '○';
  if (status === 'loading') return '⏳';
  if (status === 'ok') return '✓';
  return '×';
}

export function stepStatusClassFor(status: StepStatus | undefined): string {
  if (status === 'loading') return 'text-accent animate-pulse';
  if (status === 'ok') return 'text-emerald-400';
  if (status === 'missing') return 'text-rose-400';
  if (status === 'pending') return 'text-foreground/30';
  return '';
}
