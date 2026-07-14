<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidate } from '$app/navigation';
  import * as m from '$lib/paraglide/messages';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { hostsState } from '$lib/state/features/hosts.svelte';
  import { Button } from '$lib/components/ui';
  import { fetchJson } from '$lib/api/fetch-json';
  import { jsonMutation, mutationErrorMessage } from '$lib/api/json-mutation';
  import {
    DatabaseBackup,
    Play,
    RotateCcw,
    Trash2,
    TestTube,
    Save,
  } from 'lucide-svelte';

  // Server-loaded initial config (from /settings/backups/+page.server.ts).
  // null = no config row yet; undefined = legacy embedded usage (fall back to fetch).
  interface BackupConfigShape {
    backupHost?: string | null;
    backupUser?: string | null;
    backupPort?: number | null;
    backupBasePath?: string | null;
    schedule?: string | null;
    retentionCount?: number | null;
    enabled?: boolean | null;
  }
  interface Props {
    initialConfig?: BackupConfigShape | null;
  }
  let { initialConfig }: Props = $props();
  const hasServerData = $derived(initialConfig !== undefined);

  // ─── Backup config state ───────────────────────────────────────
  // svelte-ignore state_referenced_locally
  let backupHost = $state(initialConfig?.backupHost ?? '');
  // svelte-ignore state_referenced_locally
  let backupUser = $state(initialConfig?.backupUser ?? 'root');
  // svelte-ignore state_referenced_locally
  let backupPort = $state(initialConfig?.backupPort ?? 22);
  // svelte-ignore state_referenced_locally
  let backupBasePath = $state(initialConfig?.backupBasePath ?? '/mnt/agent-data/backups');
  // svelte-ignore state_referenced_locally
  let schedule = $state(initialConfig?.schedule ?? '');
  // svelte-ignore state_referenced_locally
  let retentionCount = $state(initialConfig?.retentionCount ?? 7);
  // svelte-ignore state_referenced_locally
  let enabled = $state(!!initialConfig?.enabled);
  let saving = $state(false);
  let testing = $state(false);
  let testResult = $state<{ ok: boolean; message: string } | null>(null);
  let configError = $state<string | null>(null);

  // ─── Snapshots state ──────────────────────────────────────────
  interface Snapshot {
    id: string;
    serverId: string;
    snapshotPath: string;
    // Postgres timestamps arrive as ISO strings over the API.
    timestamp: string;
    sizeBytes: number | null;
    status: string;
    createdAt: string;
  }
  let snapshots = $state<Snapshot[]>([]);
  let loadingSnapshots = $state(false);
  let snapshotError = $state<string | null>(null);

  // ─── Streaming state ──────────────────────────────────────────
  let running = $state(false);
  let runningAction = $state<'backup' | 'restore' | null>(null);
  let logLines = $state<string[]>([]);
  let logContainer: HTMLElement | undefined = $state();

  // ─── Confirm restore dialog ───────────────────────────────────
  let confirmRestore = $state<Snapshot | null>(null);

  // ─── Load backup config ───────────────────────────────────────
  async function loadConfig() {
    configError = null;
    try {
      const data = await fetchJson<{ config?: BackupConfigShape | null }>('/api/backup-config');
      if (data.config) {
        backupHost = data.config.backupHost ?? '';
        backupUser = data.config.backupUser ?? 'root';
        backupPort = data.config.backupPort ?? 22;
        backupBasePath = data.config.backupBasePath ?? '/mnt/agent-data/backups';
        schedule = data.config.schedule ?? '';
        retentionCount = data.config.retentionCount ?? 7;
        enabled = !!data.config.enabled;
      }
    } catch (e) {
      configError = mutationErrorMessage(e, m.backup_requestFailed());
    }
  }

  // ─── Save backup config ───────────────────────────────────────
  async function saveConfig() {
    saving = true;
    configError = null;
    try {
      await jsonMutation({
        input: '/api/backup-config',
        init: {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            backupHost,
            backupUser,
            backupPort,
            backupBasePath,
            schedule: schedule || null,
            retentionCount,
            enabled: enabled ? 1 : 0,
          }),
        },
        onSuccess: () => invalidate('settings:backups'),
      });
    } catch (e) {
      configError = mutationErrorMessage(e, m.backup_requestFailed());
    } finally {
      saving = false;
    }
  }

  // ─── Test connection ──────────────────────────────────────────
  async function testConnection() {
    testing = true;
    testResult = null;
    try {
      testResult = await fetchJson<{ ok: boolean; message: string }>('/api/backup-config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupHost, backupUser, backupPort, backupBasePath }),
      });
    } catch (error) {
      testResult = { ok: false, message: mutationErrorMessage(error, m.backup_requestFailed()) };
    } finally {
      testing = false;
    }
  }

  // ─── Load snapshots ──────────────────────────────────────────
  async function loadSnapshots() {
    if (!hostsState.activeHostId) return;
    loadingSnapshots = true;
    snapshotError = null;
    try {
      const data = await fetchJson<{ snapshots?: Snapshot[] }>(`/api/servers/${hostsState.activeHostId}/backups`);
      snapshots = data.snapshots ?? [];
    } catch (e) {
      snapshotError = mutationErrorMessage(e, m.backup_requestFailed());
    } finally {
      loadingSnapshots = false;
    }
  }

  // ─── Run backup (SSE) ────────────────────────────────────────
  async function startBackup() {
    if (!hostsState.activeHostId || running) return;
    running = true;
    runningAction = 'backup';
    logLines = [];

    try {
      // INTENTIONAL RAW FETCH: successful response is an SSE stream consumed by readSSE.
      const res = await fetch(`/api/servers/${hostsState.activeHostId}/backups/run`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        logLines = [`Error: ${err.error}`];
        running = false;
        runningAction = null;
        return;
      }
      await readSSE(res);
    } catch (e) {
      logLines = [...logLines, `Error: ${e}`];
    } finally {
      running = false;
      runningAction = null;
      loadSnapshots();
    }
  }

  // ─── Run restore (SSE) ───────────────────────────────────────
  async function startRestore(snapshot: Snapshot) {
    if (!hostsState.activeHostId || running) return;
    running = true;
    runningAction = 'restore';
    logLines = [];

    try {
      // INTENTIONAL RAW FETCH: successful response is an SSE stream consumed by readSSE.
      const res = await fetch(`/api/servers/${hostsState.activeHostId}/backups/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotPath: snapshot.snapshotPath }),
      });
      if (!res.ok) {
        const err = await res.json();
        logLines = [`Error: ${err.error}`];
        running = false;
        runningAction = null;
        return;
      }
      confirmRestore = null;
      await readSSE(res);
    } catch (e) {
      logLines = [...logLines, `Error: ${e}`];
    } finally {
      running = false;
      runningAction = null;
    }
  }

  // ─── Delete snapshot ──────────────────────────────────────────
  async function deleteSnapshot(snapshot: Snapshot) {
    if (!hostsState.activeHostId) return;
    snapshotError = null;
    try {
      await jsonMutation({
        input: `/api/servers/${hostsState.activeHostId}/backups/${snapshot.id}`,
        init: { method: 'DELETE' },
        onSuccess: () => {
          snapshots = snapshots.filter((s) => s.id !== snapshot.id);
        },
      });
    } catch (e) {
      snapshotError = mutationErrorMessage(e, m.backup_requestFailed());
    }
  }

  // ─── SSE reader ───────────────────────────────────────────────
  async function readSSE(res: Response) {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';

      for (const part of parts) {
        for (const line of part.split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.line) {
                logLines = [...logLines, data.line];
                requestAnimationFrame(() => {
                  if (logContainer) logContainer.scrollTop = logContainer.scrollHeight;
                });
              }
            } catch { /* ignore parse errors */ }
          }
        }
      }
    }
  }

  // ─── Format helpers ───────────────────────────────────────────
  function formatBytes(bytes: number | null): string {
    if (bytes == null) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function formatDate(ts: string | number): string {
    return new Date(ts).toLocaleString();
  }

  // ─── Lifecycle ────────────────────────────────────────────────
  onMount(() => {
    if (!hasServerData) loadConfig();
  });

  $effect(() => {
    if (hostsState.activeHostId) loadSnapshots();
  });
</script>

<div class="space-y-4">
  <!-- Backup Destination Config -->
  <div class="surface-2 rounded-lg px-5 py-4">
    <h2 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
      <DatabaseBackup size={13} class="text-muted-strong" />
      {m.backup_destination()}
    </h2>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.backup_host()}</span>
        <input
          type="text"
          bind:value={backupHost}
          placeholder="backup.example.com"
          class="mt-1 w-full bg-bg3 border border-border rounded-[var(--radius-sm)] text-foreground py-[var(--space-1)] px-[var(--space-2)] text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.backup_user()}</span>
        <input
          type="text"
          bind:value={backupUser}
          class="mt-1 w-full bg-bg3 border border-border rounded-[var(--radius-sm)] text-foreground py-[var(--space-1)] px-[var(--space-2)] text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.backup_port()}</span>
        <input
          type="number"
          bind:value={backupPort}
          class="mt-1 w-full bg-bg3 border border-border rounded-[var(--radius-sm)] text-foreground py-[var(--space-1)] px-[var(--space-2)] text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.backup_basePath()}</span>
        <input
          type="text"
          bind:value={backupBasePath}
          class="mt-1 w-full bg-bg3 border border-border rounded-[var(--radius-sm)] text-foreground py-[var(--space-1)] px-[var(--space-2)] text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>
    </div>

    <!-- Schedule & Retention -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.backup_schedule()}</span>
        <input
          type="text"
          bind:value={schedule}
          placeholder="0 3 * * *"
          class="mt-1 w-full bg-bg3 border border-border rounded-[var(--radius-sm)] text-foreground py-[var(--space-1)] px-[var(--space-2)] text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.backup_keepLast()}</span>
        <input
          type="number"
          bind:value={retentionCount}
          min="1"
          class="mt-1 w-full bg-bg3 border border-border rounded-[var(--radius-sm)] text-foreground py-[var(--space-1)] px-[var(--space-2)] text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>
      <label class="flex items-center gap-2 self-end pb-1">
        <input type="checkbox" bind:checked={enabled} class="accent-accent" />
        <span class="text-xs text-muted-foreground">{m.backup_enableScheduled()}</span>
      </label>
    </div>

    <!-- Actions -->
    <div class="flex items-center gap-2 mt-4">
      <Button variant="primary" size="sm" loading={saving} onclick={saveConfig}>
        {#snippet icon()}<Save size={12} />{/snippet}
        {saving ? m.backup_saving() : m.common_save()}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        loading={testing}
        disabled={!backupHost}
        onclick={testConnection}
      >
        {#snippet icon()}<TestTube size={12} />{/snippet}
        {testing ? m.backup_testing() : m.backup_testConnection()}
      </Button>
      {#if testResult}
        <span class="text-xs {testResult.ok ? 'text-success' : 'text-destructive'}">
          {testResult.message}
        </span>
      {/if}
    </div>
    {#if configError}
      <p class="mt-3 text-xs text-destructive" role="alert">{configError}</p>
    {/if}
  </div>

  <!-- Per-Server Backups -->
  {#if !conn.connected}
    <div class="surface-2 rounded-lg px-5 py-8 text-center">
      <p class="text-sm text-muted-foreground">{m.backup_connectToManage()}</p>
    </div>
  {:else}
    <div class="surface-2 rounded-lg px-5 py-4">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-2">
          {m.backup_snapshots()}
        </h2>
        <Button
          variant="primary"
          size="sm"
          loading={running && runningAction === 'backup'}
          disabled={running || !backupHost}
          onclick={startBackup}
        >
          {#snippet icon()}<Play size={12} />{/snippet}
          {running && runningAction === 'backup' ? m.backup_backingUp() : m.backup_backupNow()}
        </Button>
      </div>

      {#if snapshotError}
        <p class="mb-3 text-xs text-destructive" role="alert">{snapshotError}</p>
      {/if}

      <!-- Snapshot table -->
      {#if snapshots.length > 0}
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead>
              <tr class="text-muted-foreground border-b border-border">
                <th class="text-left py-2 px-2 font-medium">{m.backup_colDate()}</th>
                <th class="text-left py-2 px-2 font-medium">{m.backup_colSize()}</th>
                <th class="text-left py-2 px-2 font-medium">{m.backup_colStatus()}</th>
                <th class="text-right py-2 px-2 font-medium">{m.backup_colActions()}</th>
              </tr>
            </thead>
            <tbody>
              {#each snapshots as snapshot (snapshot.id)}
                <tr class="border-b border-border/50 hover:bg-bg3/50">
                  <td class="py-2 px-2 text-foreground">{formatDate(snapshot.timestamp)}</td>
                  <td class="py-2 px-2 text-muted-foreground">{formatBytes(snapshot.sizeBytes)}</td>
                  <td class="py-2 px-2">
                    <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[length:var(--font-size-telemetry)] font-medium
                      {snapshot.status === 'complete' ? 'bg-success/15 text-success' :
                       snapshot.status === 'failed' ? 'bg-destructive/10 text-destructive' :
                       'bg-warning/10 text-warning'}">
                      {snapshot.status}
                    </span>
                  </td>
                  <td class="py-2 px-2 text-right">
                    <div class="flex items-center justify-end gap-1">
                      {#if snapshot.status === 'complete'}
                        <Button
                          variant="ghost"
                          size="icon"
                          title={m.backup_restore()}
                          aria-label={m.backup_restore()}
                          onclick={() => (confirmRestore = snapshot)}
                          disabled={running}
                        >
                          {#snippet icon()}<RotateCcw size={13} />{/snippet}
                        </Button>
                      {/if}
                      <Button
                        variant="ghost"
                        size="icon"
                        class="hover:text-destructive"
                        title={m.common_delete()}
                        aria-label={m.common_delete()}
                        onclick={() => deleteSnapshot(snapshot)}
                        disabled={running}
                      >
                        {#snippet icon()}<Trash2 size={13} />{/snippet}
                      </Button>
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else if !loadingSnapshots}
        <p class="text-xs text-muted-foreground text-center py-4">{m.backup_noSnapshots()}</p>
      {/if}
    </div>

    <!-- Streaming log output -->
    {#if logLines.length > 0}
      <div class="surface-2 rounded-lg px-5 py-4">
        <h2 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
          {runningAction === 'restore' ? m.backup_restore() : m.backup_backupNow()} {m.backup_log()}
        </h2>
        <div
          bind:this={logContainer}
          class="bg-bg font-mono text-[length:var(--font-size-label)] text-muted-foreground p-3 rounded border border-border max-h-64 overflow-y-auto"
        >
          {#each logLines as line, i (i)}
            <div class="whitespace-pre-wrap">{line}</div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Confirm restore dialog -->
    {#if confirmRestore}
      <div class="fixed inset-0 bg-[var(--color-overlay)] flex items-center justify-center z-[var(--layer-modal)]">
        <div class="surface-2 rounded-lg p-6 max-w-sm mx-4">
          <h3 class="text-sm font-semibold text-foreground mb-2">{m.backup_confirmRestoreTitle()}</h3>
          <p class="text-xs text-muted-foreground mb-4">
            {m.backup_confirmRestoreBody({ date: formatDate(confirmRestore.timestamp) })}
          </p>
          <div class="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onclick={() => (confirmRestore = null)}>
              {m.common_cancel()}
            </Button>
            <Button variant="danger" size="sm" onclick={() => startRestore(confirmRestore!)}>
              {m.backup_restore()}
            </Button>
          </div>
        </div>
      </div>
    {/if}
  {/if}
</div>
