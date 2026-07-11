<script lang="ts">
  import { invalidate } from '$app/navigation';
  import * as m from '$lib/paraglide/messages';
  import { Button, Input } from '$lib/components/ui';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';

  let { username }: { username: string | null } = $props();

  // svelte-ignore state_referenced_locally -- seeds the editable field once
  // from the prop; a $derived would wipe in-progress user edits on refresh.
  let value = $state(username ?? '');
  let saving = $state(false);
  let error = $state<string | null>(null);

  const normalized = $derived(value.trim().toLowerCase());
  const dirty = $derived(normalized !== (username ?? ''));

  async function save() {
    if (saving || !dirty) return;
    saving = true;
    error = null;
    try {
      const res = await fetch('/api/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: normalized }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        error =
          body.error === 'username_taken'
            ? m.account_security_usernameTaken()
            : m.account_security_usernameInvalid();
        return;
      }
      toastSuccess(m.account_security_usernameSaved());
      await Promise.all([invalidate('app:security'), invalidate('app:user')]);
    } catch (e) {
      toastError(e instanceof Error ? e.message : m.account_security_saveFailed());
    } finally {
      saving = false;
    }
  }
</script>

<div class="bg-bg2 border border-border rounded-md p-5 space-y-3">
  <div class="flex items-start justify-between gap-3">
    <div>
      <h2 class="text-sm font-semibold text-foreground">{m.account_security_usernameTitle()}</h2>
      <p class="mt-0.5 text-xs text-muted-foreground">{m.account_security_usernameHelp()}</p>
    </div>
    <span class="text-xs font-mono text-muted-foreground shrink-0 pt-0.5">
      {username ? `@${username}` : m.account_security_usernameNotSet()}
    </span>
  </div>

  <div class="flex items-end gap-2 max-w-sm">
    <Input
      bind:value
      placeholder={m.account_security_usernamePlaceholder()}
      error={error ?? undefined}
      disabled={saving}
      class="flex-1"
    />
    <Button variant="secondary" loading={saving} disabled={!dirty} onclick={save}>
      {m.common_save()}
    </Button>
  </div>
</div>
