<script lang="ts">
  import { Button, iconSizes } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { Trash2 } from 'lucide-svelte';
  import { recordHref } from '$lib/utils/record-path';
  import { builderState } from '$lib/state/builder';
  import { formatRelativeTime } from './utils';

  interface Props {
    onDelete: (id: string, name: string) => void;
  }

  let { onDelete }: Props = $props();
</script>

<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
  {#each builderState.agents as agent (agent.id)}
    <div class="item-card">
      <a class="item-link" href={recordHref('/agents/builder', agent.id)} aria-label={agent.name}>
        <div class="item-card-inner">
          <div class="item-card-header">
            <span class="item-emoji">{agent.emoji || '🤖'}</span>
            <span class="item-name">{agent.name}</span>
          </div>
          {#if agent.description}
            <span class="item-desc">{agent.description}</span>
          {/if}
          <div class="item-footer">
            <span class="status-badge {agent.status}">{agent.status}</span>
            {#if agent.model}
              <span class="item-model">{agent.model}</span>
            {/if}
            <span class="item-time">{formatRelativeTime(agent.updatedAt)}</span>
          </div>
        </div>
      </a>
      <Button
        variant="ghost"
        type="button"
        size="touch"
        shape="icon"
        class="item-delete"
        onclick={() => onDelete(agent.id, agent.name)}
        aria-label={`${m.common_delete()} ${agent.name}`}
      >
        <Trash2 size={iconSizes.sm} />
      </Button>
    </div>
  {/each}
</div>

<style>
  .item-card {
    position: relative;
    min-width: 0;
    display: flex;
    align-items: stretch;
    min-height: 7rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-bg2);
    transition: all var(--duration-fast) var(--ease-standard);
    padding: 0;
    font-family: inherit;
    width: 100%;
    color: inherit;
    text-align: left;
  }

  .item-card:hover {
    background: var(--color-bg3);
    border-color: color-mix(in srgb, var(--color-accent) 40%, var(--color-border));
  }

  .item-link {
    display: flex;
    width: 100%;
    min-width: 0;
    color: inherit;
    text-decoration: none;
    border-radius: var(--radius-lg);
  }
  .item-card-inner {
    display: flex;
    flex-direction: column;
    width: 100%;
    padding: var(--space-4) var(--space-6);
    padding-right: calc(var(--control-height-touch) + var(--space-4));
    gap: var(--space-2);
  }

  .item-card-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .item-emoji {
    font-size: var(--font-size-page-title);
    line-height: 1;
  }

  .item-name {
    font-size: var(--font-size-body);
    font-weight: 600;
    color: var(--color-foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    width: fit-content;
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    font-size: var(--font-size-telemetry);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .status-badge.draft {
    background: color-mix(in srgb, var(--color-muted) 15%, transparent);
    color: var(--color-muted);
  }

  .status-badge.published {
    background: color-mix(in srgb, var(--color-accent) 15%, transparent);
    color: var(--color-accent);
  }

  .item-desc {
    font-size: var(--font-size-caption);
    color: var(--color-muted);
    line-height: 1.4;
    overflow: hidden;
    display: -webkit-box;
    line-clamp: 2;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .item-footer {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: auto;
  }

  .item-time {
    font-size: var(--font-size-caption);
    color: var(--color-muted);
  }

  .item-model {
    font-size: var(--font-size-telemetry);
    font-family: var(--font-mono, monospace);
    color: var(--color-muted);
    background: var(--color-bg3);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-sm);
  }

  .item-card :global(.item-delete) {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    min-width: var(--control-height-touch);
    min-height: var(--control-height-touch);
    color: var(--color-text-secondary);
    opacity: 0;
    transition: opacity var(--duration-fast) var(--ease-standard);
  }
  .item-card:hover :global(.item-delete),
  .item-card:focus-within :global(.item-delete) {
    opacity: 1;
  }
  .item-card :global(.item-delete:hover) {
    color: var(--color-danger-fg);
    background: var(--color-danger-surface);
  }
  @media (hover: none), (pointer: coarse) {
    .item-card :global(.item-delete) {
      opacity: 1;
    }
  }
</style>
