<script lang="ts">
  import BackupsTab from '$lib/components/settings/BackupsTab.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<div class="flex-1 overflow-y-auto p-6 md:p-10">
  <div class="max-w-2xl mx-auto">
    <BackupsTab initialConfig={data.config} />
  </div>
</div>
