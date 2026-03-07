<script lang="ts">
  import { onMount } from 'svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { hostsState } from '$lib/state/features/hosts.svelte';
  import {
    DatabaseBackup,
    Play,
    RotateCcw,
    Trash2,
    TestTube,
    Save,
    Loader2,
  } from 'lucide-svelte';

  // ─── Backup config state ───────────────────────────────────────
  let backupHost = $state('');
  let backupUser = $state('root');
  let backupPort = $state(22);
  let backupBasePath = $state('/mnt/agent-data/backups');
  let schedule = $state('');
  let retentionCount = $state(7);
  let enabled = $state(false);
  let configLoaded = $state(false);
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
      testResult = { ok: false, message: 'Request failed' };
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
    loadConfig();
  });

  $effect(() => {
    if (hostsState.activeHostId) loadSnapshots();
  });
</script>

<div class="space-y-4">
  <!-- Backup Destination Config -->
  <div class="bg-card border border-border rounded-lg px-5 py-4">
    <h2 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
      <DatabaseBackup size={13} class="text-muted-foreground/70" />
      Backup Destination
    </h2>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label class="block">
        <span class="text-xs text-muted-foreground">Host</span>
        <input
          type="text"
          bind:value={backupHost}
          placeholder="backup.example.com"
          class="mt-1 w-full bg-bg3 border border-border rounded-[5px] text-foreground py-[5px] px-[9px] text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">User</span>
        <input
          type="text"
          bind:value={backupUser}
          class="mt-1 w-full bg-bg3 border border-border rounded-[5px] text-foreground py-[5px] px-[9px] text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">Port</span>
        <input
          type="number"
          bind:value={backupPort}
          class="mt-1 w-full bg-bg3 border border-border rounded-[5px] text-foreground py-[5px] px-[9px] text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">Base Path</span>
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
        <span class="text-xs text-muted-foreground">Schedule (cron)</span>
        <input
          type="text"
          bind:value={schedule}
          placeholder="0 3 * * *"
          class="mt-1 w-full bg-bg3 border border-border rounded-[5px] text-foreground py-[5px] px-[9px] text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">Keep last N</span>
        <input
          type="number"
          bind:value={retentionCount}
          min="1"
          class="mt-1 w-full bg-bg3 border border-border rounded-[5px] text-foreground py-[5px] px-[9px] text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>
      <label class="flex items-center gap-2 self-end pb-1">
        <input type="checkbox" bind:checked={enabled} class="accent-accent" />
        <span class="text-xs text-muted-foreground">Enable scheduled backups</span>
      </label>
    </div>

    <!-- Actions -->
    <div class="flex items-center gap-2 mt-4">
      <button
        type="button"
        class="flex items-center gap-1.5 bg-accent border-none rounded-[5px] text-white cursor-pointer font-[inherit] text-xs font-semibold py-[6px] px-3 disabled:opacity-50"
        onclick={saveConfig}
        disabled={saving}
      >
        <Save size={12} />
        {saving ? 'Saving...' : 'Save'}
      </button>
      <button
        type="button"
        class="flex items-center gap-1.5 bg-bg3 border border-border rounded-[5px] text-foreground cursor-pointer font-[inherit] text-xs font-medium py-[5px] px-3 hover:border-muted-foreground disabled:opacity-50"
        onclick={testConnection}
        disabled={testing || !backupHost}
      >
        <TestTube size={12} />
        {testing ? 'Testing...' : 'Test Connection'}
      </button>
      {#if testResult}
        <span class="text-xs {testResult.ok ? 'text-green-400' : 'text-destructive'}">
          {testResult.message}
        </span>
      {/if}
    </div>
  </div>

  <!-- Per-Server Backups -->
  {#if !conn.connected}
    <div class="bg-card border border-border rounded-lg px-5 py-8 text-center">
      <p class="text-sm text-muted-foreground">Connect to a host to manage backups</p>
    </div>
  {:else}
    <div class="bg-card border border-border rounded-lg px-5 py-4">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-2">
          Snapshots
        </h2>
        <button
          type="button"
          class="flex items-center gap-1.5 bg-accent border-none rounded-[5px] text-white cursor-pointer font-[inherit] text-xs font-semibold py-[6px] px-3 disabled:opacity-50"
          onclick={startBackup}
          disabled={running || !backupHost}
        >
          {#if running && runningAction === 'backup'}
            <Loader2 size={12} class="animate-spin" />
            Backing up...
          {:else}
            <Play size={12} />
            Backup Now
          {/if}
        </button>
      </div>

      <!-- Snapshot table -->
      {#if snapshots.length > 0}
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead>
              <tr class="text-muted-foreground border-b border-border">
                <th class="text-left py-2 px-2 font-medium">Date</th>
                <th class="text-left py-2 px-2 font-medium">Size</th>
                <th class="text-left py-2 px-2 font-medium">Status</th>
                <th class="text-right py-2 px-2 font-medium">Actions</th>
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
                        <button
                          type="button"
                          class="p-1 rounded hover:bg-bg3 text-muted-foreground hover:text-foreground transition-colors"
                          title="Restore"
                          onclick={() => (confirmRestore = snapshot)}
                          disabled={running}
                        >
                          <RotateCcw size={13} />
                        </button>
                      {/if}
                      <button
                        type="button"
                        class="p-1 rounded hover:bg-bg3 text-muted-foreground hover:text-destructive transition-colors"
                        title="Delete"
                        onclick={() => deleteSnapshot(snapshot)}
                        disabled={running}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else if !loadingSnapshots}
        <p class="text-xs text-muted-foreground text-center py-4">No snapshots yet</p>
      {/if}
    </div>

    <!-- Streaming log output -->
    {#if logLines.length > 0}
      <div class="bg-card border border-border rounded-lg px-5 py-4">
        <h2 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
          {runningAction === 'restore' ? 'Restore' : 'Backup'} Log
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
        <div class="bg-card border border-border rounded-lg p-6 max-w-sm mx-4">
          <h3 class="text-sm font-semibold text-foreground mb-2">Confirm Restore</h3>
          <p class="text-xs text-muted-foreground mb-4">
            This will overwrite the current .minion directory on the gateway with the snapshot
            from {formatDate(confirmRestore.timestamp)} and restart the gateway service.
          </p>
          <div class="flex justify-end gap-2">
            <button
              type="button"
              class="bg-bg3 border border-border rounded-[5px] text-foreground cursor-pointer font-[inherit] text-xs font-medium py-[5px] px-3"
              onclick={() => (confirmRestore = null)}
            >
              Cancel
            </button>
            <button
              type="button"
              class="bg-destructive border-none rounded-[5px] text-white cursor-pointer font-[inherit] text-xs font-semibold py-[6px] px-3"
              onclick={() => startRestore(confirmRestore!)}
            >
              Restore
            </button>
          </div>
        </div>
      </div>
    {/if}
  {/if}
</div>
