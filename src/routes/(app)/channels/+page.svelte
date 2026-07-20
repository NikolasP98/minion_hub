<script lang="ts">
  import { MessagesSquare, ArrowRight } from 'lucide-svelte';
  import { Badge, PageHeader } from '$lib/components/ui';
  import { AsyncBoundary, PageBody, PageShell } from '$lib/components/ui/foundations';
  import NavIcon from '$lib/components/layout/NavIcon.svelte';
  import { resolvePluginIcon } from '$lib/plugins/icon-map';
  import * as m from '$lib/paraglide/messages';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const channels = $derived(data.channels);
  // Set when the gateway couldn't be reached — the page still renders (hub-native
  // cards like Gmail stay usable) but must not imply "no channels are enabled".
  // Boolean by design: the underlying RPC error can name internal hosts, so it
  // stays in the server log.
  const gatewayUnavailable = $derived(data.gatewayUnavailable);

  // Map the manifest status to a label + tone for the card's status pill.
  function status(s: string | undefined): {
    label: string;
    value: 'success' | 'error' | 'warning' | 'info';
  } {
    switch (s) {
      case 'loaded':
        return { label: 'Connected', value: 'success' };
      case 'error':
        return { label: 'Error', value: 'error' };
      case 'incompatible':
        return { label: 'Update needed', value: 'warning' };
      case 'disabled':
        return { label: 'Disabled', value: 'info' };
      default:
        return { label: 'Available', value: 'info' };
    }
  }
</script>

<PageShell archetype="collection" scroll="page" labelledBy="channels-title">
  <PageHeader
    titleId="channels-title"
    title={m.nav_channels()}
    subtitle="Messaging channels connected to this organization"
  >
    {#snippet leading()}
      <MessagesSquare size={16} class="text-accent shrink-0" />
    {/snippet}
  </PageHeader>

  <PageBody width="content">
    {#if gatewayUnavailable}
      <p
        class="mb-3 rounded-md border border-warning/30 bg-warning/15 px-3 py-2 text-[length:var(--font-size-label)] text-warning"
      >
        The gateway server didn't respond, so only hub-native channels are shown. Check that
        it's online and that the host URL is correct in Hosts → Edit.
      </p>
    {/if}
    <AsyncBoundary
      state={channels.length === 0
        ? {
            kind: 'empty',
            title: 'No channels enabled',
            description: 'Enable a messaging channel to connect it to this organization.',
          }
        : { kind: 'ready' }}
    >
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
                <Badge variant="semantic" value={st.value} size="sm">{st.label}</Badge>
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
    </AsyncBoundary>
  </PageBody>
</PageShell>

<style>
  .channel-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
    gap: var(--space-3, 0.75rem);
  }
  .channel-card {
    display: flex;
    align-items: flex-start;
    gap: var(--space-4, 1rem);
    padding: var(--space-4, 1rem);
    border-radius: var(--radius-lg);
    border: 1px solid var(--color-border-subtle);
    background: var(--color-surface-2);
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
</style>
