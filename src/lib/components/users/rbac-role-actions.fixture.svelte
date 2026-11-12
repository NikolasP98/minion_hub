<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import type { ActionRuntime } from '$lib/services/actions/runtime.svelte';
  import { provideActions } from '$lib/services/actions/context';
  import RbacRolesSection from './RbacRolesSection.svelte';
  let {
    runtime,
    sectionProps,
  }: { runtime: ActionRuntime; sectionProps: ComponentProps<typeof RbacRolesSection> } = $props();
  // svelte-ignore state_referenced_locally
  provideActions(runtime);
</script>

<RbacRolesSection {...sectionProps} />
