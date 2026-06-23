<script lang="ts">
  import { MessagesSquare, ArrowRight } from 'lucide-svelte';
  import { PageHeader } from '$lib/components/ui';
  import NavIcon from '$lib/components/layout/NavIcon.svelte';
  import { resolvePluginIcon } from '$lib/plugins/icon-map';
  import * as m from '$lib/paraglide/messages';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const channels = $derived(data.channels);

  // Map the manifest status to a label + tone for the card's status pill.
  function status(s: string | undefined): { label: string; tone: string } {
    switch (s) {
      case 'loaded':
        return { label: 'Connected', tone: 'ok' };
      case 'error':
        return { label: 'Error', tone: 'err' };
      case 'incompatible':
        return { label: 'Update needed', tone: 'warn' };
      case 'disabled':
        return { label: 'Disabled', tone: 'muted' };
      default:
        return { label: 'Available', tone: 'muted' };
    }
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <PageHeader title={m.nav_channels()} subtitle="Messaging channels connected to this organization">
    {#snippet leading()}
      <MessagesSquare size={16} class="text-accent shrink-0" />
    {/snippet}
  </PageHeader>

  <div class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
    {#if channels.length === 0}
      <div class="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <MessagesSquare size={32} class="opacity-40" />
        <p class="text-sm">No channels enabled for this organization.</p>
      </div>
    {:else}
      <div class="channel-grid">
        {#each channels as e (e.pluginId)}
          {@const st = status(e.status)}
          <a href="/channels/{e.pluginId}" class="channel-card group">
            <div class="icon-wrap">
              <NavIcon icon={resolvePluginIcon(e.icon)} size={22} class="text-accent" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="font-semibold text-sm text-foreground truncate">{e.title}</span>
                <span class="status-pill {st.tone}">{st.label}</span>
              </div>
              {#if e.description}
                <p class="text-xs text-muted-foreground mt-0.5 line-clamp-2">{e.description}</p>
              {/if}
            </div>
            <ArrowRight
              size={16}
              class="text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity self-center"
            />
          </a>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .channel-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
    gap: 0.75rem;
  }
  .channel-card {
    display: flex;
    align-items: flex-start;
    gap: 0.875rem;
    padding: 1rem;
    border-radius: var(--radius-lg, 0.75rem);
    border: 1px solid var(--hairline);
    background: var(--color-bg2, rgba(255, 255, 255, 0.02));
    text-decoration: none;
    transition:
      border-color var(--duration-fast) var(--ease-standard),
      background-color var(--duration-fast) var(--ease-standard);
  }
  .channel-card:hover {
    border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
    background: color-mix(in srgb, var(--color-accent) 6%, transparent);
  }
  .icon-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    flex-shrink: 0;
  }
  .status-pill {
    font-size: 0.625rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    padding: 0.0625rem 0.375rem;
    border-radius: 9999px;
    white-space: nowrap;
  }
  .status-pill.ok {
    color: var(--color-success, #34d399);
    background: color-mix(in srgb, var(--color-success, #34d399) 14%, transparent);
  }
  .status-pill.err {
    color: var(--color-destructive, #f87171);
    background: color-mix(in srgb, var(--color-destructive, #f87171) 14%, transparent);
  }
  .status-pill.warn {
    color: var(--color-warning, #fbbf24);
    background: color-mix(in srgb, var(--color-warning, #fbbf24) 14%, transparent);
  }
  .status-pill.muted {
    color: var(--color-muted);
    background: rgba(255, 255, 255, 0.06);
  }
</style>
