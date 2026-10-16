<script lang="ts">
  import { onMount } from 'svelte';
  import { LayoutDashboard } from 'lucide-svelte';
  import { iconSizes, PageHeader, EmptyState } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import ElementFrame from '$lib/components/sandbox/ElementFrame.svelte';
  import { createSandboxHost, type SandboxElementRecord } from '$lib/sandbox/host.svelte';
  import * as m from '$lib/paraglide/messages';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // The host owns the list from here (it reloads through the API on every
  // write); the server load is only the first paint.
  // svelte-ignore state_referenced_locally
  const host = createSandboxHost((data.elements ?? []) as SandboxElementRecord[]);

  // The assistant's page-scoped tools land with S3; `import.meta.glob` keeps the
  // page building while that module is absent (empty map, no resolve error).
  const toolModules = import.meta.glob('/src/lib/sandbox/tools.ts');

  onMount(() => {
    const ac = new AbortController();
    const detach = host.attach();
    for (const loadTools of Object.values(toolModules)) {
      void loadTools()
        .then((mod) =>
          (
            mod as { registerSandboxTools?: (opts: { signal: AbortSignal }) => void }
          ).registerSandboxTools?.({ signal: ac.signal }),
        )
        .catch(() => {});
    }
    return () => {
      ac.abort();
      detach();
    };
  });
</script>

<PageShell archetype="dashboard" scroll="page" labelledBy="sandbox-title">
  <PageHeader titleId="sandbox-title" title={m.nav_sandbox()} subtitle={m.sandbox_subtitle()}>
    {#snippet leading()}<LayoutDashboard
        size={iconSizes.md}
        class="shrink-0 text-accent"
      />{/snippet}
  </PageHeader>

  <PageBody>
    {#if host.error}
      <EmptyState tone="error" title={m.sandbox_empty_title()} description={host.error} />
    {:else if host.elements.length === 0}
      <EmptyState
        icon={LayoutDashboard}
        title={m.sandbox_empty_title()}
        description={m.sandbox_empty_body()}
      />
    {:else}
      <div class="sandbox-grid">
        {#each host.elements as element (element.id)}
          <ElementFrame {element} {host} />
        {/each}
      </div>
    {/if}
  </PageBody>
</PageShell>

<style>
  .sandbox-grid {
    display: grid;
    min-width: 0;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-card);
  }
  @media (max-width: 1024px) {
    .sandbox-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 640px) {
    .sandbox-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
