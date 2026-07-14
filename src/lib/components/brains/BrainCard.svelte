<script lang="ts">
  import { ArrowUpRight, Lock, Globe } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { diceBearAvatarUrl } from '$lib/utils/avatar';
  import type { BrainDTO } from '$lib/types/brains';
  import { Card } from '$lib/components/ui';

  let { brain }: { brain: BrainDTO } = $props();

  const detailHref = $derived(`/brains/${encodeURIComponent(brain.id)}`);
  const avatarUrl = $derived(diceBearAvatarUrl(brain.id, 'brain'));
</script>

<article>
  <Card interactive>
    <div class="brain-card">
      <header>
        <img src={avatarUrl} alt="" class="brain-avatar" loading="lazy" />
        <div class="brain-heading">
          <a href={detailHref}>
            <span>{brain.name}</span>
            <ArrowUpRight size={13} aria-hidden="true" />
          </a>
          <p class="visibility">
            {#if brain.visibility === 'private'}
              <Lock size={12} aria-hidden="true" /> {m.brains_visibility_private()}
            {:else}
              <Globe size={12} aria-hidden="true" /> {m.brains_visibility_org()}
            {/if}
          </p>
        </div>
        {#if brain.icon}
          <span class="brain-icon" aria-hidden="true">{brain.icon}</span>
        {/if}
      </header>

      {#if brain.description}
        <p class="description">{brain.description}</p>
      {/if}
    </div>
  </Card>
</article>

<style>
  .brain-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  header {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
  }

  .brain-avatar {
    width: var(--control-height-touch);
    height: var(--control-height-touch);
    flex: none;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
  }

  .brain-heading {
    min-width: 0;
    flex: 1;
  }

  .brain-heading a {
    display: inline-flex;
    max-width: 100%;
    align-items: center;
    gap: var(--space-1);
    color: var(--color-text-primary);
    font-size: var(--font-size-section-title);
    line-height: var(--line-height-heading);
    font-weight: var(--font-weight-semibold);
    text-decoration: none;
  }

  .brain-heading a:hover {
    text-decoration: underline;
  }

  .brain-heading a span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .visibility {
    display: inline-flex;
    margin-top: var(--space-0-5);
    align-items: center;
    gap: var(--space-1);
    color: var(--color-text-tertiary);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
  }

  .brain-icon {
    flex: none;
    font-size: var(--font-size-page-title);
    line-height: var(--line-height-heading);
  }

  .description {
    display: -webkit-box;
    overflow: hidden;
    color: var(--color-text-secondary);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-body);
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
</style>
