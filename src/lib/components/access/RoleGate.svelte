<script lang="ts">
  import type { Snippet } from 'svelte';
  import { canClient } from '$lib/access/can.svelte';
  let { key, children, fallback }: { key: string; children: Snippet; fallback?: Snippet } = $props();
</script>

{#if canClient(key)}
  {@render children()}
{:else if fallback}
  {@render fallback()}
{/if}
