<script lang="ts">
  import { goto } from '$lib/navigation';
  import { page } from '$app/state';
  import { Archive, CloudCog, DatabaseBackup, RefreshCw, ShieldCheck, Trash2 } from 'lucide-svelte';
  import { Button, PageHeader } from '$lib/components/ui';
  import {
    AsyncBoundary,
    ConfirmDialog,
    PageBody,
    PageShell,
    type AsyncBoundaryState,
  } from '$lib/components/ui/foundations';
  import { archiveShell, backupNow, destroyShell, restartShell } from '$lib/services/shells-rpc';
  import { cloudShell, cloudState, refreshCloud } from '$lib/state/features/cloud.svelte';
  import * as m from '$lib/paraglide/messages';

  const selected = $derived(cloudShell(page.url.searchParams.get('server')));
  let action = $state<string | null>(null);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let destroyOpen = $state(false);

  const pageState = $derived.by<AsyncBoundaryState>(() => {
    if (cloudState.loading) return { kind: 'loading', label: m.common_loading() };
    if (cloudState.error && cloudState.shells.length === 0) {
      return {
        kind: 'error',
        title: m.cloud_load_failed(),
        description: cloudState.error,
        retry: () => void refreshCloud(),
      };
    }
    if (!selected) {
      return {
        kind: 'empty',
        title: m.cloud_empty_title(),
        description: m.cloud_empty_description(),
      };
    }
    return { kind: 'ready' };
  });

  async function run(label: string, fn: () => Promise<unknown>, success: string): Promise<void> {
    action = label;
    error = null;
    notice = null;
    try {
      await fn();
      notice = success;
      await refreshCloud();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      action = null;
    }
  }

  async function remove(): Promise<void> {
    if (!selected) return;
    action = 'destroy';
    error = null;
    notice = null;
    try {
      await destroyShell(selected.shellId);
      await refreshCloud();
      await goto('/cloud');
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      action = null;
    }
  }
</script>

<svelte:head><title>{m.cloud_settings_title()} · Minion hub</title></svelte:head>

<PageShell archetype="form" scroll="none" labelledBy="cloud-settings-title">
  <PageHeader
    titleId="cloud-settings-title"
    title={m.cloud_settings_title()}
    subtitle={m.cloud_settings_description()}
  >
    {#snippet leading()}
      <CloudCog size={16} class="text-accent" aria-hidden="true" />
    {/snippet}
    {#snippet secondaryActions()}
      {#if selected}<span class="workspace-identity">{selected.vmName}</span>{/if}
    {/snippet}
  </PageHeader>

  <PageBody width="reading" padding="default" scroll="region" class="cloud-settings-body">
    <AsyncBoundary state={pageState}>
      {#if selected}
        {#if error}<div class="alert error" role="alert">{error}</div>{/if}
        {#if notice}<div class="alert success" role="status">{notice}</div>{/if}

        <section class="settings-panel" aria-labelledby="machine-configuration-title">
          <header>
            <CloudCog size={15} aria-hidden="true" />
            <div>
              <h2 id="machine-configuration-title">{m.cloud_machine_configuration()}</h2>
              <p>{m.cloud_machine_configuration_hint()}</p>
            </div>
          </header>
          <dl>
            <div>
              <dt>{m.cloud_provider()}</dt>
              <dd>{selected.provider ?? 'exe.dev'}</dd>
            </div>
            <div>
              <dt>{m.cloud_blueprint()}</dt>
              <dd>{selected.blueprint ?? 'minion-workstation-v1'}</dd>
            </div>
            <div>
              <dt>{m.cloud_operating_system()}</dt>
              <dd>{m.cloud_os_profile_value()}</dd>
            </div>
            <div>
              <dt>{m.cloud_resources()}</dt>
              <dd>
                {selected.cpu ?? 2} vCPU · {Math.round(selected.memoryMB / 1024)} GB RAM · {selected.diskGB}
                GB SSD
              </dd>
            </div>
            <div>
              <dt>{m.cloud_region()}</dt>
              <dd>{selected.region}</dd>
            </div>
            <div>
              <dt>{m.cloud_backup_policy()}</dt>
              <dd>{selected.backupCadence}</dd>
            </div>
          </dl>
        </section>

        <section class="settings-panel" aria-labelledby="runtime-stack-title">
          <header>
            <ShieldCheck size={15} aria-hidden="true" />
            <div>
              <h2 id="runtime-stack-title">{m.cloud_runtime_stack()}</h2>
              <p>{m.cloud_runtime_stack_hint()}</p>
            </div>
          </header>
          <div class="runtime-grid">
            {#each selected.runtimes ?? [selected.harness] as runtime (runtime)}
              <div>
                <span class="status-dot" aria-hidden="true"></span><strong>{runtime}</strong><small
                  >{m.cloud_installed()}</small
                >
              </div>
            {/each}
            <div>
              <span class="status-dot base" aria-hidden="true"></span><strong
                >{m.cloud_package_chromium()}</strong
              ><small>{m.cloud_base_image()}</small>
            </div>
          </div>
        </section>

        <section class="settings-panel" aria-labelledby="lifecycle-title">
          <header>
            <DatabaseBackup size={15} aria-hidden="true" />
            <div>
              <h2 id="lifecycle-title">{m.cloud_lifecycle()}</h2>
              <p>{m.cloud_lifecycle_hint()}</p>
            </div>
          </header>
          <div class="actions">
            <Button
              variant="secondary"
              class="lifecycle-button"
              disabled={action !== null}
              loading={action === 'backup'}
              onclick={() =>
                void run('backup', () => backupNow(selected.shellId), m.cloud_backup_started())}
            >
              <DatabaseBackup size={14} aria-hidden="true" />
              <span
                ><strong>{m.cloud_backup_now()}</strong><small>{m.cloud_backup_now_hint()}</small
                ></span
              >
            </Button>
            <Button
              variant="secondary"
              class="lifecycle-button"
              disabled={action !== null}
              loading={action === 'restart'}
              onclick={() =>
                void run(
                  'restart',
                  () => restartShell(selected.shellId),
                  m.cloud_restart_started(),
                )}
            >
              <RefreshCw size={14} aria-hidden="true" />
              <span
                ><strong>{m.cloud_restart()}</strong><small>{m.cloud_restart_hint()}</small></span
              >
            </Button>
            <Button
              variant="secondary"
              class="lifecycle-button"
              disabled={action !== null || selected.status !== 'online'}
              loading={action === 'archive'}
              onclick={() =>
                void run(
                  'archive',
                  () => archiveShell(selected.shellId),
                  m.cloud_archive_started(),
                )}
            >
              <Archive size={14} aria-hidden="true" />
              <span
                ><strong>{m.cloud_archive()}</strong><small>{m.cloud_archive_hint()}</small></span
              >
            </Button>
          </div>
        </section>

        <section class="settings-panel danger-zone" aria-labelledby="danger-zone-title">
          <header>
            <Trash2 size={15} aria-hidden="true" />
            <div>
              <h2 id="danger-zone-title">{m.cloud_danger_zone()}</h2>
              <p>{m.cloud_danger_zone_hint()}</p>
            </div>
          </header>
          <div class="danger-row">
            <div>
              <strong>{m.cloud_destroy_workspace()}</strong>
              <span>{m.cloud_destroy_workspace_hint()}</span>
            </div>
            <Button
              variant="danger"
              size="sm"
              disabled={action !== null}
              onclick={() => (destroyOpen = true)}
            >
              <Trash2 size={14} aria-hidden="true" />
              {m.cloud_destroy()}
            </Button>
          </div>
        </section>
      {/if}
    </AsyncBoundary>
  </PageBody>
</PageShell>

<ConfirmDialog
  bind:open={destroyOpen}
  title={m.cloud_destroy_workspace()}
  message={m.cloud_destroy_confirm({ name: selected?.displayName ?? '' })}
  confirmLabel={m.cloud_destroy()}
  failureMessage={error ?? m.common_error()}
  tone="danger"
  onconfirm={remove}
/>

<style>
  :global(.cloud-settings-body) {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .workspace-identity {
    color: var(--color-accent);
    font-family: var(--font-mono);
    font-size: var(--font-size-telemetry);
    line-height: var(--line-height-compact);
    letter-spacing: var(--letter-spacing-label);
    text-transform: uppercase;
  }

  .alert {
    margin-bottom: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: 1px solid;
    border-radius: var(--radius-md);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
  }

  .alert.error {
    border-color: var(--color-danger-border);
    color: var(--color-danger-fg);
    background: var(--color-danger-surface);
  }

  .alert.success {
    border-color: var(--color-success-border);
    color: var(--color-success-fg);
    background: var(--color-success-surface);
  }

  .settings-panel {
    margin-bottom: var(--space-3);
    overflow: hidden;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
  }

  .settings-panel > header {
    display: flex;
    min-height: var(--control-height-touch);
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .settings-panel > header > :global(svg) {
    color: var(--color-accent);
  }

  .settings-panel h2 {
    margin: 0;
    font-size: var(--font-size-section-title);
    line-height: var(--line-height-heading);
    font-weight: var(--font-weight-semibold);
  }

  .settings-panel header p {
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
  }

  dl {
    margin: 0;
    padding: var(--space-1) var(--space-3);
  }

  dl div {
    display: flex;
    min-height: var(--control-height-lg);
    align-items: center;
    gap: var(--space-4);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  dl div:last-child {
    border: 0;
  }

  dt,
  dd {
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
  }

  dt {
    color: var(--color-text-tertiary);
  }

  dd {
    margin-left: auto;
    color: var(--color-text-secondary);
    font-family: var(--font-mono);
    text-align: right;
  }

  .runtime-grid,
  .actions {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
  }

  .runtime-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .runtime-grid > div {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-content: center;
    gap: var(--space-1) var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
  }

  .status-dot {
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
    background: var(--color-success-fg);
  }

  .status-dot.base {
    background: var(--color-accent);
  }

  .runtime-grid strong {
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
  }

  .runtime-grid small {
    grid-column: 2;
    color: var(--color-text-tertiary);
    font-size: var(--font-size-telemetry);
    line-height: var(--line-height-compact);
    letter-spacing: var(--letter-spacing-label);
    text-transform: uppercase;
  }

  .actions {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  :global(.lifecycle-button) {
    height: auto;
    min-height: var(--control-height-touch);
    justify-content: flex-start;
    padding: var(--space-3);
    text-align: left;
    white-space: normal;
  }

  :global(.lifecycle-button [data-part='button'] span),
  :global(.lifecycle-button > span) {
    align-items: flex-start;
  }

  :global(.lifecycle-button strong),
  :global(.lifecycle-button small) {
    display: block;
  }

  :global(.lifecycle-button strong) {
    color: var(--color-text-primary);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
  }

  :global(.lifecycle-button small) {
    margin-top: var(--space-1);
    color: var(--color-text-tertiary);
    font-size: var(--font-size-telemetry);
    line-height: var(--line-height-compact);
  }

  .danger-zone {
    border-color: var(--color-danger-border);
  }

  .danger-zone > header > :global(svg) {
    color: var(--color-danger-fg);
  }

  .danger-row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3);
  }

  .danger-row > div {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
  }

  .danger-row strong {
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
  }

  .danger-row span {
    margin-top: var(--space-1);
    color: var(--color-text-tertiary);
    font-size: var(--font-size-telemetry);
    line-height: var(--line-height-compact);
  }

  @media (max-width: 767.98px) {
    .actions,
    .runtime-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    dl div,
    .danger-row {
      align-items: flex-start;
      flex-direction: column;
      gap: var(--space-2);
      padding-block: var(--space-2);
    }

    dd {
      margin-left: 0;
      text-align: left;
    }
  }
</style>
