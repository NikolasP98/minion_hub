<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { Reply, Clock, X } from 'lucide-svelte';
  import { Button } from '$lib/components/ui';

  interface Props {
    title: string;
    subtitle?: string;
    icon?: string;
    onreply?: () => void;
    onsnooze?: () => void;
    ondismiss?: () => void;
    onopen?: () => void;
  }

  const { title, subtitle, icon, onreply, onsnooze, ondismiss, onopen }: Props = $props();
</script>

{#snippet cardBody()}
  {#if icon}
    <span class="icon" aria-hidden="true">{icon}</span>
  {/if}
  <div class="text">
    <div class="title">{title}</div>
    {#if subtitle}
      <div class="subtitle">{subtitle}</div>
    {/if}
  </div>
{/snippet}

<article class="card">
  {#if onopen}
    <Button
      variant="ghost"
      class="body !h-auto !justify-start !px-0 !py-0 text-left"
      onclick={onopen}
    >
      {@render cardBody()}
    </Button>
  {:else}
    <div class="body">{@render cardBody()}</div>
  {/if}
  {#if onreply || onsnooze || ondismiss}
    <div class="actions" role="group" aria-label={m.feed_itemActions()}>
      {#if onreply}
        <Button
          variant="ghost"
          size="icon"
          type="button"
          aria-label={m.feed_reply()}
          onclick={(e) => {
            e.stopPropagation();
            onreply?.();
          }}
        >
          <Reply size={14} />
        </Button>
      {/if}
      {#if onsnooze}
        <Button
          variant="ghost"
          size="icon"
          type="button"
          aria-label={m.feed_snooze24h()}
          onclick={(e) => {
            e.stopPropagation();
            onsnooze?.();
          }}
        >
          <Clock size={14} />
        </Button>
      {/if}
      {#if ondismiss}
        <Button
          variant="ghost"
          size="icon"
          type="button"
          aria-label={m.feed_dismiss()}
          onclick={(e) => {
            e.stopPropagation();
            ondismiss?.();
          }}
        >
          <X size={14} />
        </Button>
      {/if}
    </div>
  {/if}
</article>

<style>
  .card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: var(--control-height-touch, 56px);
    padding: var(--space-3, 12px) var(--space-4, 16px);
    border-radius: var(--radius-lg);
    background: transparent;
    border: 1px solid transparent;
    transition:
      background var(--duration-fast) var(--ease-standard),
      border-color var(--duration-fast) var(--ease-standard);
  }

  .body {
    display: flex;
    align-items: center;
    gap: var(--space-3, 12px);
    min-width: 0;
    flex: 1;
  }

  .icon {
    font-size: var(--font-size-section-title, 16px);
    opacity: 0.7;
  }

  .text {
    min-width: 0;
    flex: 1;
  }

  .title {
    font-size: var(--font-size-body, 14px);
    color: color-mix(in srgb, var(--color-foreground) 92%, transparent);
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .subtitle {
    font-size: var(--font-size-caption, 12px);
    color: color-mix(in srgb, var(--color-foreground) 50%, transparent);
    margin-top: var(--space-0.5, 2px);
  }

  .actions {
    display: flex;
    gap: var(--space-1, 4px);
    opacity: 0;
    transition: opacity var(--duration-fast) var(--ease-standard);
  }

  .card:hover .actions,
  .card:focus-within .actions {
    opacity: 1;
  }
</style>
