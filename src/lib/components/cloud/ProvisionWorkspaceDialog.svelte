<script lang="ts">
  import { Check, Cpu, Database, HardDrive, Loader2, MemoryStick, X } from 'lucide-svelte';
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

  let displayName = $state(m.cloud_default_name());
  let runtimes = $state<CloudRuntime[]>(['hermes']);
  let submitting = $state(false);
  let error = $state<string | null>(null);

  function toggleRuntime(id: CloudRuntime): void {
    runtimes = runtimes.includes(id)
      ? runtimes.filter((runtime) => runtime !== id)
      : [...runtimes, id];
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

<svelte:window onkeydown={(event) => event.key === 'Escape' && !submitting && onClose()} />

<div
  class="backdrop"
  role="presentation"
  onclick={(event) => event.currentTarget === event.target && !submitting && onClose()}
>
  <dialog open class="dialog surface-2" aria-labelledby="provision-title">
    <header>
      <div>
        <span class="eyebrow">{m.cloud_blueprint_eyebrow()}</span>
        <h2 id="provision-title">{m.cloud_provision_title()}</h2>
        <p>{m.cloud_provision_description()}</p>
      </div>
      <button
        type="button"
        class="close"
        aria-label={m.common_close()}
        onclick={onClose}
        disabled={submitting}
      >
        <X size={17} />
      </button>
    </header>

    <form onsubmit={submit}>
      {#if error}<div class="error" role="alert">{error}</div>{/if}

      <label class="name-field">
        <span>{m.provisionForm_displayName()}</span>
        <input bind:value={displayName} required autocomplete="off" />
      </label>

      <div class="blueprint">
        <div class="blueprint-name">
          <Database size={15} />
          <div><strong>minion-workstation-v1</strong><span>{m.cloud_os_profile_value()}</span></div>
        </div>
        <div class="spec"><Cpu size={14} /><span>2</span><small>{m.cloud_vcpu()}</small></div>
        <div class="spec">
          <MemoryStick size={14} /><span>8 GB</span><small>{m.cloud_memory()}</small>
        </div>
        <div class="spec">
          <HardDrive size={14} /><span>100 GB</span><small>{m.cloud_storage()}</small>
        </div>
      </div>

      <div class="included">
        <span>{m.cloud_base_includes()}</span>
        <div>
          {#each basePackages as packageName}<span>{packageName}</span>{/each}
        </div>
      </div>

      <fieldset>
        <legend>{m.cloud_choose_runtimes()}</legend>
        <p>{m.cloud_choose_runtimes_hint()}</p>
        <div class="runtime-grid">
          {#each runtimeOptions as runtime (runtime.id)}
            {@const checked = runtimes.includes(runtime.id)}
            <button
              type="button"
              class="runtime-card"
              class:checked
              aria-pressed={checked}
              onclick={() => toggleRuntime(runtime.id)}
            >
              <span class="runtime-check"
                >{#if checked}<Check size={12} strokeWidth={3} />{/if}</span
              >
              <span class="runtime-copy"
                ><strong>{runtime.name}</strong><small>{runtime.description}</small></span
              >
              {#if runtime.featured}<span class="default-tag">{m.cloud_default()}</span>{/if}
            </button>
          {/each}
        </div>
      </fieldset>

      <footer>
        <div class="repro-note">
          <span class="pulse"></span>
          <span>{m.cloud_reproducible_note()}</span>
        </div>
        <button type="button" class="cancel" onclick={onClose} disabled={submitting}
          >{m.common_cancel()}</button
        >
        <button
          type="submit"
          class="submit"
          disabled={submitting || !displayName.trim() || runtimes.length === 0}
        >
          {#if submitting}<Loader2 size={15} class="animate-spin" />{/if}
          {submitting ? m.cloud_provisioning() : m.cloud_provision_action()}
        </button>
      </footer>
    </form>
  </dialog>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: grid;
    place-items: center;
    padding: 1rem;
    background: rgba(2, 4, 9, 0.74);
    backdrop-filter: blur(8px);
  }
  .dialog {
    width: min(47rem, 100%);
    max-height: calc(100vh - 2rem);
    overflow-y: auto;
    margin: 0;
    padding: 0;
    color: var(--color-foreground);
    border: 1px solid color-mix(in srgb, var(--color-accent) 20%, var(--hairline));
    border-radius: calc(var(--radius-lg) + 2px);
    box-shadow: 0 1.5rem 5rem rgba(0, 0, 0, 0.52);
  }
  header {
    padding: 1.25rem 1.35rem 1rem;
    display: flex;
    gap: 1rem;
    border-bottom: 1px solid var(--hairline);
  }
  .eyebrow {
    color: var(--color-accent);
    font: 650 0.5625rem/1 var(--font-mono, monospace);
    letter-spacing: 0.12em;
  }
  h2 {
    margin: 0.35rem 0 0;
    font-size: 1.15rem;
    letter-spacing: -0.02em;
  }
  header p {
    margin: 0.3rem 0 0;
    color: var(--color-muted);
    font-size: 0.75rem;
  }
  .close {
    margin-left: auto;
    width: 2rem;
    height: 2rem;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-muted);
    cursor: pointer;
  }
  .close:hover {
    color: var(--color-foreground);
    background: rgba(255, 255, 255, 0.05);
  }
  form {
    padding: 1.25rem 1.35rem 1.35rem;
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
  }
  .error {
    padding: 0.65rem 0.75rem;
    border: 1px solid color-mix(in srgb, var(--color-destructive) 30%, transparent);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-destructive) 10%, transparent);
    color: var(--color-destructive);
    font-size: 0.75rem;
  }
  .name-field {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    color: var(--color-muted);
    font-size: 0.6875rem;
  }
  .name-field input {
    height: 2.35rem;
    padding: 0 0.75rem;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    outline: 0;
    background: var(--elevation-1-bg);
    color: var(--color-foreground);
    font-size: 0.8125rem;
  }
  .name-field input:focus {
    border-color: color-mix(in srgb, var(--color-accent) 60%, transparent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 14%, transparent);
  }
  .blueprint {
    display: grid;
    grid-template-columns: minmax(13rem, 1fr) repeat(3, auto);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--elevation-1-bg);
  }
  .blueprint-name {
    min-height: 3.65rem;
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.65rem 0.8rem;
    color: var(--color-accent);
  }
  .blueprint-name div {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .blueprint-name strong {
    color: var(--color-foreground);
    font: 600 0.75rem/1.2 var(--font-mono, monospace);
  }
  .blueprint-name span {
    margin-top: 0.25rem;
    color: var(--color-muted);
    font-size: 0.625rem;
  }
  .spec {
    min-width: 5rem;
    padding: 0.55rem 0.65rem;
    border-left: 1px solid var(--hairline);
    display: grid;
    grid-template-columns: auto 1fr;
    align-content: center;
    column-gap: 0.35rem;
    color: var(--color-muted);
  }
  .spec span {
    color: var(--color-foreground);
    font: 600 0.7rem/1 var(--font-mono, monospace);
  }
  .spec small {
    grid-column: 2;
    margin-top: 0.18rem;
    font-size: 0.55rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .included {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    color: var(--color-muted);
    font-size: 0.625rem;
  }
  .included > div {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .included > div span {
    padding: 0.2rem 0.4rem;
    border: 1px solid var(--hairline);
    border-radius: 999px;
    background: var(--elevation-1-bg);
    color: var(--color-foreground);
    font: 500 0.5625rem/1 var(--font-mono, monospace);
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
  }
  legend {
    padding: 0;
    font-size: 0.8125rem;
    font-weight: 650;
  }
  fieldset > p {
    margin: 0.25rem 0 0.65rem;
    color: var(--color-muted);
    font-size: 0.6875rem;
  }
  .runtime-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
  }
  .runtime-card {
    position: relative;
    min-height: 3.4rem;
    padding: 0.65rem 0.75rem;
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    text-align: left;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    background: var(--elevation-1-bg);
    color: var(--color-foreground);
    cursor: pointer;
  }
  .runtime-card:hover {
    border-color: rgba(255, 255, 255, 0.16);
  }
  .runtime-card.checked {
    border-color: color-mix(in srgb, var(--color-accent) 42%, transparent);
    background: color-mix(in srgb, var(--color-accent) 7%, var(--elevation-1-bg));
  }
  .runtime-check {
    width: 1rem;
    height: 1rem;
    margin-top: 0.05rem;
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    border: 1px solid var(--hairline);
    border-radius: 0.25rem;
    color: var(--color-accent-foreground);
  }
  .checked .runtime-check {
    border-color: var(--color-accent);
    background: var(--color-accent);
  }
  .runtime-copy {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .runtime-copy strong {
    font-size: 0.72rem;
  }
  .runtime-copy small {
    margin-top: 0.25rem;
    color: var(--color-muted);
    font-size: 0.6rem;
    line-height: 1.35;
  }
  .default-tag {
    margin-left: auto;
    color: var(--color-accent);
    font: 650 0.5rem/1 var(--font-mono, monospace);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  footer {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding-top: 0.2rem;
  }
  .repro-note {
    margin-right: auto;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    max-width: 17rem;
    color: var(--color-muted);
    font-size: 0.585rem;
    line-height: 1.35;
  }
  .pulse {
    width: 0.4rem;
    height: 0.4rem;
    flex: 0 0 auto;
    border-radius: 50%;
    background: var(--color-success);
    box-shadow: 0 0 0.6rem var(--color-success);
  }
  footer button {
    height: 2.15rem;
    padding: 0 0.8rem;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    border-radius: var(--radius-md);
    font-size: 0.72rem;
    font-weight: 600;
    cursor: pointer;
  }
  .cancel {
    border: 1px solid var(--hairline);
    background: transparent;
    color: var(--color-muted);
  }
  .submit {
    border: 1px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
    background: var(--color-accent);
    color: var(--color-accent-foreground);
  }
  footer button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  @media (max-width: 42rem) {
    .blueprint {
      grid-template-columns: repeat(3, 1fr);
    }
    .blueprint-name {
      grid-column: 1 / -1;
      border-bottom: 1px solid var(--hairline);
    }
    .spec {
      border-left: 0;
    }
    .spec + .spec {
      border-left: 1px solid var(--hairline);
    }
    .runtime-grid {
      grid-template-columns: 1fr;
    }
    .repro-note {
      display: none;
    }
    footer {
      justify-content: flex-end;
    }
  }
</style>
