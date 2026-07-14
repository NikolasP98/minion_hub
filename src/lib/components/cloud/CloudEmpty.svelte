<script lang="ts">
  import { Button } from '$lib/components/ui';
  import { Cloud, Plus } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  let { canManage, onProvision }: { canManage: boolean; onProvision?: () => void } = $props();
</script>

<div class="empty-shell">
  <div class="orbit" aria-hidden="true"><Cloud size={28} /></div>
  <div>
    <h2>{m.cloud_empty_title()}</h2>
    <p>{m.cloud_empty_description()}</p>
  </div>
  {#if canManage && onProvision}
    <Button class="cloud-provision" variant="ghost" type="button" onclick={onProvision}
      ><Plus size={15} /> {m.cloud_create_default()}</Button
    >
  {/if}
</div>

<style>
  .empty-shell {
    min-height: 22rem;
    display: grid;
    place-items: center;
    align-content: center;
    gap: var(--space-4);
    text-align: center;
    padding: var(--space-8);
    background-image:
      linear-gradient(var(--hairline) 1px, transparent 1px),
      linear-gradient(90deg, var(--hairline) 1px, transparent 1px);
    background-size: 2rem 2rem;
    mask-image: radial-gradient(circle, black 25%, transparent 72%);
  }
  .orbit {
    width: 4rem;
    height: 4rem;
    display: grid;
    place-items: center;
    border: 1px solid color-mix(in srgb, var(--color-accent) 40%, var(--hairline));
    border-radius: var(--radius-full);
    color: var(--color-accent);
    background: var(--elevation-2-bg);
    box-shadow: var(--shadow-elevation-1);
  }
  h2 {
    margin: 0;
    font-size: var(--font-size-page-title);
  }
  p {
    max-width: 30rem;
    margin: var(--space-2) auto 0;
    color: var(--color-muted);
    font-size: var(--font-size-body);
    line-height: 1.55;
  }
  :global(.cloud-provision) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: 2.25rem;
    padding: 0 var(--space-3);
    border: 1px solid color-mix(in srgb, var(--color-accent) 38%, transparent);
    border-radius: var(--radius-md);
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    cursor: pointer;
    font-size: var(--font-size-caption);
    font-weight: 600;
  }
</style>
