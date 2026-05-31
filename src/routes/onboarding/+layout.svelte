<script lang="ts">
  import { page } from '$app/state';
  import { type Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
</script>

<svelte:head>
  <title>Onboarding — Minion Hub</title>
</svelte:head>

<div class="onboarding-shell">
  {@render children()}
</div>

<style>
  .onboarding-shell {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    min-height: 100dvh;
    background: radial-gradient(ellipse at 50% 40%, #0f0f23 0%, #060612 70%);
    color: #e0e0f0;
    font-family: 'Inter', system-ui, sans-serif;
    overflow: hidden;
    position: relative;
  }
</style>