<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidate } from '$app/navigation';
  import * as m from '$lib/paraglide/messages';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { hostsState } from '$lib/state/features/hosts.svelte';
  import { Button } from '$lib/components/ui';
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
    enabled?: number | null;
  }
  interface Props {
    initialConfig?: BackupConfigShape | null;
  }
  let { initialConfig }: Props = $props();
  const hasServerData = $derived(initialConfig !== undefined);

  // ─── Backup config state ───────────────────────────────────────
  let backupHost = $state(initialConfig?.backupHost ?? '');
  let backupUser = $state(initialConfig?.backupUser ?? 'root');
  let backupPort = $state(initialConfig?.backupPort ?? 22);
  let backupBasePath = $state(initialConfig?.backupBasePath ?? '/mnt/agent-data/backups');
  let schedule = $state(initialConfig?.schedule ?? '');
  let retentionCount = $state(initialConfig?.retentionCount ?? 7);
  let enabled = $state(!!initialConfig?.enabled);
  let configLoaded = $state(hasServerData);
  let saving = $state(false);
  let testing = $state(false);
  let testResult = $state<{ ok: boolean; message: string } | null>(null);

  // ─── Snapshots state ──────────────────────────────────────────
  interface Snapshot {
    id: string;
    serverId: string;
    snapshotPath: string;
    timestamp: number;
    sizeBytes: number | null;
    status: string;
    createdAt: number;
  }
  let snapshots = $state<Snapshot[]>([]);
  let loadingSnapshots = $state(false);

  // ─── Streaming state ──────────────────────────────────────────
  let running = $state(false);
  let runningAction = $state<'backup' | 'restore' | null>(null);
  let logLines = $state<string[]>([]);
  let logContainer: HTMLElement | undefined = $state();

  // ─── Confirm restore dialog ───────────────────────────────────
  let confirmRestore = $state<Snapshot | null>(null);

  // ─── Load backup config ───────────────────────────────────────
  async function loadConfig() {
    try {
      const res = await fetch('/api/backup-config');
      const data = await res.json();
      if (data.config) {
        backupHost = data.config.backupHost ?? '';
        backupUser = data.config.backupUser ?? 'root';
        backupPort = data.config.backupPort ?? 22;
        backupBasePath = data.config.backupBasePath ?? '/mnt/agent-data/backups';
        schedule = data.config.schedule ?? '';
        retentionCount = data.config.retentionCount ?? 7;
        enabled = !!data.config.enabled;
      }
      configLoaded = true;
    } catch (e) {
      console.error('Failed to load backup config:', e);
    }
  }

  // ─── Save backup config ───────────────────────────────────────
  async function saveConfig() {
    saving = true;
    try {
      await fetch('/api/backup-config', {
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
      });
      void invalidate('settings:backups');
    } catch (e) {
      console.error('Failed to save backup config:', e);
    } finally {
      saving = false;
    }
  }

  // ─── Test connection ──────────────────────────────────────────
  async function testConnection() {
    testing = true;
    testResult = null;
    try {
      const res = await fetch('/api/backup-config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupHost, backupUser, backupPort, backupBasePath }),
      });
      testResult = await res.json();
    } catch {
      testResult = { ok: false, message: m.backup_requestFailed() };
    } finally {
      testing = false;
    }
  }

  // ─── Load snapshots ──────────────────────────────────────────
  async function loadSnapshots() {
    if (!hostsState.activeHostId) return;
    loadingSnapshots = true;
    try {
      const res = await fetch(`/api/servers/${hostsState.activeHostId}/backups`);
      const data = await res.json();
      snapshots = data.snapshots ?? [];
    } catch (e) {
      console.error('Failed to load snapshots:', e);
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
    confirmRestore = null;
    running = true;
    runningAction = 'restore';
    logLines = [];

    try {
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
    try {
      await fetch(`/api/servers/${hostsState.activeHostId}/backups/${snapshot.id}`, { method: 'DELETE' });
      snapshots = snapshots.filter((s) => s.id !== snapshot.id);
    } catch (e) {
      console.error('Failed to delete snapshot:', e);
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

  function formatDate(ts: number): string {
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
      <DatabaseBackup size={13} class="text-muted-foreground/70" />
      {m.backup_destination()}
    </h2>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.backup_host()}</span>
        <input
          type="text"
          bind:value={backupHost}
          placeholder="backup.example.com"
          class="mt-1 w-full bg-bg3 border border-border rounded-[5px] text-foreground py-[5px] px-[9px] text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.backup_user()}</span>
        <input
          type="text"
          bind:value={backupUser}
          class="mt-1 w-full bg-bg3 border border-border rounded-[5px] text-foreground py-[5px] px-[9px] text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.backup_port()}</span>
        <input
          type="number"
          bind:value={backupPort}
          class="mt-1 w-full bg-bg3 border border-border rounded-[5px] text-foreground py-[5px] px-[9px] text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.backup_basePath()}</span>
        <input
          type="text"
          bind:value={backupBasePath}
          class="mt-1 w-full bg-bg3 border border-border rounded-[5px] text-foreground py-[5px] px-[9px] text-sm focus:outline-none focus:ring-1 focus:ring-accent"
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
          class="mt-1 w-full bg-bg3 border border-border rounded-[5px] text-foreground py-[5px] px-[9px] text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.backup_keepLast()}</span>
        <input
          type="number"
          bind:value={retentionCount}
          min="1"
          class="mt-1 w-full bg-bg3 border border-border rounded-[5px] text-foreground py-[5px] px-[9px] text-sm focus:outline-none focus:ring-1 focus:ring-accent"
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
        <span class="text-xs {testResult.ok ? 'text-green-400' : 'text-destructive'}">
          {testResult.message}
        </span>
      {/if}
    </div>
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
                    <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium
                      {snapshot.status === 'complete' ? 'bg-green-500/10 text-green-400' :
                       snapshot.status === 'failed' ? 'bg-red-500/10 text-red-400' :
                       'bg-yellow-500/10 text-yellow-400'}">
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
          class="bg-bg font-mono text-[11px] text-muted-foreground p-3 rounded border border-border max-h-64 overflow-y-auto"
        >
          {#each logLines as line, i (i)}
            <div class="whitespace-pre-wrap">{line}</div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Confirm restore dialog -->
    {#if confirmRestore}
      <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
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
