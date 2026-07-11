<script lang="ts">
  import type { PageData } from './$types';
  import * as m from '$lib/paraglide/messages';
  import ConnectedIdentities from '$lib/components/users/ConnectedIdentities.svelte';
  import ChannelLinking from '$lib/components/users/ChannelLinking.svelte';
  import SharedInboxes from '$lib/components/users/SharedInboxes.svelte';

  let { data }: { data: PageData } = $props();
</script>

<div class="h-full overflow-y-auto p-6 md:p-10">
  <div class="max-w-2xl mx-auto space-y-4">
    <h1 class="text-lg font-semibold text-foreground">{m.account_nav_connections()}</h1>

    <ConnectedIdentities userId={data.userId} identities={data.identities} />

    <SharedInboxes sharedIdentities={data.sharedIdentities} />

    <ChannelLinking userId={data.userId} identities={data.identities} />
  </div>
</div>
