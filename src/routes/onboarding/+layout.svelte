<script lang="ts">
  import { type Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
</script>

<svelte:head>
  <title>Onboarding — Minion Hub</title>
</svelte:head>

{@render children()}
