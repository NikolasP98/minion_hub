<script lang="ts">
  import { getBranding } from '$lib/branding.svelte';
  let {
    name,
    suffix = 'hub',
    inheritStyles = false,
    class: className = '',
  }: {
    name?: string;
    suffix?: string;
    /** Use the caller-owned prefix palette and weight, as in personal logo presets. */
    inheritStyles?: boolean;
    class?: string;
  } = $props();
  const prefix = $derived(name ?? getBranding().name);
</script>

<span class="hub-wordmark {className}" role="img" aria-label={`${prefix} Hub`}>
  <span class="hub-prefix" class:inherit-styles={inheritStyles} aria-hidden="true">{prefix}</span>
  <span class="hub-suffix" aria-hidden="true">{suffix}</span>
</span>

<style>
  .hub-wordmark {
    display: inline-flex;
    align-items: baseline;
    flex-wrap: wrap;
    min-width: 0;
    max-width: 100%;
    gap: var(--space-1);
    line-height: var(--line-height-compact);
  }
  .hub-prefix {
    text-transform: none;
    min-width: 0;
    overflow-wrap: anywhere;
    white-space: normal;
    color: var(--color-brand-pink);
    font-weight: var(--font-weight-bold);
  }
  .hub-prefix.inherit-styles {
    color: inherit;
    font-weight: inherit;
  }
  .hub-suffix {
    text-transform: none;
    flex: 0 0 auto;
    color: var(--color-text-primary);
    font-weight: var(--font-weight-semibold);
  }
</style>
