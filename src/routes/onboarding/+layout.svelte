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
    background: radial-gradient(ellipse at 50% 40%, var(--color-bg2) 0%, var(--color-bg) 70%);
    color: var(--color-foreground);
    font-family: var(--font-sans);
    overflow: hidden;
    position: relative;
  }
</style>