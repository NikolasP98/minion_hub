<script lang="ts">
  import type { PageData } from './$types';
  import ConnectedIdentities from '$lib/components/users/ConnectedIdentities.svelte';

  let { data }: { data: PageData } = $props();
</script>

<div class="p-4 space-y-4">
  <h1 class="text-lg font-semibold text-foreground">Account</h1>
  <ConnectedIdentities userId={data.userId} identities={data.identities} />
</div>
