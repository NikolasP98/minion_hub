<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { Cloud, Loader2, Plus, RefreshCw } from 'lucide-svelte';
  import { cloudShell, cloudState, refreshCloud } from '$lib/state/features/cloud.svelte';
  import * as m from '$lib/paraglide/messages';

  let {
    canManage,
    onProvision,
  }: {
    canManage: boolean;
    onProvision: () => void;
  } = $props();

  const requestedId = $derived(page.url.searchParams.get('server'));
  const selected = $derived(cloudShell(requestedId));

  function choose(shellId: string): void {
    const next = new URL(page.url);
    next.searchParams.set('server', shellId);
    void goto(`${next.pathname}${next.search}`, { noScroll: true });
  }

  function statusTone(status: string | undefined): string {
    if (status === 'online') return 'bg-success';
    if (status === 'provisioning') return 'bg-warning animate-pulse';
    if (status === 'error') return 'bg-destructive';
    return 'bg-muted-foreground';
  }
</script>

<header class="cloud-head surface-1">
  <div class="brand-mark" aria-hidden="true"><Cloud size={17} /></div>
  <div class="min-w-0">
    <div class="flex items-center gap-2">
      <h1>{m.cloud_title()}</h1>
      {#if selected}
        <span class="h-1.5 w-1.5 rounded-full {statusTone(selected.status)}"></span>
      {/if}
    </div>
    <p>{m.cloud_subtitle()}</p>
  </div>

  <div class="ml-auto flex items-center gap-2">
    {#if cloudState.shells.length > 1}
      <label class="server-picker">
        <span>{m.cloud_server_picker()}</span>
        <select
          value={selected?.shellId ?? ''}
          onchange={(event) => choose(event.currentTarget.value)}
          aria-label={m.cloud_server_picker()}
        >
          {#each cloudState.shells as shell (shell.shellId)}
            <option value={shell.shellId}>{shell.displayName}</option>
          {/each}
        </select>
      </label>
    {:else if selected}
      <div class="single-server">
        <span>{m.cloud_server_label()}</span>
        <strong>{selected.displayName}</strong>
      </div>
    {/if}

    <button
      type="button"
      class="icon-button"
      title={m.cloud_refresh()}
      aria-label={m.cloud_refresh()}
      disabled={cloudState.refreshing}
      onclick={() => void refreshCloud()}
    >
      {#if cloudState.refreshing}<Loader2 size={15} class="animate-spin" />{:else}<RefreshCw
          size={15}
        />{/if}
    </button>
    {#if canManage}
      <button type="button" class="provision-button" onclick={onProvision}>
        <Plus size={15} />
        <span>{m.cloud_new_workspace()}</span>
      </button>
    {/if}
  </div>
</header>

<style>
  .cloud-head {
    min-height: 4.25rem;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--hairline);
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .brand-mark {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border: 1px solid color-mix(in srgb, var(--color-accent) 32%, var(--hairline));
    border-radius: var(--radius-md);
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 9%, transparent);
    box-shadow: inset 0 0 18px color-mix(in srgb, var(--color-accent) 8%, transparent);
  }
  h1 {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 650;
    letter-spacing: -0.01em;
  }
  p {
    margin: 0.15rem 0 0;
    font-size: 0.6875rem;
    color: var(--color-muted);
  }
  .server-picker,
  .single-server {
    height: 2rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0 0.65rem;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    background: var(--elevation-2-bg);
  }
  .server-picker > span,
  .single-server > span {
    font-size: 0.5625rem;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--color-muted);
  }
  .server-picker select {
    min-width: 9rem;
    max-width: 15rem;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--color-foreground);
    font: 600 0.75rem/1 var(--font-mono, monospace);
  }
  .single-server strong {
    max-width: 11rem;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 0.75rem;
  }
  .icon-button,
  .provision-button {
    height: 2rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    border-radius: var(--radius-md);
    font: 600 0.75rem/1 var(--font-sans, sans-serif);
    cursor: pointer;
  }
  .icon-button {
    width: 2rem;
    border: 1px solid var(--hairline);
    background: transparent;
    color: var(--color-muted);
  }
  .icon-button:hover {
    color: var(--color-foreground);
    background: rgba(255, 255, 255, 0.04);
  }
  .icon-button:disabled {
    opacity: 0.45;
    cursor: wait;
  }
  .provision-button {
    padding: 0 0.75rem;
    border: 1px solid color-mix(in srgb, var(--color-accent) 38%, transparent);
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }
  .provision-button:hover {
    background: color-mix(in srgb, var(--color-accent) 18%, transparent);
  }
  @media (max-width: 52rem) {
    .cloud-head p,
    .server-picker > span,
    .single-server > span,
    .provision-button span {
      display: none;
    }
    .server-picker select {
      min-width: 7rem;
      max-width: 9rem;
    }
  }
</style>
