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
  import { PageHeader } from '$lib/components/ui';
  import { ArrowLeft } from 'lucide-svelte';

  let shell = $state<ShellSummary | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let actionRunning = $state<string | null>(null);

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
</script>

<PageHeader
  title={shell?.displayName ?? 'Shell'}
  subtitle={shell ? `${shell.harness} · ${shell.vmName} · ${shell.region}` : undefined}
>
  {#snippet leading()}
    <a class="back" href="/shells" aria-label={m.shellDetail_allShells()}>
      <ArrowLeft size={16} class="text-accent shrink-0" />
    </a>
  {/snippet}
  {#snippet actions()}
    {#if shell}
      <div class="status status-{shell.status}">{shell.status}</div>
      {#if shell.status === 'online'}
        <button
          disabled={actionRunning !== null}
          onclick={() => void doAction('backup', () => backupNow(shell!.shellId))}
        >
          {actionRunning === 'backup' ? m.shellDetail_backingUp() : m.shellDetail_backupNow()}
        </button>
        <button
          disabled={actionRunning !== null}
          onclick={() => void doAction('archive', () => archiveShell(shell!.shellId))}
        >
          {actionRunning === 'archive' ? m.shellDetail_archiving() : m.shellDetail_sleep()}
        </button>
      {/if}
      <button
        class="danger"
        disabled={actionRunning !== null}
        onclick={async () => {
          if (!confirm(m.shellDetail_destroyConfirm({ name: shell!.displayName }))) {
            return;
          }
          await doAction('destroy', () => destroyShell(shell!.shellId));
          await goto('/shells');
        }}
      >
        {m.shellDetail_destroy()}
      </button>
    {/if}
  {/snippet}
</PageHeader>
<main class="flex-1 min-h-0 overflow-y-auto">
  <div class="page">
  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if loading}
    <div class="empty">{m.common_loading()}</div>
  {:else if shell}
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
</main>

<style>
  .page {
    padding: 24px;
    max-width: 800px;
    margin: 0 auto;
  }
  .back {
    display: inline-flex;
    align-items: center;
    color: var(--color-text-muted, #6b7280);
    text-decoration: none;
  }
  .back:hover { color: var(--color-text, inherit); }
  .status {
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .status-online { background: rgba(34, 197, 94, 0.15); color: rgb(22, 163, 74); }
  .status-provisioning { background: rgba(245, 158, 11, 0.15); color: rgb(180, 83, 9); }
  .status-archived { background: rgba(156, 163, 175, 0.2); color: rgb(75, 85, 99); }
  .status-error { background: rgba(239, 68, 68, 0.15); color: rgb(185, 28, 28); }
  .alert {
    padding: 12px 16px;
    border-radius: 6px;
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid rgba(239, 68, 68, 0.2);
    color: rgb(185, 28, 28);
    font-size: 13px;
    margin-bottom: 16px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0;
    border: 1px solid var(--color-border, #e5e7eb);
    border-radius: 6px;
    overflow: hidden;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px 16px;
    border-right: 1px solid var(--color-border, #e5e7eb);
    border-bottom: 1px solid var(--color-border, #e5e7eb);
  }
  .field:nth-child(2n) { border-right: none; }
  .key {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-muted, #6b7280);
    font-weight: 600;
  }
  .val { font-size: 14px; }
  .val.mono { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; }
  .bytes {
    color: var(--color-text-muted, #6b7280);
    font-size: 12px;
  }
  button {
    padding: 6px 12px;
    border: 1px solid var(--color-border, #e5e7eb);
    border-radius: 6px;
    background: var(--color-bg2, white);
    cursor: pointer;
    font-size: 13px;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  button.danger {
    color: rgb(185, 28, 28);
    border-color: rgba(239, 68, 68, 0.3);
  }
  button.danger:hover {
    background: rgba(239, 68, 68, 0.05);
  }
  .empty, .error {
    padding: 48px 24px;
    text-align: center;
    color: var(--color-text-muted, #6b7280);
  }
  .error {
    color: rgb(185, 28, 28);
  }
</style>
