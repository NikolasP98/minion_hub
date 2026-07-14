<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import {
    getShell,
    archiveShell,
    destroyShell,
    backupNow,
    type ShellSummary,
  } from '$lib/services/shells-rpc';
  import { Badge, Button, PageHeader } from '$lib/components/ui';
  import {
    AsyncBoundary,
    ConfirmDialog,
    PageBody,
    PageShell,
    type AsyncBoundaryState,
  } from '$lib/components/ui/foundations';
  import { ArrowLeft } from 'lucide-svelte';
  import { createBackNav } from '$lib/nav/back-nav.svelte';

  const back = createBackNav('/shells', m.shellDetail_allShells);
  let shell = $state<ShellSummary | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let actionRunning = $state<string | null>(null);
  let destroyOpen = $state(false);

  const shellId = $derived(page.params.shellId ?? '');

  async function refresh(): Promise<void> {
    try {
      shell = await getShell(shellId);
      loading = false;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      loading = false;
    }
  }

  onMount(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 5_000);
    return () => clearInterval(id);
  });

  async function doAction(label: string, fn: () => Promise<unknown>): Promise<void> {
    actionRunning = label;
    error = null;
    try {
      await fn();
      await refresh();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      actionRunning = null;
    }
  }

  function fmtDate(ms: number | null): string {
    if (!ms) return '—';
    return new Date(ms).toLocaleString();
  }

  function statusValue(status: ShellSummary['status']): 'success' | 'warning' | 'info' | 'error' {
    if (status === 'online') return 'success';
    if (status === 'provisioning') return 'warning';
    if (status === 'archived') return 'info';
    return 'error';
  }

  async function confirmDestroy(): Promise<void> {
    if (!shell) return;
    actionRunning = 'destroy';
    error = null;
    try {
      await destroyShell(shell.shellId);
      await goto('/shells');
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      actionRunning = null;
    }
  }

  const pageState = $derived.by<AsyncBoundaryState>(() => {
    if (loading) return { kind: 'loading', label: m.common_loading() };
    if (error && !shell) {
      return { kind: 'error', description: error, retry: () => void refresh() };
    }
    if (!shell) {
      return { kind: 'unavailable', title: m.common_error(), retry: () => void refresh() };
    }
    return { kind: 'ready' };
  });
</script>

<PageShell archetype="record-detail" scroll="none" labelledBy="shell-detail-title">
  <PageHeader
    titleId="shell-detail-title"
    title={shell?.displayName ?? 'Shell'}
    subtitle={shell ? `${shell.harness} · ${shell.vmName} · ${shell.region}` : undefined}
  >
  {#snippet leading()}
    <Button variant="ghost" size="icon" onclick={back.go} aria-label={m.shellDetail_allShells()}>
      <ArrowLeft size={16} class="text-accent shrink-0" />
    </Button>
  {/snippet}
  {#snippet primaryActions()}
    {#if shell}
      <Badge variant="semantic" value={statusValue(shell.status)} size="sm">{shell.status}</Badge>
    {/if}
  {/snippet}
  {#snippet secondaryActions()}
    {#if shell}
      {#if shell.status === 'online'}
        <Button variant="secondary" size="sm"
          disabled={actionRunning !== null}
          onclick={() => void doAction('backup', () => backupNow(shell!.shellId))}
        >
          {actionRunning === 'backup' ? m.shellDetail_backingUp() : m.shellDetail_backupNow()}
        </Button>
        <Button variant="secondary" size="sm"
          disabled={actionRunning !== null}
          onclick={() => void doAction('archive', () => archiveShell(shell!.shellId))}
        >
          {actionRunning === 'archive' ? m.shellDetail_archiving() : m.shellDetail_sleep()}
        </Button>
      {/if}
      <Button
        variant="danger"
        size="sm"
        disabled={actionRunning !== null}
        onclick={() => (destroyOpen = true)}
      >
        {m.shellDetail_destroy()}
      </Button>
    {/if}
  {/snippet}
  </PageHeader>
  <PageBody width="content" scroll="region">
    <AsyncBoundary state={pageState}>
      <div class="page">
    {#if error}
      <div class="alert" role="alert">{error}</div>
    {/if}

  {#if shell}
    {#if shell.errorMessage}
      <div class="alert">
        <strong>{shell.errorReason}</strong>: {shell.errorMessage}
      </div>
    {/if}

    <div class="grid">
      <div class="field">
        <span class="key">{m.shellDetail_disk()}</span>
        <span class="val">{shell.diskGB} GB</span>
      </div>
      <div class="field">
        <span class="key">{m.shellDetail_memory()}</span>
        <span class="val">{shell.memoryMB} MB</span>
      </div>
      <div class="field">
        <span class="key">{m.shellDetail_image()}</span>
        <span class="val mono">{shell.image}</span>
      </div>
      <div class="field">
        <span class="key">{m.shellDetail_autoArchive()}</span>
        <span class="val">
          {shell.archiveIdleMs == null ? m.shellDetail_alwaysOn() : m.shellDetail_afterHoursIdle({ hours: Math.round(shell.archiveIdleMs / 3_600_000) })}
        </span>
      </div>
      <div class="field">
        <span class="key">{m.shellDetail_backups()}</span>
        <span class="val">{shell.backupCadence}</span>
      </div>
      <div class="field">
        <span class="key">{m.shellDetail_backupTarget()}</span>
        <span class="val mono">{shell.backupTarget}</span>
      </div>
      <div class="field">
        <span class="key">{m.shellDetail_created()}</span>
        <span class="val">{fmtDate(shell.createdAt)}</span>
      </div>
      <div class="field">
        <span class="key">{m.shellDetail_lastInvoke()}</span>
        <span class="val">{fmtDate(shell.lastInvokeAt)}</span>
      </div>
      <div class="field">
        <span class="key">{m.shellDetail_lastBackup()}</span>
        <span class="val">
          {fmtDate(shell.lastBackupAt)}
          {#if shell.lastBackupBytes}
            <span class="bytes">· {(shell.lastBackupBytes / 1024 / 1024).toFixed(1)} MB</span>
          {/if}
        </span>
      </div>
    </div>

  {/if}
      </div>
    </AsyncBoundary>
  </PageBody>
</PageShell>

{#if shell}
  <ConfirmDialog
    bind:open={destroyOpen}
    title={m.shellDetail_destroy()}
    message={m.shellDetail_destroyConfirm({ name: shell.displayName })}
    confirmLabel={m.shellDetail_destroy()}
    failureMessage={error ?? m.common_error()}
    tone="danger"
    onconfirm={confirmDestroy}
  />
{/if}

<style>
  .page {
    padding: var(--space-6, 24px);
    max-width: 800px;
    margin: 0 auto;
  }
  .alert {
    padding: var(--space-3, 12px) var(--space-4, 16px);
    border-radius: var(--radius-md);
    background: var(--color-danger-surface, transparent);
    border: 1px solid var(--color-danger-border, var(--color-destructive));
    color: var(--color-danger-fg, var(--color-destructive));
    font-size: var(--font-size-body, 13px);
    margin-bottom: var(--space-4, 16px);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0;
    border: 1px solid var(--color-border-default, var(--color-border));
    border-radius: var(--radius-md);
    overflow: hidden;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 4px);
    padding: var(--space-3, 12px) var(--space-4, 16px);
    border-right: 1px solid var(--color-border-default, var(--color-border));
    border-bottom: 1px solid var(--color-border-default, var(--color-border));
  }
  .field:nth-child(2n) { border-right: none; }
  .key {
    font-size: var(--font-size-label, 11px);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-tertiary, var(--color-muted-foreground));
    font-weight: 600;
  }
  .val { font-size: var(--font-size-section-title, 14px); }
  .val.mono { font-family: var(--font-family-mono, var(--font-mono)); font-size: var(--font-size-mono, 12px); }
  .bytes {
    color: var(--color-text-tertiary, var(--color-muted-foreground));
    font-size: var(--font-size-caption, 12px);
  }
  @media (max-width: 767.98px) {
    .page {
      padding: var(--space-page-gutter, 16px);
    }
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .field,
    .field:nth-child(2n) {
      border-right: 0;
    }
  }
</style>
