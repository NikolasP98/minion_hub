<script lang="ts">
  import * as tooltip from '@zag-js/tooltip';
  import { normalizeProps, useMachine } from '@zag-js/svelte';
  import type { Snippet } from 'svelte';

  let { content, children }: {
    content: string;
    children: Snippet;
  } = $props();

  const id = crypto.randomUUID();

  const service = useMachine(tooltip.machine, () => ({
    id,
    openDelay: 300,
    closeDelay: 100,
    positioning: { placement: 'top' as const },
  }));

  const api = $derived(tooltip.connect(service, normalizeProps));
</script>

{#if content}
  <span {...api.getTriggerProps()}>
    {@render children()}
  </span>

  {#if api.open}
    <div {...api.getPositionerProps()}>
      <div
        {...api.getContentProps()}
        class="bg-bg2 border border-border rounded-md px-3 py-2 text-[11px] text-foreground shadow-lg max-w-[280px] z-50 leading-relaxed"
      >
        {content}
      </div>
    </div>
  {/if}
{:else}
  {@render children()}
{/if}
