<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { MasterFlowNode, MasterNodeKind } from '$lib/flows/master-flows';
  import {
    Zap,
    Clock,
    ShieldCheck,
    Webhook,
    SmilePlus,
    KeyRound,
    Cog,
    Split,
    Bot,
    Cpu,
    Wrench,
    BookOpen,
    Send,
    Headset,
    Brain,
    Flag,
    CopyCheck,
    Hand,
    ShieldAlert,
    Mic,
    RadioTower,
    Terminal,
    ListChecks,
    GitMerge,
    Inbox,
    Workflow,
    Database,
    FileOutput,
    Puzzle,
    Braces,
    Replace,
  } from 'lucide-svelte';

  // All lucide icons share one component type; use Zap's as the canonical shape.
  type IconComponent = typeof Zap;

  let { data }: NodeProps & { data: MasterFlowNode } = $props();

  // Visual vocabulary mirrors the editable flow palette so the internal pipeline
  // reads with the same colors/icons users see when they build their own flows.
  // Tailwind class literals are spelled out (not interpolated) so the scanner keeps them.
  type Accent = { ring: string; iconBg: string; iconText: string; handle: string };
  const ACCENT: Record<string, Accent> = {
    amber: { ring: 'border-[var(--color-warning-border)]', iconBg: 'bg-[var(--color-warning-surface)]', iconText: 'text-[var(--color-warning-fg)]', handle: '!border-[var(--color-warning-border)] !bg-[var(--color-warning-surface)]' },
    slate: { ring: 'border-[var(--color-border-default)]', iconBg: 'bg-[var(--color-surface-2)]', iconText: 'text-[var(--color-text-tertiary)]', handle: '!border-[var(--color-border-default)] !bg-[var(--color-surface-2)]' },
    violet: { ring: 'border-[color-mix(in_srgb,var(--color-purple)_40%,transparent)]', iconBg: 'bg-[color-mix(in_srgb,var(--color-purple)_20%,transparent)]', iconText: 'text-[var(--color-purple)]', handle: '!border-[color-mix(in_srgb,var(--color-purple)_30%,transparent)] !bg-[color-mix(in_srgb,var(--color-purple)_20%,transparent)]' },
    pink: { ring: 'border-[color-mix(in_srgb,var(--color-pink)_40%,transparent)]', iconBg: 'bg-[color-mix(in_srgb,var(--color-pink)_20%,transparent)]', iconText: 'text-[var(--color-pink)]', handle: '!border-[color-mix(in_srgb,var(--color-pink)_30%,transparent)] !bg-[color-mix(in_srgb,var(--color-pink)_20%,transparent)]' },
    teal: { ring: 'border-[color-mix(in_srgb,var(--color-cyan)_40%,transparent)]', iconBg: 'bg-[color-mix(in_srgb,var(--color-cyan)_20%,transparent)]', iconText: 'text-[var(--color-cyan)]', handle: '!border-[color-mix(in_srgb,var(--color-cyan)_30%,transparent)] !bg-[color-mix(in_srgb,var(--color-cyan)_20%,transparent)]' },
    indigo: { ring: 'border-[color-mix(in_srgb,var(--color-purple)_40%,transparent)]', iconBg: 'bg-[color-mix(in_srgb,var(--color-purple)_20%,transparent)]', iconText: 'text-[var(--color-purple)]', handle: '!border-[color-mix(in_srgb,var(--color-purple)_30%,transparent)] !bg-[color-mix(in_srgb,var(--color-purple)_20%,transparent)]' },
    emerald: { ring: 'border-[var(--color-success-border)]', iconBg: 'bg-[var(--color-success-fg)]/20', iconText: 'text-[var(--color-success-fg)]', handle: '!border-[var(--color-success-border)] !bg-[var(--color-success-surface)]' },
    sky: { ring: 'border-[color-mix(in_srgb,var(--color-cyan)_40%,transparent)]', iconBg: 'bg-[color-mix(in_srgb,var(--color-cyan)_20%,transparent)]', iconText: 'text-[var(--color-cyan)]', handle: '!border-[color-mix(in_srgb,var(--color-cyan)_30%,transparent)] !bg-[color-mix(in_srgb,var(--color-cyan)_20%,transparent)]' },
    cyan: { ring: 'border-[color-mix(in_srgb,var(--color-cyan)_40%,transparent)]', iconBg: 'bg-[color-mix(in_srgb,var(--color-cyan)_20%,transparent)]', iconText: 'text-[var(--color-cyan)]', handle: '!border-[color-mix(in_srgb,var(--color-cyan)_30%,transparent)] !bg-[color-mix(in_srgb,var(--color-cyan)_20%,transparent)]' },
    rose: { ring: 'border-[var(--color-danger-border)]', iconBg: 'bg-[var(--color-danger-surface)]', iconText: 'text-[var(--color-danger-fg)]', handle: '!border-[var(--color-danger-border)] !bg-[var(--color-danger-surface)]' },
    fuchsia: { ring: 'border-[color-mix(in_srgb,var(--color-pink)_40%,transparent)]', iconBg: 'bg-[color-mix(in_srgb,var(--color-pink)_20%,transparent)]', iconText: 'text-[var(--color-pink)]', handle: '!border-[color-mix(in_srgb,var(--color-pink)_30%,transparent)] !bg-[color-mix(in_srgb,var(--color-pink)_20%,transparent)]' },
  };

  const KIND: Record<MasterNodeKind, { icon: IconComponent; accent: keyof typeof ACCENT }> = {
    trigger: { icon: Zap, accent: 'amber' },
    schedule: { icon: Clock, accent: 'amber' },
    guard: { icon: ShieldCheck, accent: 'slate' },
    hook: { icon: Webhook, accent: 'violet' },
    reaction: { icon: SmilePlus, accent: 'pink' },
    session: { icon: KeyRound, accent: 'teal' },
    process: { icon: Cog, accent: 'slate' },
    router: { icon: Split, accent: 'amber' },
    agent: { icon: Bot, accent: 'indigo' },
    llm: { icon: Cpu, accent: 'violet' },
    tool: { icon: Wrench, accent: 'emerald' },
    skill: { icon: BookOpen, accent: 'sky' },
    channel: { icon: Send, accent: 'cyan' },
    handoff: { icon: Headset, accent: 'rose' },
    memory: { icon: Brain, accent: 'fuchsia' },
    end: { icon: Flag, accent: 'slate' },
    // Custom placeholder kinds — added to faithfully document gateway internals
    // that the base palette can't express (read-only master flows only).
    dedupe: { icon: CopyCheck, accent: 'slate' },
    intercept: { icon: Hand, accent: 'amber' },
    guardrail: { icon: ShieldAlert, accent: 'rose' },
    voice: { icon: Mic, accent: 'violet' },
    broadcast: { icon: RadioTower, accent: 'fuchsia' },
    directive: { icon: Terminal, accent: 'indigo' },
    preflight: { icon: ListChecks, accent: 'amber' },
    coalesce: { icon: GitMerge, accent: 'violet' },
    buffer: { icon: Inbox, accent: 'teal' },
    subflow: { icon: Workflow, accent: 'fuchsia' },
    database: { icon: Database, accent: 'teal' },
    'file-write': { icon: FileOutput, accent: 'amber' },
    'plugin-action': { icon: Puzzle, accent: 'violet' },
    structured: { icon: Braces, accent: 'indigo' },
    transform: { icon: Replace, accent: 'slate' },
    'tool-agent': { icon: Bot, accent: 'sky' },
  };

  const spec = $derived(KIND[data.kind] ?? KIND.process);
  const accent = $derived(ACCENT[spec.accent]);
  const Icon = $derived(spec.icon);
  const branches = $derived(data.branches ?? []);
  const isEntry = $derived(data.kind === 'trigger' || data.kind === 'schedule');
  const isEnd = $derived(data.kind === 'end');
</script>

<!-- Inbound handle: every node except a pure entry takes input on the left. -->
{#if !isEntry}
  <Handle type="target" position={Position.Left} id="in" class="!w-2.5 !h-2.5 !border-2 {accent.handle}" />
{/if}

<div
  class="relative bg-bg2 border rounded-xl px-3.5 py-2.5 min-w-44 max-w-56 shadow-lg select-none {accent.ring} {isEnd ? 'opacity-90' : ''}"
>
  <div class="flex items-center gap-2 {data.subtitle ? 'mb-1' : ''}">
    <div class="w-6 h-6 rounded-md {accent.iconBg} flex items-center justify-center shrink-0">
      <Icon size={12} class={accent.iconText} />
    </div>
    <span class="text-xs font-semibold text-foreground leading-tight flex-1">{data.title}</span>
  </div>
  {#if data.subtitle}
    <p class="text-[length:var(--font-size-telemetry)] text-muted leading-snug">{data.subtitle}</p>
  {/if}

  {#if branches.length > 0}
    <div class="mt-2 pt-1.5 border-t border-border/50 flex flex-col gap-1.5">
      {#each branches as b (b.id)}
        <div class="relative text-[length:var(--font-size-telemetry)] text-muted text-right pr-1">
          {b.label}
          <Handle
            type="source"
            position={Position.Right}
            id={b.id}
            style="top: 50%; right: -19px;"
            class="!w-2.5 !h-2.5 !border-2 {accent.handle}"
          />
        </div>
      {/each}
    </div>
  {:else if !isEnd}
    <Handle type="source" position={Position.Right} id="out" class="!w-2.5 !h-2.5 !border-2 {accent.handle}" />
  {/if}
</div>
