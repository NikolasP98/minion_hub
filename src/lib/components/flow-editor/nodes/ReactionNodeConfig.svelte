<script lang="ts">
  import { flowEditorState, updateNodeData } from '$lib/state/features/flow-editor.svelte';
  import type { ReactionNodeData } from '$lib/state/features/flow-editor.svelte';
  import * as m from '$lib/paraglide/messages';

  let { nodeId }: { nodeId: string } = $props();

  const node = $derived(flowEditorState.nodes.find((n) => n.id === nodeId));
  const data = $derived((node?.data ?? {}) as ReactionNodeData);

  // Status emojis valid on Telegram's allowed reaction set (also fine on
  // WhatsApp, which accepts any). Picking outside this set works on WhatsApp but
  // is silently skipped on Telegram (REACTION_INVALID).
  const PRESETS: { emoji: string; label: string }[] = [
    { emoji: '👀', label: 'Seen' },
    { emoji: '🫡', label: 'On it' },
    { emoji: '✍️', label: 'Working' },
    { emoji: '👍', label: 'Done' },
    { emoji: '🔥', label: 'Urgent' },
    { emoji: '🎉', label: 'Resolved' },
  ];

  const current = $derived((data.emoji ?? '').trim());

  function setEmoji(value: string) {
    updateNodeData(nodeId, { emoji: value });
  }
  function setLabel(value: string) {
    updateNodeData(nodeId, { label: value });
  }
</script>

<div class="px-3 py-3 flex flex-col gap-3">
  <div class="flex flex-col gap-1.5">
    <span class="text-[11px] font-medium text-foreground">Status emoji</span>
    <p class="text-[10px] text-muted/80 -mt-0.5">
      {m.flowcfg_setReactionDesc()}
    </p>
    <div class="flex flex-wrap gap-1">
      {#each PRESETS as p (p.emoji)}
        <button
          type="button"
          title={p.label}
          aria-label={p.label}
          class="flex items-center gap-1 px-1.5 py-1 rounded border text-xs transition-colors
            {current === p.emoji
              ? 'border-pink-400 bg-pink-500/15 text-foreground'
              : 'border-border bg-bg3 text-muted hover:border-border/80'}"
          onclick={() => setEmoji(p.emoji)}
        >
          <span class="text-sm leading-none">{p.emoji}</span>
          <span class="text-[9px]">{p.label}</span>
        </button>
      {/each}
    </div>
    <input
      class="mt-1 text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
      placeholder={m.flowcfg_typeEmoji()}
      value={current}
      oninput={(e) => setEmoji((e.target as HTMLInputElement).value)}
    />
  </div>

  <label class="flex flex-col gap-1">
    <span class="text-[11px] font-medium text-foreground">Label</span>
    <input
      class="text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
      placeholder={m.flowcfg_setReaction()}
      value={data.label ?? ''}
      oninput={(e) => setLabel((e.target as HTMLInputElement).value)}
    />
  </label>
</div>
