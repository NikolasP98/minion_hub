<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { Cloud, Plus, RefreshCw } from 'lucide-svelte';
  import { Button, Select, type SelectOption, type SelectValue } from '$lib/components/ui';
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
  const shellOptions = $derived<SelectOption[]>(
    cloudState.shells.map((shell) => ({ value: shell.shellId, label: shell.displayName })),
  );

  function choose(value: SelectValue): void {
    const next = new URL(page.url);
    next.searchParams.set('server', String(value));
    void goto(`${next.pathname}${next.search}`, { noScroll: true });
  }
</script>

<header class="cloud-head">
  <div class="brand-mark" aria-hidden="true"><Cloud size={17} /></div>
  <div class="cloud-heading">
    <div class="title-line">
      <h1>{m.cloud_title()}</h1>
      {#if selected}
        <span class="status-dot status-{selected.status}" aria-hidden="true"></span>
      {/if}
    </div>
    <p>{m.cloud_subtitle()}</p>
  </div>

  <div class="cloud-actions">
    {#if cloudState.shells.length > 1}
      <Select
        size="sm"
        value={selected?.shellId ?? ''}
        options={shellOptions}
        onchange={choose}
        aria-label={m.cloud_server_picker()}
        fieldClass="workspace-picker"
      />
    {:else if selected}
      <div class="single-server" title={selected.displayName}>
        <span>{m.cloud_server_label()}</span>
        <strong>{selected.displayName}</strong>
      </div>
    {/if}

    <Button
      type="button"
      variant="ghost"
      size="icon"
      title={m.cloud_refresh()}
      aria-label={m.cloud_refresh()}
      loading={cloudState.refreshing}
      onclick={() => void refreshCloud()}
    >
      <RefreshCw size={15} aria-hidden="true" />
    </Button>

    {#if canManage}
      <Button type="button" variant="primary" size="sm" onclick={onProvision}>
        <Plus size={15} aria-hidden="true" />
        <span class="provision-label">{m.cloud_new_workspace()}</span>
      </Button>
    {/if}
  </div>
</header>

<style>
  .cloud-head {
    display: flex;
    min-height: var(--control-height-touch);
    flex: none;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-page-gutter);
    padding-right: max(var(--space-page-gutter), var(--notch-clearance));
    border-bottom: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
  }

  .brand-mark {
    display: grid;
    width: var(--control-height-md);
    height: var(--control-height-md);
    flex: none;
    place-items: center;
    border: 1px solid color-mix(in srgb, var(--color-accent) 32%, var(--color-border-default));
    border-radius: var(--radius-md);
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 9%, transparent);
    box-shadow: var(--shadow-sm);
  }

  .cloud-heading {
    min-width: 0;
  }

  .title-line,
  .cloud-actions,
  .single-server {
    display: flex;
    align-items: center;
  }

  .title-line {
    gap: var(--space-2);
  }

  h1 {
    margin: 0;
    font-size: var(--font-size-section-title);
    line-height: var(--line-height-heading);
    font-weight: var(--font-weight-semibold);
  }

  p {
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
  }

  .status-dot {
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
    background: var(--color-text-disabled);
  }

  .status-online {
    background: var(--color-success-fg);
  }

  .status-provisioning {
    background: var(--color-warning-fg, var(--color-warning));
  }

  .status-error {
    background: var(--color-danger-fg);
  }

  .cloud-actions {
    min-width: 0;
    margin-left: auto;
    gap: var(--space-2);
  }

  :global(.workspace-picker) {
    min-width: 0;
  }

  .single-server {
    min-width: 0;
    height: var(--control-height-md);
    gap: var(--space-2);
    padding-inline: var(--space-3);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
  }

  .single-server span {
    color: var(--color-text-tertiary);
    font-size: var(--font-size-telemetry);
    letter-spacing: var(--letter-spacing-label);
    text-transform: uppercase;
  }

  .single-server strong {
    overflow: hidden;
    font-size: var(--font-size-caption);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 1023.98px) {
    .cloud-head {
      padding-right: var(--space-page-gutter);
    }
  }

  @media (max-width: 767.98px) {
    .cloud-head {
      gap: var(--space-2);
    }

    .cloud-heading p,
    .single-server span,
    :global(.provision-label) {
      display: none;
    }

    .cloud-heading {
      flex: none;
    }

    .cloud-actions {
      flex: 1;
      justify-content: flex-end;
    }

    :global(.workspace-picker) {
      flex: 1;
    }

    .single-server {
      max-width: 40%;
    }
  }
</style>
