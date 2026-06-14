<script lang="ts">
  import {
    flowEditorState,
    descriptorForNode,
    updateNodeConfig,
    closeNodeConfig,
  } from '$lib/state/features/flow-editor.svelte';
  import * as m from '$lib/paraglide/messages';
  import type { DestinationListValue, BranchConfig } from '$lib/state/features/flow-editor.svelte';
  import { X, Settings2 } from 'lucide-svelte';
  import ChannelNodeConfig from './ChannelNodeConfig.svelte';
  import HandoffNodeConfig from './HandoffNodeConfig.svelte';
  import ReactionNodeConfig from './ReactionNodeConfig.svelte';
  import SubflowNodeConfig from './SubflowNodeConfig.svelte';
  import DatabaseNodeConfig from './DatabaseNodeConfig.svelte';
  import FileWriteNodeConfig from './FileWriteNodeConfig.svelte';
  import ScheduleNodeConfig from './ScheduleNodeConfig.svelte';
  import TriggerNodeConfig from './TriggerNodeConfig.svelte';
  import DestinationListField from './DestinationListField.svelte';
  import BranchEditorField from './BranchEditorField.svelte';
  import { conn } from '$lib/state/gateway';
  import { channelPlugins, ensureChannelPlugins } from '$lib/state/features/channel-sources.svelte';

  // Shared channel list for `type: 'channel'` plugin config fields.
  const channels = $derived(channelPlugins());
  $effect(() => {
    if (conn.connected) void ensureChannelPlugins();
  });

  // The node currently being configured + its plugin-declared field defs.
  const node = $derived(flowEditorState.nodes.find((n) => n.id === flowEditorState.configNodeId));
  const isChannel = $derived(node?.type === 'channel');
  const isHandoff = $derived(node?.type === 'handoff');
  const isReaction = $derived(node?.type === 'reaction');
  const isSubflow = $derived(node?.type === 'subflow');
  const isDatabase = $derived(node?.type === 'database');
  const isFileWrite = $derived(node?.type === 'fileWrite');
  const isSchedule = $derived(node?.type === 'schedule');
  const isTrigger = $derived(node?.type === 'trigger');
  const descriptor = $derived(descriptorForNode(node));
  const fields = $derived(descriptor?.config ?? []);
  const config = $derived(((node?.data as { config?: Record<string, unknown> })?.config ?? {}) as Record<string, unknown>);
  const nodeLabel = $derived(
    isTrigger ? m.flowcfg_channelTrigger() : ((node?.data as { label?: string })?.label ?? descriptor?.label ?? m.flowcfg_node()),
  );
  const subtitle = $derived(
    isChannel
      ? m.flowcfg_subtitleChannel()
      : isHandoff
        ? m.flowcfg_subtitleHandoff()
        : isReaction
          ? m.flowcfg_subtitleReaction()
          : isSubflow
            ? m.flowcfg_subtitleSubflow()
            : isDatabase
              ? m.flowcfg_subtitleDatabase()
              : isFileWrite
                ? m.flowcfg_subtitleFileWrite()
                : isSchedule
                  ? m.flowcfg_subtitleSchedule()
                  : isTrigger
                    ? m.flowcfg_subtitleTrigger()
                    : `${descriptor?.pluginId} · ${m.flowcfg_configure()}`,
  );

  function set(key: string, value: unknown) {
    if (node) updateNodeConfig(node.id, key, value);
  }

  /** Stored value, falling back to the field's declared default for display. */
  function disp(field: { key: string; default?: string | number | boolean }): string {
    const v = config[field.key] ?? field.default;
    return v === undefined || v === null ? '' : String(v);
  }
</script>

{#if node && (isChannel || isHandoff || isReaction || isSubflow || isDatabase || isFileWrite || isSchedule || isTrigger || fields.length > 0)}
  <div
    class="absolute top-3 right-3 z-30 {isChannel || isHandoff || isTrigger ? 'w-80' : 'w-72'} max-h-[calc(100%-1.5rem)] overflow-y-auto bg-bg2 border border-border rounded-xl shadow-xl flex flex-col"
    role="dialog"
    tabindex="-1"
    aria-label={m.flowcfg_nodeConfig()}
  >
    <div class="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
      <div class="flex items-center gap-2 min-w-0">
        <Settings2 size={13} class="text-accent shrink-0" />
        <div class="min-w-0">
          <div class="text-xs font-semibold text-foreground truncate">{nodeLabel}</div>
          <div class="text-[10px] text-muted truncate">{subtitle}</div>
        </div>
      </div>
      <button
        onclick={closeNodeConfig}
        class="p-1 rounded text-muted hover:text-foreground hover:bg-bg3 transition-colors shrink-0"
        title={m.common_close()}
        aria-label={m.common_close()}
      >
        <X size={14} />
      </button>
    </div>

    {#if isChannel}
      <ChannelNodeConfig nodeId={node.id} />
    {:else if isHandoff}
      {#key node.id}
        <HandoffNodeConfig nodeId={node.id} />
      {/key}
    {:else if isReaction}
      <ReactionNodeConfig nodeId={node.id} />
    {:else if isSubflow}
      {#key node.id}
        <SubflowNodeConfig nodeId={node.id} />
      {/key}
    {:else if isDatabase}
      {#key node.id}
        <DatabaseNodeConfig nodeId={node.id} />
      {/key}
    {:else if isFileWrite}
      <FileWriteNodeConfig nodeId={node.id} />
    {:else if isSchedule}
      <ScheduleNodeConfig nodeId={node.id} />
    {:else if isTrigger}
      <TriggerNodeConfig nodeId={node.id} />
    {:else}
    <div class="px-3 py-3 flex flex-col gap-3">
      {#each fields as field (field.key)}
        <div class="flex flex-col gap-1">
          {#if field.type === 'boolean'}
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                class="w-3.5 h-3.5 accent-accent"
                checked={config[field.key] === true}
                onchange={(e) => set(field.key, (e.target as HTMLInputElement).checked)}
              />
              <span class="text-xs font-medium text-foreground">{field.label}</span>
            </label>
          {:else if field.type === 'destination-list'}
            <span class="text-[11px] font-medium text-foreground">{field.label}</span>
            <DestinationListField
              value={(config[field.key] as DestinationListValue) ?? { destinations: [] }}
              onChange={(v) => set(field.key, v)}
            />
            {#if field.description}
              <p class="text-[10px] text-muted leading-snug">{field.description}</p>
            {/if}
          {:else if field.type === 'branch-editor'}
            <span class="text-[11px] font-medium text-foreground">{field.label}</span>
            <BranchEditorField
              value={(config[field.key] as BranchConfig) ?? { mode: 'rule', branches: [] }}
              onChange={(v) => set(field.key, v)}
            />
            {#if field.description}
              <p class="text-[10px] text-muted leading-snug">{field.description}</p>
            {/if}
          {:else}
            <label for="cfg-{field.key}" class="text-[11px] font-medium text-foreground">{field.label}</label>
            {#if field.type === 'select'}
              <select
                id="cfg-{field.key}"
                class="w-full text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
                value={disp(field)}
                onchange={(e) => set(field.key, (e.target as HTMLSelectElement).value)}
              >
                {#each field.options ?? [] as opt (opt.value)}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
            {:else if field.type === 'textarea'}
              <textarea
                id="cfg-{field.key}"
                class="w-full text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground resize-y min-h-16 font-mono"
                placeholder={field.placeholder}
                value={disp(field)}
                oninput={(e) => set(field.key, (e.target as HTMLTextAreaElement).value)}
              ></textarea>
            {:else if field.type === 'number'}
              <input
                id="cfg-{field.key}"
                type="number"
                class="w-full text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
                placeholder={field.placeholder}
                value={disp(field)}
                oninput={(e) => {
                  const v = (e.target as HTMLInputElement).value;
                  set(field.key, v === '' ? undefined : Number(v));
                }}
              />
            {:else if field.type === 'channel'}
              <select
                id="cfg-{field.key}"
                class="w-full text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground capitalize"
                value={disp(field)}
                onchange={(e) => set(field.key, (e.target as HTMLSelectElement).value)}
              >
                <option value="">{m.flowcfg_selectChannel()}</option>
                {#each channels as c (c.id)}
                  <option value={c.id}>{c.label}</option>
                {/each}
                {#if disp(field) && !channels.some((c) => c.id === disp(field))}
                  <option value={disp(field)}>{disp(field)}</option>
                {/if}
              </select>
            {:else}
              <input
                id="cfg-{field.key}"
                type="text"
                class="w-full text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
                placeholder={field.placeholder}
                value={disp(field)}
                oninput={(e) => set(field.key, (e.target as HTMLInputElement).value)}
              />
            {/if}
          {/if}
          {#if field.description}
            <p class="text-[10px] text-muted leading-snug">{field.description}</p>
          {/if}
        </div>
      {/each}
    </div>
    {/if}
  </div>
{/if}
