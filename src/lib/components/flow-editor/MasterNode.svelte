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
  } from 'lucide-svelte';

  // All lucide icons share one component type; use Zap's as the canonical shape.
  type IconComponent = typeof Zap;

  let { data }: NodeProps & { data: MasterFlowNode } = $props();

  // Visual vocabulary mirrors the editable flow palette so the internal pipeline
  // reads with the same colors/icons users see when they build their own flows.
  // Tailwind class literals are spelled out (not interpolated) so the scanner keeps them.
  type Accent = { ring: string; iconBg: string; iconText: string; handle: string };
  const ACCENT: Record<string, Accent> = {
    amber: { ring: 'border-amber-500/40', iconBg: 'bg-amber-500/20', iconText: 'text-amber-400', handle: '!border-amber-400 !bg-amber-900' },
    slate: { ring: 'border-slate-500/40', iconBg: 'bg-slate-500/20', iconText: 'text-slate-300', handle: '!border-slate-400 !bg-slate-900' },
    violet: { ring: 'border-violet-500/40', iconBg: 'bg-violet-500/20', iconText: 'text-violet-400', handle: '!border-violet-400 !bg-violet-900' },
    pink: { ring: 'border-pink-500/40', iconBg: 'bg-pink-500/20', iconText: 'text-pink-400', handle: '!border-pink-400 !bg-pink-900' },
    teal: { ring: 'border-teal-500/40', iconBg: 'bg-teal-500/20', iconText: 'text-teal-300', handle: '!border-teal-400 !bg-teal-900' },
    indigo: { ring: 'border-indigo-500/40', iconBg: 'bg-indigo-500/20', iconText: 'text-indigo-400', handle: '!border-indigo-400 !bg-indigo-900' },
    emerald: { ring: 'border-emerald-500/40', iconBg: 'bg-emerald-500/20', iconText: 'text-emerald-400', handle: '!border-emerald-400 !bg-emerald-900' },
    sky: { ring: 'border-sky-500/40', iconBg: 'bg-sky-500/20', iconText: 'text-sky-400', handle: '!border-sky-400 !bg-sky-900' },
    cyan: { ring: 'border-cyan-500/40', iconBg: 'bg-cyan-500/20', iconText: 'text-cyan-400', handle: '!border-cyan-400 !bg-cyan-900' },
    rose: { ring: 'border-rose-500/40', iconBg: 'bg-rose-500/20', iconText: 'text-rose-400', handle: '!border-rose-400 !bg-rose-900' },
    fuchsia: { ring: 'border-fuchsia-500/40', iconBg: 'bg-fuchsia-500/20', iconText: 'text-fuchsia-400', handle: '!border-fuchsia-400 !bg-fuchsia-900' },
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
    <p class="text-[10px] text-muted leading-snug">{data.subtitle}</p>
  {/if}

  {#if branches.length > 0}
    <div class="mt-2 pt-1.5 border-t border-border/50 flex flex-col gap-1.5">
      {#each branches as b (b.id)}
        <div class="relative text-[10px] text-muted text-right pr-1">
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
