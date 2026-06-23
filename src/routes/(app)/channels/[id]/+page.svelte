<script lang="ts">
  import PluginControlCenter from '$lib/plugins/PluginControlCenter.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<PluginControlCenter entry={data.entry} gatewayBaseUrl={data.gatewayBaseUrl} />
