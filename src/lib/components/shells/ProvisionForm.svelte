<script lang="ts">
  import * as m from '$lib/paraglide/messages';
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
      error = m.provisionForm_nameRequired();
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
  <h2 class="t-heading">{m.provisionForm_title()}</h2>

  {#if error}
    <div
      class="rounded-[var(--radius-md)] border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
      role="alert"
    >
      {error}
    </div>
  {/if}

  <label class="flex flex-col gap-1.5 text-[0.75rem] text-muted">
    {m.provisionForm_displayName()}
    <input
      bind:value={displayName}
      type="text"
      placeholder={m.provisionForm_displayNamePlaceholder()}
      required
      class="h-9 {fieldCls}"
    />
  </label>

  <div class="grid grid-cols-2 gap-3">
    <Select label={m.provisionForm_harness()} size="sm" bind:value={harness}>
      <option value="hermes">HERMES</option>
      <option value="claude-code">Claude Code</option>
      <option value="codex">Codex</option>
    </Select>
    <Select label={m.provisionForm_region()} size="sm" bind:value={region}>
      <option value="lax">LAX (Los Angeles)</option>
      <option value="lon">LON (London)</option>
      <option value="fra">FRA (Frankfurt)</option>
    </Select>
  </div>

  <div class="grid grid-cols-2 gap-3">
    <Select label={m.provisionForm_disk()} size="sm" bind:value={diskGB}>
      <option value={2}>2 GB</option>
      <option value={4}>4 GB</option>
      <option value={8}>8 GB</option>
      <option value={10}>10 GB</option>
    </Select>
    <Select label={m.provisionForm_memory()} size="sm" bind:value={memoryMB}>
      <option value={256}>256 MB</option>
      <option value={512}>512 MB</option>
      <option value={1024}>1 GB</option>
      <option value={2048}>2 GB</option>
    </Select>
  </div>

  <div class="grid grid-cols-2 gap-3">
    <Select label={m.provisionForm_archive()} size="sm" bind:value={archivePolicy}>
      <option value="24h">{m.provisionForm_archive24h()}</option>
      <option value="always-on">{m.provisionForm_alwaysOn()}</option>
    </Select>
    <Select label={m.provisionForm_backups()} size="sm" bind:value={backupCadence}>
      <option value="hourly">{m.provisionForm_hourly()}</option>
      <option value="daily">{m.provisionForm_daily()}</option>
      <option value="weekly">{m.provisionForm_weekly()}</option>
      <option value="manual">{m.provisionForm_manualOnly()}</option>
    </Select>
  </div>

  <label class="flex flex-col gap-1.5 text-[0.75rem] text-muted">
    {m.provisionForm_initialPrompt()}
    <textarea
      bind:value={initialPrompt}
      rows="3"
      placeholder={m.provisionForm_initialPromptPlaceholder()}
      class="resize-y py-2 {fieldCls}"
    ></textarea>
  </label>

  <Button type="submit" variant="primary" size="lg" loading={submitting} class="self-start"
    >{m.provisionForm_spinUpButton()}</Button
  >
</form>
