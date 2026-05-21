<script lang="ts">
  import { provisionShell, type ShellsProvisionResponse } from '$lib/services/shells-rpc';

  let { onProvisioned }: { onProvisioned: (res: ShellsProvisionResponse) => void } = $props();

  let displayName = $state('');
  let harness = $state<'hermes' | 'claude-code' | 'codex'>('hermes');
  let region = $state('lax');
  let diskGB = $state(4);
  let memoryMB = $state(512);
  let archivePolicy = $state<'24h' | 'always-on'>('24h');
  let backupCadence = $state<'hourly' | 'daily' | 'weekly' | 'manual'>('daily');
  let initialPrompt = $state('');
  let submitting = $state(false);
  let error = $state<string | null>(null);

  async function submit(evt: SubmitEvent): Promise<void> {
    evt.preventDefault();
    if (!displayName.trim()) {
      error = 'Display name is required';
      return;
    }
    submitting = true;
    error = null;
    try {
      const res = await provisionShell({
        displayName: displayName.trim(),
        harness,
        region,
        diskGB,
        memoryMB,
        archiveIdleMs: archivePolicy === 'always-on' ? null : 24 * 60 * 60 * 1000,
        backupCadence,
        initialPrompt: initialPrompt.trim() || undefined,
      });
      onProvisioned(res);
      displayName = '';
      initialPrompt = '';
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      submitting = false;
    }
  }
</script>

<form onsubmit={submit}>
  <h2>Spin up a shell</h2>
  {#if error}
    <div class="error">{error}</div>
  {/if}
  <label>
    Display name
    <input bind:value={displayName} type="text" placeholder="e.g. research assistant" required />
  </label>
  <div class="row">
    <label>
      Harness
      <select bind:value={harness}>
        <option value="hermes">HERMES</option>
        <option value="claude-code">Claude Code</option>
        <option value="codex">Codex</option>
      </select>
    </label>
    <label>
      Region
      <select bind:value={region}>
        <option value="lax">LAX (Los Angeles)</option>
        <option value="lon">LON (London)</option>
        <option value="fra">FRA (Frankfurt)</option>
      </select>
    </label>
  </div>
  <div class="row">
    <label>
      Disk
      <select bind:value={diskGB}>
        <option value={2}>2 GB</option>
        <option value={4}>4 GB</option>
        <option value={8}>8 GB</option>
        <option value={10}>10 GB</option>
      </select>
    </label>
    <label>
      Memory
      <select bind:value={memoryMB}>
        <option value={256}>256 MB</option>
        <option value={512}>512 MB</option>
        <option value={1024}>1 GB</option>
        <option value={2048}>2 GB</option>
      </select>
    </label>
  </div>
  <div class="row">
    <label>
      Auto-archive
      <select bind:value={archivePolicy}>
        <option value="24h">After 24h idle</option>
        <option value="always-on">Always on</option>
      </select>
    </label>
    <label>
      Backups
      <select bind:value={backupCadence}>
        <option value="hourly">Hourly</option>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="manual">Manual only</option>
      </select>
    </label>
  </div>
  <label>
    Initial prompt (optional)
    <textarea
      bind:value={initialPrompt}
      rows="3"
      placeholder="First instruction sent to the agent on boot…"
    ></textarea>
  </label>
  <button type="submit" disabled={submitting}>
    {submitting ? 'Provisioning…' : 'Spin up shell'}
  </button>
</form>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 24px;
    max-width: 640px;
  }
  h2 {
    margin: 0 0 8px;
    font-size: 18px;
    font-weight: 600;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
    color: var(--color-text-muted, #6b7280);
  }
  input, select, textarea {
    padding: 8px 10px;
    border: 1px solid var(--color-border, #e5e7eb);
    border-radius: 6px;
    font-size: 14px;
    color: inherit;
    background: var(--color-surface, white);
    font-family: inherit;
  }
  textarea {
    resize: vertical;
  }
  button[type="submit"] {
    padding: 10px 16px;
    background: rgb(15, 23, 42);
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 500;
    cursor: pointer;
    align-self: flex-start;
  }
  button[type="submit"]:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .error {
    padding: 8px 12px;
    border-radius: 6px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: rgb(185, 28, 28);
    font-size: 13px;
  }
</style>
