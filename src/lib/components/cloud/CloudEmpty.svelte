<script lang="ts">
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
    <button type="button" onclick={onProvision}><Plus size={15} /> {m.cloud_create_default()}</button>
  {/if}
</div>

<style>
  .empty-shell {
    min-height: 22rem;
    display: grid;
    place-items: center;
    align-content: center;
    gap: 1rem;
    text-align: center;
    padding: 2rem;
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
    border-radius: 50%;
    color: var(--color-accent);
    background: var(--elevation-2-bg);
    box-shadow: 0 0 0 .75rem color-mix(in srgb, var(--color-accent) 4%, transparent), 0 0 2.5rem color-mix(in srgb, var(--color-accent) 12%, transparent);
  }
  h2 { margin: 0; font-size: 1rem; }
  p { max-width: 30rem; margin: .4rem auto 0; color: var(--color-muted); font-size: .8125rem; line-height: 1.55; }
  button {
    display: inline-flex; align-items: center; gap: .4rem; height: 2.25rem; padding: 0 .85rem;
    border: 1px solid color-mix(in srgb, var(--color-accent) 38%, transparent);
    border-radius: var(--radius-md); color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent); cursor: pointer; font-size: .75rem; font-weight: 600;
  }
</style>
