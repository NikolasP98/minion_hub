<script lang="ts">
  import type { SecretsProbeStatus } from '$lib/types/secrets';
  import { Button } from '$lib/components/ui';
  import SecretStatusPill from './SecretStatusPill.svelte';

  interface Props {
    open: boolean;
    secretKey: string;
    secretLabel: string;
    onClose: () => void;
    onSave: (value: string) => Promise<{ probeStatus: SecretsProbeStatus; probeMessage: string }>;
  }

  let { open, secretKey, secretLabel, onClose, onSave }: Props = $props();

  let value = $state('');
  let saving = $state(false);
  let result = $state<{ probeStatus: SecretsProbeStatus; probeMessage: string } | null>(null);
  let error = $state<string | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);

  // Reset when modal opens
  $effect(() => {
    if (open) {
      value = '';
      result = null;
      error = null;
      saving = false;
      // focus after mount
      queueMicrotask(() => inputEl?.focus());
    }
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && !saving) {
      e.preventDefault();
      onClose();
    }
  }

  async function handleSave() {
    if (!value || saving) return;
    saving = true;
    error = null;
    try {
      result = await onSave(value);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
    onclick={onClose}
    onkeydown={handleKeydown}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="surface-2 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <h2 class="text-sm font-semibold text-foreground mb-1">{secretLabel}</h2>
      <p class="text-[11px] text-muted-foreground mb-4 font-mono">{secretKey}</p>

      <label class="block">
        <span class="text-xs text-muted-foreground mb-1.5 block">Value</span>
        <input
          bind:this={inputEl}
          bind:value
          type="password"
          autocomplete="off"
          spellcheck="false"
          disabled={saving}
          placeholder="Paste secret value"
          class="w-full bg-background border border-border rounded-[5px] px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:border-accent disabled:opacity-50"
        />
      </label>

      {#if result}
        <div class="mt-4 flex items-start gap-2">
          <SecretStatusPill status={result.probeStatus} message={result.probeMessage} />
          {#if result.probeMessage}
            <p class="text-xs text-muted-foreground flex-1">{result.probeMessage}</p>
          {/if}
        </div>
      {/if}

      {#if error}
        <p class="mt-3 text-xs text-rose-300">{error}</p>
      {/if}

      <div class="flex gap-2 justify-end mt-5">
        <Button variant="ghost" size="sm" disabled={saving} onclick={onClose}>
          {result ? 'Close' : 'Cancel'}
        </Button>
        <Button
          variant="primary"
          size="sm"
          loading={saving}
          disabled={!value}
          onclick={handleSave}
        >
          Save & probe
        </Button>
      </div>
    </div>
  </div>
{/if}
