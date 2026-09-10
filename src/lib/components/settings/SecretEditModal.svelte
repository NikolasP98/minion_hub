<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import type { SecretsProbeStatus } from '$lib/types/secrets';
  import { Button } from '@minion-stack/ui';
  import SecretStatusPill from './SecretStatusPill.svelte';
  import Dialog from '$lib/components/ui/foundations/Dialog.svelte';

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

  // Reset when modal opens
  $effect(() => {
    if (open) {
      value = '';
      result = null;
      error = null;
      saving = false;
    }
  });

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

<Dialog
  {open}
  title={secretLabel}
  description={secretKey}
  size="md"
  dismissible={!saving}
  hideClose={saving}
  initialFocus="input[type='password']"
  onclose={onClose}
>
  <label class="block">
    <span class="text-xs text-muted-foreground mb-1.5 block">{m.secretEditModal_value()}</span>
    <input
      bind:value
      type="password"
      autocomplete="off"
      spellcheck="false"
      disabled={saving}
      placeholder={m.secretEditModal_placeholder()}
      class="w-full bg-background border border-border rounded-[var(--radius-sm)] px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:border-accent disabled:opacity-50"
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
    <p class="mt-3 text-xs text-destructive" role="alert">{error}</p>
  {/if}

  <div class="flex gap-2 justify-end mt-5">
    <Button variant="ghost" size="sm" disabled={saving} onclick={onClose}>
      {result ? m.common_close() : m.common_cancel()}
    </Button>
    <Button variant="primary" size="sm" loading={saving} disabled={!value} onclick={handleSave}>
      {m.secretEditModal_saveAndProbe()}
    </Button>
  </div>
</Dialog>
