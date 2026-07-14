<script lang="ts">
  import { Button, Select } from '$lib/components/ui';
import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { AgentNodeData } from '$lib/state/features/flow-editor.svelte';
  import { flowEditorState, setNodes } from '$lib/state/features/flow-editor.svelte';
  import { gw } from '$lib/state/gateway/gateway-data.svelte';
  import { builderState } from '$lib/state/builder';
  import { agentDisplayName } from '$lib/utils/agent-display';
  import { sendRequest } from '$lib/services/gateway.svelte';
  import { Bot } from 'lucide-svelte';
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';

  let { data, id, selected }: NodeProps & { data: AgentNodeData } = $props();

  let showSettings = $state(false);
  let hovered = $state(false);
  const showHandles = $derived(flowEditorState.relationshipMode || selected || hovered);

  type Kind = 'custom' | 'personal' | 'drone';
  interface InstanceOption { id: string; label: string }

  let personalAgents = $state<InstanceOption[]>([]);
  let drones = $state<InstanceOption[]>([]);
  let loadedPersonal = $state(false);
  let loadedDrones = $state(false);

  const customOptions = $derived<InstanceOption[]>([
    ...gw.agents.map((a) => ({ id: a.id, label: agentDisplayName(a) })),
    ...builderState.agents.map((a) => ({ id: `built:${a.id}`, label: a.name })),
  ]);

  const instanceOptions = $derived<InstanceOption[]>(
    data.agentKind === 'custom'
      ? customOptions
      : data.agentKind === 'personal'
        ? personalAgents
        : data.agentKind === 'drone'
          ? drones
          : [],
  );

  async function loadPersonal() {
    if (loadedPersonal) return;
    loadedPersonal = true;
    try {
      const res = await fetch('/api/personal-agents?scope=org');
      if (res.ok) {
        const body = (await res.json()) as { personalAgents?: Array<{ agentId: string; userName: string }> };
        personalAgents = (body.personalAgents ?? []).map((p) => ({ id: p.agentId, label: p.userName }));
      }
    } catch {
      personalAgents = [];
    }
  }

  async function loadDrones() {
    if (loadedDrones) return;
    loadedDrones = true;
    try {
      const res = (await sendRequest('drones.list', {})) as { drones?: Array<{ id: string; description: string }> } | null;
      drones = (res?.drones ?? []).map((d) => ({ id: d.id, label: d.description || d.id }));
    } catch {
      drones = [];
    }
  }

  onMount(() => {
    if (data.agentKind === 'personal') loadPersonal();
    if (data.agentKind === 'drone') loadDrones();
  });

  function isHandleConnected(handleId: string): boolean {
    return flowEditorState.edges.some(
      (e) =>
        (e.source === id && e.sourceHandle === handleId) ||
        (e.target === id && e.targetHandle === handleId),
    );
  }

  function patch(partial: Partial<AgentNodeData>) {
    const next = flowEditorState.nodes.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, ...partial } } : n,
    );
    setNodes(next);
  }

  function pickKind(value: string | number) {
    const agentKind = String(value) as Kind;
    patch({ agentKind, agentId: '', label: agentKind === 'custom' ? 'Agent' : agentKind });
    if (agentKind === 'personal') loadPersonal();
    if (agentKind === 'drone') loadDrones();
  }

  function pickInstance(value: string | number) {
    const agentId = String(value);
    const label = instanceOptions.find((o) => o.id === agentId)?.label ?? agentId;
    patch({ agentId, label });
  }

  function setSessionMode(mode: 'ephemeral' | 'shared') {
    patch({ sessionMode: mode });
  }
</script>

<!-- Settings panel (shown above node when open) -->
{#if showSettings}
  <div
    class="absolute bottom-full mb-2 left-0 right-0 bg-bg2 border border-border rounded-lg p-3 shadow-xl z-[var(--layer-modal)] min-w-48"
  >
    <div class="text-xs font-semibold text-muted mb-2">{m.flow_defaultValues()}</div>
    {#each Object.entries(data.defaultValues ?? {}) as [key, value] (key)}
      <div class="flex items-center gap-2 mb-1.5">
        <span class="text-xs text-muted w-20 truncate">{key}</span>
        <input
          type="text"
          class="flex-1 text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
          value={value}
          readonly
        />
      </div>
    {/each}
    {#if Object.keys(data.defaultValues ?? {}).length === 0}
      <p class="text-xs text-muted/60 italic">{m.flow_noDefaultValues()}</p>
    {/if}
  </div>
{/if}

<!-- Input handles (left) -->
{#each data.inputHandles ?? [] as handle (handle.id)}
  <Handle
    type="target"
    position={Position.Left}
    id={handle.id}
    class="!w-3 !h-3 !border-2 !border-[color-mix(in_srgb,var(--color-purple)_30%,transparent)] !bg-[color-mix(in_srgb,var(--color-purple)_20%,transparent)] !z-[var(--layer-sticky)] {showHandles || isHandleConnected(handle.id) ? '!opacity-100' : '!opacity-0'} transition-opacity"
  />
{/each}
{#if !data.inputHandles?.length}
  <Handle
    type="target"
    position={Position.Left}
    id="default-in"
    class="!w-3 !h-3 !border-2 !border-[color-mix(in_srgb,var(--color-purple)_30%,transparent)] !bg-[color-mix(in_srgb,var(--color-purple)_20%,transparent)] !z-[var(--layer-sticky)] {showHandles || isHandleConnected('default-in') ? '!opacity-100' : '!opacity-0'} transition-opacity"
  />
{/if}

<!-- Node body -->
<div
  class="relative bg-bg2 border rounded-xl px-4 py-3 min-w-36 max-w-52 shadow-lg cursor-pointer select-none
    {selected ? 'border-accent shadow-accent/20' : 'border-border hover:border-border/80'}"
  role="button"
  tabindex="0"
  onmouseenter={() => (hovered = true)}
  onmouseleave={() => (hovered = false)}
  ondblclick={() => (showSettings = !showSettings)}
  onkeydown={(e) => e.key === 'Enter' && (showSettings = !showSettings)}
  oncontextmenu={(e) => {
    e.preventDefault();
    e.stopPropagation();
    flowEditorState.contextMenu = { open: true, x: e.clientX, y: e.clientY, nodeId: id };
  }}
>
  <div class="flex items-center gap-2 mb-1">
    <div class="w-6 h-6 rounded-md bg-[color-mix(in_srgb,var(--color-purple)_20%,transparent)] flex items-center justify-center shrink-0">
      <Bot size={12} class="text-[var(--color-purple)]" />
    </div>
    <span class="text-xs font-semibold text-foreground truncate">{data.label || data.agentId}</span>
  </div>

  <!-- Type picker -->
  <Select size="sm"
    class="text-[length:var(--font-size-telemetry)] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground"
    fieldClass="mt-1 w-full"
    value={data.agentKind ?? ''}
    onclick={(e: MouseEvent) => e.stopPropagation()}
    onchange={pickKind}
  >
    <option value="" disabled>Select type…</option>
    <option value="custom">Custom agent</option>
    <option value="personal">Personal agent</option>
  </Select>

  <!-- Instance picker (disabled until a type is chosen) -->
  <Select size="sm"
    class="text-[length:var(--font-size-telemetry)] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground disabled:opacity-50"
    fieldClass="mt-1 w-full"
    value={data.agentId}
    disabled={!data.agentKind}
    onclick={(e: MouseEvent) => e.stopPropagation()}
    onchange={pickInstance}
  >
    <option value="" disabled>{data.agentKind ? 'Select…' : 'Pick a type first'}</option>
    {#each instanceOptions as opt (opt.id)}
      <option value={opt.id}>{opt.label}</option>
    {/each}
    {#if data.agentId && !instanceOptions.some((o) => o.id === data.agentId)}
      <option value={data.agentId}>{data.label || data.agentId}</option>
    {/if}
  </Select>

  {#if data.agentKind === 'drone'}
    <p class="mt-1 text-[length:var(--font-size-telemetry)] text-[var(--color-warning-fg)]/80">Legacy drone node — choose a supported agent type</p>
  {/if}

  <!-- Session mode toggle -->
  <div class="mt-1.5 flex gap-1">
    <Button variant="ghost"
      class="flex-1 text-[length:var(--font-size-telemetry)] font-semibold rounded px-1 py-0.5 transition-colors
        {(data.sessionMode ?? 'ephemeral') === 'ephemeral'
          ? 'bg-[color-mix(in_srgb,var(--color-purple)_25%,transparent)] text-[var(--color-purple)] border border-[color-mix(in_srgb,var(--color-purple)_40%,transparent)]'
          : 'text-muted/60 hover:text-muted border border-transparent'}"
      onclick={(e) => { e.stopPropagation(); setSessionMode('ephemeral'); }}
    >
      Ephemeral
    </Button>
    <Button variant="ghost"
      class="flex-1 text-[length:var(--font-size-telemetry)] font-semibold rounded px-1 py-0.5 transition-colors
        {(data.sessionMode ?? 'ephemeral') === 'shared'
          ? 'bg-[var(--color-warning-surface)] text-[var(--color-warning-fg)] border border-[var(--color-warning-border)]'
          : 'text-muted/60 hover:text-muted border border-transparent'}"
      onclick={(e) => { e.stopPropagation(); setSessionMode('shared'); }}
    >
      Shared
    </Button>
  </div>
</div>

<!-- Output handles (right) -->
{#each data.outputHandles ?? [] as handle (handle.id)}
  <Handle
    type="source"
    position={Position.Right}
    id={handle.id}
    class="!w-3 !h-3 !border-2 !border-[var(--color-success-border)] !bg-[var(--color-success-surface)] {showHandles || isHandleConnected(handle.id) ? '!opacity-100' : '!opacity-0'} transition-opacity"
  />
{/each}
{#if !data.outputHandles?.length}
  <Handle
    type="source"
    position={Position.Right}
    id="default-out"
    class="!w-3 !h-3 !border-2 !border-[var(--color-success-border)] !bg-[var(--color-success-surface)] {showHandles || isHandleConnected('default-out') ? '!opacity-100' : '!opacity-0'} transition-opacity"
  />
{/if}

<!-- Context handles (bottom) -->
{#each data.contextHandles ?? [] as handle (handle.id)}
  <Handle
    type="source"
    position={Position.Bottom}
    id={handle.id}
    class="!w-3 !h-3 !border-2 !border-[var(--color-warning-border)] !bg-[var(--color-warning-surface)] {showHandles || isHandleConnected(handle.id) ? '!opacity-100' : '!opacity-0'} transition-opacity"
  />
{/each}
{#if !data.contextHandles?.length}
  <Handle
    type="source"
    position={Position.Bottom}
    id="context-out"
    class="!w-3 !h-3 !border-2 !border-[var(--color-warning-border)] !bg-[var(--color-warning-surface)] {showHandles || isHandleConnected('context-out') ? '!opacity-100' : '!opacity-0'} transition-opacity"
  />
{/if}
