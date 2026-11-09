<script lang="ts">
  import type { ActionRuntime } from '$lib/services/actions/runtime.svelte';
  import { provideActions } from '$lib/services/actions/context';
  import SectionAccessDialog from './SectionAccessDialog.svelte';
  let { runtime }: { runtime: ActionRuntime } = $props();
  // svelte-ignore state_referenced_locally
  provideActions(runtime);
</script>

<SectionAccessDialog open target="crm" />
