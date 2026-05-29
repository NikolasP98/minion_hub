<script lang="ts" module>
  export type EmptyStateTone = 'neutral' | 'error';
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    description?: string;
    /** lucide icon component shown in the medallion. */
    icon?: unknown;
    tone?: EmptyStateTone;
    /** Tightens vertical padding for inline/embedded use. */
    compact?: boolean;
    class?: string;
    /** Primary recovery action(s) — buttons, links. */
    action?: Snippet;
  }

  let {
    title,
    description,
    icon,
    tone = 'neutral',
    compact = false,
    class: cls = '',
    action,
  }: Props = $props();

  const Icon = $derived(icon as typeof import('lucide-svelte').Inbox | undefined);
  const accent = $derived(tone === 'error' ? 'var(--color-destructive)' : 'var(--color-muted-foreground)');
</script>

<div
  class={`flex flex-col items-center justify-center text-center mx-auto max-w-sm ${compact ? 'py-8 gap-2' : 'py-16 gap-3'} ${cls}`}
>
  {#if Icon}
    <div
      class="flex items-center justify-center w-12 h-12 rounded-full mb-1"
      style={`background-color: color-mix(in srgb, ${accent} 12%, transparent); color: ${accent};`}
    >
      <Icon size={22} />
    </div>
  {/if}
  <h3 class="t-title text-foreground">{title}</h3>
  {#if description}
    <p class="t-body text-muted max-w-xs text-balance">{description}</p>
  {/if}
  {#if action}
    <div class="flex items-center justify-center gap-2 mt-2">{@render action()}</div>
  {/if}
</div>
