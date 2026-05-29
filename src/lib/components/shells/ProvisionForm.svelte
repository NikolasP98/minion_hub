<script lang="ts">
  import { provisionShell, type ShellsProvisionResponse } from '$lib/services/shells-rpc';
  import { Select, Button } from '$lib/components/ui';

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

  const fieldCls =
    'rounded-[var(--radius-md)] bg-[var(--elevation-2-bg)] border border-[var(--hairline)] ' +
    'px-3 text-sm text-foreground placeholder:text-muted-strong outline-none ' +
    'transition-[border-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-standard)] ' +
    'hover:border-white/15 focus-visible:border-accent ' +
    'focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--color-accent)_25%,transparent)]';
</script>

<form onsubmit={submit} class="flex flex-col gap-4 p-6 max-w-2xl">
  <h2 class="t-heading">Spin up a shell</h2>

  {#if error}
    <div
      class="rounded-[var(--radius-md)] border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
      role="alert"
    >
      {error}
    </div>
  {/if}

  <label class="flex flex-col gap-1.5 text-[0.75rem] text-muted">
    Display name
    <input
      bind:value={displayName}
      type="text"
      placeholder="e.g. research assistant"
      required
      class="h-9 {fieldCls}"
    />
  </label>

  <div class="grid grid-cols-2 gap-3">
    <Select label="Harness" size="sm" bind:value={harness}>
      <option value="hermes">HERMES</option>
      <option value="claude-code">Claude Code</option>
      <option value="codex">Codex</option>
    </Select>
    <Select label="Region" size="sm" bind:value={region}>
      <option value="lax">LAX (Los Angeles)</option>
      <option value="lon">LON (London)</option>
      <option value="fra">FRA (Frankfurt)</option>
    </Select>
  </div>

  <div class="grid grid-cols-2 gap-3">
    <Select label="Disk" size="sm" bind:value={diskGB}>
      <option value={2}>2 GB</option>
      <option value={4}>4 GB</option>
      <option value={8}>8 GB</option>
      <option value={10}>10 GB</option>
    </Select>
    <Select label="Memory" size="sm" bind:value={memoryMB}>
      <option value={256}>256 MB</option>
      <option value={512}>512 MB</option>
      <option value={1024}>1 GB</option>
      <option value={2048}>2 GB</option>
    </Select>
  </div>

  <div class="grid grid-cols-2 gap-3">
    <Select label="Auto-archive" size="sm" bind:value={archivePolicy}>
      <option value="24h">After 24h idle</option>
      <option value="always-on">Always on</option>
    </Select>
    <Select label="Backups" size="sm" bind:value={backupCadence}>
      <option value="hourly">Hourly</option>
      <option value="daily">Daily</option>
      <option value="weekly">Weekly</option>
      <option value="manual">Manual only</option>
    </Select>
  </div>

  <label class="flex flex-col gap-1.5 text-[0.75rem] text-muted">
    Initial prompt (optional)
    <textarea
      bind:value={initialPrompt}
      rows="3"
      placeholder="First instruction sent to the agent on boot…"
      class="resize-y py-2 {fieldCls}"
    ></textarea>
  </label>

  <Button type="submit" variant="primary" size="lg" loading={submitting} class="self-start"
    >Spin up shell</Button
  >
</form>
