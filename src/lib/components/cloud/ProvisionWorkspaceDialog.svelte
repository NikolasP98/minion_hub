<script lang="ts">
  import { Check, Cpu, Database, HardDrive, MemoryStick } from 'lucide-svelte';
  import { Button, Input } from '$lib/components/ui';
  import { Dialog, FormFieldset } from '$lib/components/ui/foundations';
  import {
    provisionShell,
    type CloudRuntime,
    type ShellsProvisionResponse,
  } from '$lib/services/shells-rpc';
  import { cloudState } from '$lib/state/features/cloud.svelte';
  import * as m from '$lib/paraglide/messages';

  let {
    onClose,
    onProvisioned,
  }: {
    onClose: () => void;
    onProvisioned: (result: ShellsProvisionResponse) => void;
  } = $props();

  type RuntimeOption = { id: CloudRuntime; name: string; description: string; featured?: boolean };
  const runtimeOptions: RuntimeOption[] = [
    { id: 'hermes', name: 'Hermes', description: m.cloud_runtime_hermes(), featured: true },
    { id: 'claude-code', name: 'Claude Code', description: m.cloud_runtime_claude() },
    { id: 'opencode', name: 'OpenCode', description: m.cloud_runtime_opencode() },
    { id: 'minion-drone', name: 'Minion Drone', description: m.cloud_runtime_drone() },
    { id: 'pi', name: 'Pi', description: m.cloud_runtime_pi() },
    { id: 'obsidian-cli', name: 'Obsidian CLI', description: m.cloud_runtime_obsidian() },
  ];
  const basePackages = [
    m.cloud_package_chromium(),
    m.cloud_package_openssh(),
    m.cloud_package_git(),
    m.cloud_package_node(),
    m.cloud_package_python(),
  ];

  let open = $state(true);
  let displayName = $state(m.cloud_default_name());
  let runtimes = $state<CloudRuntime[]>(['hermes']);
  let submitting = $state(false);
  let error = $state<string | null>(null);

  const canSubmit = $derived(displayName.trim().length > 0 && runtimes.length > 0);

  function toggleRuntime(id: CloudRuntime): void {
    runtimes = runtimes.includes(id)
      ? runtimes.filter((runtime) => runtime !== id)
      : [...runtimes, id];
    error = null;
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!displayName.trim()) {
      error = m.provisionForm_nameRequired();
      return;
    }
    if (runtimes.length === 0) {
      error = m.cloud_runtime_required();
      return;
    }

    submitting = true;
    error = null;
    try {
      const result = await provisionShell({
        displayName: displayName.trim(),
        harness: 'hermes',
        runtimes,
        blueprint: 'minion-workstation-v1',
        image: 'minion-workstation-v1',
        cpu: 2,
        memoryMB: 8192,
        diskGB: 100,
        archiveIdleMs: null,
        backupCadence: 'daily',
        isDefault: cloudState.shells.length === 0,
      });
      onProvisioned(result);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      submitting = false;
    }
  }
</script>

<Dialog
  bind:open
  title={m.cloud_provision_title()}
  description={m.cloud_provision_description()}
  size="xl"
  dismissible={!submitting}
  hideClose={submitting}
  initialFocus="#cloud-workspace-name"
  onclose={() => onClose()}
>
  <form id="provision-workspace-form" class="provision-form" onsubmit={submit}>
    {#if error}<div class="form-error" role="alert">{error}</div>{/if}

    <Input
      id="cloud-workspace-name"
      label={m.provisionForm_displayName()}
      bind:value={displayName}
      required
      autocomplete="off"
      disabled={submitting}
    />

    <section class="blueprint" aria-labelledby="cloud-blueprint-title">
      <div class="blueprint-name">
        <Database size={15} aria-hidden="true" />
        <div>
          <span class="eyebrow">{m.cloud_blueprint_eyebrow()}</span>
          <strong id="cloud-blueprint-title">minion-workstation-v1</strong>
          <small>{m.cloud_os_profile_value()}</small>
        </div>
      </div>
      <div class="spec">
        <Cpu size={14} aria-hidden="true" /><span>2</span><small>{m.cloud_vcpu()}</small>
      </div>
      <div class="spec">
        <MemoryStick size={14} aria-hidden="true" /><span>8 GB</span><small
          >{m.cloud_memory()}</small
        >
      </div>
      <div class="spec">
        <HardDrive size={14} aria-hidden="true" /><span>100 GB</span><small
          >{m.cloud_storage()}</small
        >
      </div>
    </section>

    <div class="included">
      <span>{m.cloud_base_includes()}</span>
      <div>
        {#each basePackages as packageName}<span>{packageName}</span>{/each}
      </div>
    </div>

    <FormFieldset
      legend={m.cloud_choose_runtimes()}
      helper={m.cloud_choose_runtimes_hint()}
      required
      disabled={submitting}
    >
      <div class="runtime-grid">
        {#each runtimeOptions as runtime (runtime.id)}
          {@const checked = runtimes.includes(runtime.id)}
          <Button
            type="button"
            variant="ghost"
            class="runtime-card {checked ? 'checked' : ''}"
            aria-pressed={checked}
            onclick={() => toggleRuntime(runtime.id)}
          >
            <span class="runtime-check" aria-hidden="true">
              {#if checked}<Check size={12} strokeWidth={3} />{/if}
            </span>
            <span class="runtime-copy">
              <strong>{runtime.name}</strong><small>{runtime.description}</small>
            </span>
            {#if runtime.featured}<span class="default-tag">{m.cloud_default()}</span>{/if}
          </Button>
        {/each}
      </div>
    </FormFieldset>
  </form>

  {#snippet footer()}
    <div class="repro-note">
      <span class="pulse" aria-hidden="true"></span>
      <span>{m.cloud_reproducible_note()}</span>
    </div>
    <Button type="button" variant="ghost" size="sm" disabled={submitting} onclick={onClose}>
      {m.common_cancel()}
    </Button>
    <Button
      type="submit"
      form="provision-workspace-form"
      variant="primary"
      size="sm"
      disabled={!canSubmit}
      loading={submitting}
    >
      {submitting ? m.cloud_provisioning() : m.cloud_provision_action()}
    </Button>
  {/snippet}
</Dialog>

<style>
  .provision-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .form-error {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-danger-border);
    border-radius: var(--radius-md);
    color: var(--color-danger-fg);
    background: var(--color-danger-surface);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
  }

  .blueprint {
    display: grid;
    grid-template-columns: minmax(0, 1fr) repeat(3, auto);
    overflow: hidden;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
  }

  .blueprint-name {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    color: var(--color-accent);
  }

  .blueprint-name div {
    display: flex;
    min-width: 0;
    flex-direction: column;
  }

  .eyebrow,
  .blueprint-name strong,
  .spec span,
  .included div span,
  .default-tag {
    font-family: var(--font-mono);
  }

  .eyebrow {
    color: var(--color-accent);
    font-size: var(--font-size-telemetry);
    line-height: var(--line-height-compact);
    font-weight: var(--font-weight-semibold);
    letter-spacing: var(--letter-spacing-label);
    text-transform: uppercase;
  }

  .blueprint-name strong {
    color: var(--color-text-primary);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
    font-weight: var(--font-weight-semibold);
  }

  .blueprint-name small,
  .spec small {
    color: var(--color-text-tertiary);
    font-size: var(--font-size-telemetry);
    line-height: var(--line-height-compact);
  }

  .spec {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-content: center;
    gap: var(--space-1) var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-left: 1px solid var(--color-border-subtle);
    color: var(--color-text-tertiary);
  }

  .spec span {
    color: var(--color-text-primary);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
    font-weight: var(--font-weight-semibold);
  }

  .spec small {
    grid-column: 2;
    letter-spacing: var(--letter-spacing-label);
    text-transform: uppercase;
  }

  .included {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    color: var(--color-text-tertiary);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
  }

  .included > div {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .included > div span {
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-full);
    color: var(--color-text-secondary);
    background: var(--color-surface-1);
    font-size: var(--font-size-telemetry);
  }

  .runtime-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
  }

  :global(.runtime-card) {
    position: relative;
    display: flex;
    height: auto;
    min-height: var(--control-height-touch);
    align-items: flex-start;
    justify-content: flex-start;
    gap: var(--space-3);
    padding: var(--space-3);
    border-color: var(--color-border-default);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    background: var(--color-surface-1);
    text-align: left;
    white-space: normal;
  }

  :global(.runtime-card.checked) {
    border-color: color-mix(in srgb, var(--color-accent) 48%, var(--color-border-default));
    background: color-mix(in srgb, var(--color-accent) 8%, var(--color-surface-1));
  }

  :global(.runtime-card > span) {
    width: 100%;
    align-items: flex-start;
  }

  .runtime-check {
    display: grid;
    width: var(--space-4);
    height: var(--space-4);
    flex: none;
    place-items: center;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm);
    color: var(--color-on-accent);
  }

  :global(.runtime-card.checked) .runtime-check {
    border-color: var(--color-accent);
    background: var(--color-accent);
  }

  .runtime-copy {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
  }

  .runtime-copy strong {
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
  }

  .runtime-copy small {
    margin-top: var(--space-1);
    color: var(--color-text-tertiary);
    font-size: var(--font-size-telemetry);
    line-height: var(--line-height-compact);
  }

  .default-tag {
    margin-left: auto;
    color: var(--color-accent);
    font-size: var(--font-size-telemetry);
    line-height: var(--line-height-compact);
    font-weight: var(--font-weight-semibold);
    letter-spacing: var(--letter-spacing-label);
    text-transform: uppercase;
  }

  .repro-note {
    display: flex;
    min-width: 0;
    margin-right: auto;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-tertiary);
    font-size: var(--font-size-telemetry);
    line-height: var(--line-height-compact);
    text-align: left;
  }

  .pulse {
    width: var(--space-2);
    height: var(--space-2);
    flex: none;
    border-radius: var(--radius-full);
    background: var(--color-success-fg);
  }

  @media (max-width: 767.98px) {
    .blueprint {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .blueprint-name {
      grid-column: 1 / -1;
      border-bottom: 1px solid var(--color-border-subtle);
    }

    .spec {
      border-left: 0;
    }

    .spec + .spec {
      border-left: 1px solid var(--color-border-subtle);
    }

    .runtime-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .included {
      align-items: flex-start;
      flex-direction: column;
    }

    .repro-note {
      display: none;
    }
  }
</style>
