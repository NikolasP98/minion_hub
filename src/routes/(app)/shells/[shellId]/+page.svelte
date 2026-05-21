<script lang="ts">
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

<div class="page">
  <a class="back" href="/shells">← All shells</a>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if loading}
    <div class="empty">Loading…</div>
  {:else if shell}
    <header>
      <div>
        <h1>{shell.displayName}</h1>
        <p class="subtitle">{shell.harness} · {shell.vmName} · {shell.region}</p>
      </div>
      <div class="status status-{shell.status}">{shell.status}</div>
    </header>

    {#if shell.errorMessage}
      <div class="alert">
        <strong>{shell.errorReason}</strong>: {shell.errorMessage}
      </div>
    {/if}

    <div class="grid">
      <div class="field">
        <span class="key">Disk</span>
        <span class="val">{shell.diskGB} GB</span>
      </div>
      <div class="field">
        <span class="key">Memory</span>
        <span class="val">{shell.memoryMB} MB</span>
      </div>
      <div class="field">
        <span class="key">Image</span>
        <span class="val mono">{shell.image}</span>
      </div>
      <div class="field">
        <span class="key">Auto-archive</span>
        <span class="val">
          {shell.archiveIdleMs == null ? 'Always on' : `After ${Math.round(shell.archiveIdleMs / 3_600_000)}h idle`}
        </span>
      </div>
      <div class="field">
        <span class="key">Backups</span>
        <span class="val">{shell.backupCadence}</span>
      </div>
      <div class="field">
        <span class="key">Backup target</span>
        <span class="val mono">{shell.backupTarget}</span>
      </div>
      <div class="field">
        <span class="key">Created</span>
        <span class="val">{fmtDate(shell.createdAt)}</span>
      </div>
      <div class="field">
        <span class="key">Last invoke</span>
        <span class="val">{fmtDate(shell.lastInvokeAt)}</span>
      </div>
      <div class="field">
        <span class="key">Last backup</span>
        <span class="val">
          {fmtDate(shell.lastBackupAt)}
          {#if shell.lastBackupBytes}
            <span class="bytes">· {(shell.lastBackupBytes / 1024 / 1024).toFixed(1)} MB</span>
          {/if}
        </span>
      </div>
    </div>

    <div class="actions">
      {#if shell.status === 'online'}
        <button
          disabled={actionRunning !== null}
          onclick={() => void doAction('backup', () => backupNow(shell!.shellId))}
        >
          {actionRunning === 'backup' ? 'Backing up…' : 'Back up now'}
        </button>
        <button
          disabled={actionRunning !== null}
          onclick={() => void doAction('archive', () => archiveShell(shell!.shellId))}
        >
          {actionRunning === 'archive' ? 'Archiving…' : 'Sleep (archive)'}
        </button>
      {/if}
      <button
        class="danger"
        disabled={actionRunning !== null}
        onclick={async () => {
          if (!confirm(`Permanently destroy ${shell!.displayName}? This deletes the VM and all backups.`)) {
            return;
          }
          await doAction('destroy', () => destroyShell(shell!.shellId));
          await goto('/shells');
        }}
      >
        Destroy
      </button>
    </div>
  {/if}
</div>

<style>
  .page {
    padding: 24px;
    max-width: 800px;
    margin: 0 auto;
  }
  .back {
    display: inline-block;
    margin-bottom: 16px;
    color: var(--color-text-muted, #6b7280);
    text-decoration: none;
    font-size: 13px;
  }
  .back:hover { text-decoration: underline; }
  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 24px;
  }
  h1 {
    margin: 0;
    font-size: 24px;
    font-weight: 600;
  }
  .subtitle {
    margin: 4px 0 0;
    font-size: 13px;
    color: var(--color-text-muted, #6b7280);
  }
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
  .actions {
    margin-top: 20px;
    display: flex;
    gap: 8px;
  }
  .actions button {
    padding: 8px 14px;
    border: 1px solid var(--color-border, #e5e7eb);
    border-radius: 6px;
    background: white;
    cursor: pointer;
    font-size: 13px;
  }
  .actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .actions button.danger {
    margin-left: auto;
    color: rgb(185, 28, 28);
    border-color: rgba(239, 68, 68, 0.3);
  }
  .actions button.danger:hover {
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
