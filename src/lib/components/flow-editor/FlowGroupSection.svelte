<script lang="ts">
  import { Button } from '$lib/components/ui';
import { goto } from '$lib/navigation';
  import { GitBranch, Plus, Trash2, Clock, Puzzle, Lock, Pencil, ChevronDown, ChevronRight } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import NewFromTemplateMenu from './NewFromTemplateMenu.svelte';

  type FlowMeta = { id: string; name: string; nodeCount: number; updatedAt: number; pluginId?: string | null; groupId?: string | null };
  type Template = { id: string; name: string; nodes: unknown[]; edges: unknown[] };

  let {
    title,
    kind, // 'my' | 'user' | 'plugin'
    pluginId = null,
    groupId = null,
    disabled = false,
    flows,
    templates = [],
    onNewBlank,
    onDeleteFlow,
    onRenameGroup,
    onDeleteGroup,
    onChanged,
  }: {
    title: string;
    kind: 'my' | 'user' | 'plugin';
    pluginId?: string | null;
    groupId?: string | null;
    disabled?: boolean;
    flows: FlowMeta[];
    templates?: Template[];
    onNewBlank?: () => void;
    onDeleteFlow?: (flow: FlowMeta) => void;
    onRenameGroup?: () => void;
    onDeleteGroup?: () => void;
    onChanged?: () => void;
  } = $props();

  let collapsed = $state(false);

  function formatDate(ts: number) {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
</script>

<section class="mb-6 {disabled ? 'opacity-50' : ''}">
  <header class="flex items-center justify-between mb-2">
    <Button variant="ghost" type="button" class="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-muted hover:text-foreground" onclick={() => (collapsed = !collapsed)}>
      {#if collapsed}<ChevronRight size={12} />{:else}<ChevronDown size={12} />{/if}
      {#if kind === 'plugin'}<Puzzle size={12} class="text-accent" />{/if}
      <span class="text-foreground">{title}</span>
      {#if kind === 'plugin'}<Lock size={11} class="text-muted/50" />{/if}
      {#if disabled}<span class="px-1.5 py-0.5 rounded-full bg-bg3 text-muted text-[length:var(--font-size-telemetry)]">disabled</span>{/if}
      <span class="text-muted/50">({flows.length})</span>
    </Button>
    <div class="flex items-center gap-1">
      {#if kind === 'plugin' && groupId}
        <NewFromTemplateMenu pluginId={pluginId ?? ''} groupId={groupId ?? ''} {templates} {disabled} onCreated={onChanged} />
      {:else if onNewBlank}
        <Button variant="ghost" type="button" onclick={onNewBlank} class="flex items-center gap-1 h-7 px-2.5 text-[length:var(--font-size-telemetry)] font-mono uppercase tracking-wider rounded border border-border text-muted hover:bg-bg3 hover:text-foreground transition-colors">
          <Plus size={12} /> {m.flow_newFlow()}
        </Button>
      {/if}
      {#if kind === 'user'}
        <Button variant="ghost" type="button" onclick={onRenameGroup} class="p-1.5 rounded text-muted hover:text-foreground hover:bg-bg3" title="Rename group" aria-label="Rename group"><Pencil size={13} /></Button>
        <Button variant="ghost" type="button" onclick={onDeleteGroup} class="p-1.5 rounded text-muted hover:text-[var(--color-danger-fg)] hover:bg-bg3" title="Delete group" aria-label="Delete group"><Trash2 size={13} /></Button>
      {/if}
    </div>
  </header>

  {#if !collapsed}
    {#if flows.length === 0}
      <p class="text-muted/60 text-xs font-mono italic px-1 py-3">— empty —</p>
    {:else}
      <div class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
        {#each flows as flow (flow.id)}
          <div
            role="button" tabindex="0"
            onclick={() => goto(`/flow-editor/${flow.id}`)}
            onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && goto(`/flow-editor/${flow.id}`)}
            class="group rounded-xl border bg-bg2 overflow-hidden cursor-pointer transition-all shadow-sm hover:shadow-md {flow.pluginId ? 'border-accent/40 ring-1 ring-accent/20 hover:border-accent/60' : 'border-border hover:border-accent/50'}"
          >
            <div class="aspect-video bg-bg3/50 flex items-center justify-center relative {flow.pluginId ? 'bg-gradient-to-br from-accent/[0.06] to-transparent' : ''}">
              <GitBranch size={32} class="text-muted/20 group-hover:text-muted/30 transition-colors" />
              {#if flow.pluginId}
                <div class="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-accent/15 text-accent text-[length:var(--font-size-telemetry)] font-mono uppercase tracking-wider ring-1 ring-accent/20" title={m.flow_pluginManaged({ plugin: flow.pluginId })}>
                  <Puzzle size={9} /> {flow.pluginId}
                </div>
              {/if}
              <div class="absolute bottom-2 right-2 text-[length:var(--font-size-telemetry)] font-mono text-muted/50">
                {flow.nodeCount === 1 ? m.flow_nodeCount({ count: flow.nodeCount }) : m.flow_nodeCountPlural({ count: flow.nodeCount })}
              </div>
            </div>
            <div class="px-4 py-3 flex items-center justify-between">
              <div class="min-w-0">
                <div class="text-sm font-semibold text-foreground truncate">{flow.name}</div>
                <div class="flex items-center gap-1 text-[length:var(--font-size-telemetry)] text-muted mt-0.5"><Clock size={10} /> {formatDate(flow.updatedAt)}</div>
              </div>
              <Button variant="ghost" onclick={(e) => { e.stopPropagation(); onDeleteFlow?.(flow); }} class="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded text-muted hover:text-[var(--color-danger-fg)] hover:bg-bg3" title={m.flow_deleteFlow()} aria-label={m.flow_deleteFlow()}>
                <Trash2 size={14} />
              </Button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</section>
