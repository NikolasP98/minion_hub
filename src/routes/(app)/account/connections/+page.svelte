<script lang="ts">
  import type { PageData } from './$types';
  import * as m from '$lib/paraglide/messages';
  import ConnectedIdentities from '$lib/components/users/ConnectedIdentities.svelte';
  import ChannelLinking from '$lib/components/users/ChannelLinking.svelte';
  import SharedInboxes from '$lib/components/users/SharedInboxes.svelte';
  import { PageHeader } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';

  let { data }: { data: PageData } = $props();
</script>

<PageShell archetype="form" scroll="page" labelledBy="account-connections-title">
  <PageHeader
    titleId="account-connections-title"
    title={m.account_nav_connections()}
    subtitle={m.account_nav_header()}
  />
  <PageBody width="reading">
    <div class="account-card-stack">
      <ConnectedIdentities userId={data.userId} identities={data.identities} />
      <SharedInboxes sharedIdentities={data.sharedIdentities} />
      <ChannelLinking userId={data.userId} identities={data.identities} />
    </div>
  </PageBody>
</PageShell>

<style>
  .account-card-stack {
    display: grid;
    gap: var(--space-4, 16px);
  }
</style>
