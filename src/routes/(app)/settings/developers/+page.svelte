<script lang="ts">
  import type { PageData } from './$types';
  import { Code } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { iconSizes, PageHeader } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import ApiKeysSection from '$lib/components/settings/developers/ApiKeysSection.svelte';
  import McpConnectionsSection from '$lib/components/settings/developers/McpConnectionsSection.svelte';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>{m.settings_developers_title()} — {m.nav_settings()}</title></svelte:head>

<PageShell archetype="form" scroll="page" labelledBy="settings-developers-title">
  <PageHeader
    documentTitle={false}
    titleId="settings-developers-title"
    title={m.settings_developers_title()}
    subtitle={m.settings_developers_subtitle()}
  >
    {#snippet leading()}<Code size={iconSizes.md} class="shrink-0 text-accent" />{/snippet}
  </PageHeader>
  <PageBody width="content">
    <ApiKeysSection keys={data.keys} isOwner={data.isOwner} />
    <McpConnectionsSection connections={data.connections} />
  </PageBody>
</PageShell>
