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
  /** Unified Prompt Tab: enriched from `prompt.sections.preview` breakdown. */
  bytes?: number;
  tokens?: number;
  cacheable?: boolean;
  /** True when an override has disabled this section. */
  disabled?: boolean;
}

/**
 * Phase 3: a single frame from the `prompt.sections.preview.event` stream.
 * `start` is emitted once first (with the total section count); each `section`
 * frame carries one rendered section breakdown row, in assembly order.
 */
export interface PreviewStreamEvent {
  previewId: string;
  kind: 'start' | 'section';
  /** Total number of sections that will be streamed. */
  total: number;
  /** 0-based index of this section (only on `kind: 'section'`). */
  index?: number;
  /** The rendered section breakdown (only on `kind: 'section'`). */
  section?: {
    id: string;
    layer: string;
    order: number;
    source: 'static' | 'file' | 'generated' | 'config' | 'custom' | 'builtin';
    bytes: number;
    tokens: number;
    cacheable: boolean;
    rendered: string;
  };
}

/** How the sections rail groups rows. `pipeline` is the legacy classic view. */
export type GroupMode = 'layer' | 'none' | 'pipeline';

/** How the sections rail sorts rows within a group. */
export type SortMode = 'order' | 'cached' | 'alpha' | 'size';

/** Whole-prompt cacheable ratio (0–1). Uses bytes, falls back to chars. */
export function cachedPct(sections: SectionEntry[]): number {
  let total = 0;
  let cached = 0;
  for (const s of sections) {
    const size = s.bytes ?? s.chars ?? 0;
    total += size;
    if (s.cacheable) cached += size;
  }
  if (total <= 0) return 0;
  return cached / total;
}

/** Pure sort — returns a new array, never mutates the input. */
export function sortSections(list: SectionEntry[], sort: SortMode): SectionEntry[] {
  const copy = [...list];
  switch (sort) {
    case 'order':
      copy.sort((a, b) => a.order - b.order);
      break;
    case 'cached':
      copy.sort((a, b) => {
        const ca = a.cacheable ? 0 : 1;
        const cb = b.cacheable ? 0 : 1;
        if (ca !== cb) return ca - cb;
        return a.order - b.order;
      });
      break;
    case 'alpha':
      copy.sort((a, b) => a.label.localeCompare(b.label));
      break;
    case 'size':
      copy.sort((a, b) => (b.bytes ?? b.chars ?? 0) - (a.bytes ?? a.chars ?? 0));
      break;
  }
  return copy;
}

/** Banded divider label for the Group=None + Sort=Order view. */
export function orderBand(order: number): string {
  if (order < 500) return '0–499';
  if (order < 1000) return '500–999';
  return '1000+';
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

/** Compact size label for tier-1 rows (no unit suffix, tabular). */
export function fmtSize(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
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
