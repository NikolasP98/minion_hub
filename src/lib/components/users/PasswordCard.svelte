<script lang="ts">
  import { invalidate } from '$app/navigation';
  import * as m from '$lib/paraglide/messages';
  import { Button, Input } from '$lib/components/ui';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';

  let { hasPassword }: { hasPassword: boolean } = $props();

  let currentPassword = $state('');
  let newPassword = $state('');
  let confirmPassword = $state('');
  let saving = $state(false);
  let error = $state<string | null>(null);

  function resetFields() {
    currentPassword = '';
    newPassword = '';
    confirmPassword = '';
  }

  async function save() {
    if (saving) return;
    error = null;

    if (newPassword.length < 8) {
      error = m.account_security_passwordTooShort();
      return;
    }
    if (newPassword !== confirmPassword) {
      error = m.account_security_passwordMismatch();
      return;
    }

    saving = true;
    try {
      const res = await fetch('/api/me/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          currentPassword: hasPassword ? currentPassword : undefined,
          newPassword,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        error =
          body.error === 'wrong_password'
            ? m.account_security_wrongPassword()
            : m.account_security_saveFailed();
        return;
      }
      toastSuccess(
        hasPassword ? m.account_security_passwordSaved() : m.account_security_passwordSet(),
      );
      resetFields();
      // Reloads `hasPassword` so a first-time "set" flips the form into
      // change-mode (current-password field appears) without a full refresh.
      await invalidate('app:security');
    } catch (e) {
      toastError(e instanceof Error ? e.message : m.account_security_saveFailed());
    } finally {
      saving = false;
    }
  }
</script>

<div class="bg-bg2 border border-border rounded-md p-5 space-y-3">
  <div>
    <h2 class="text-sm font-semibold text-foreground">{m.account_security_passwordTitle()}</h2>
    {#if !hasPassword}
      <p class="mt-0.5 text-xs text-muted-foreground">{m.account_security_passwordAddDesc()}</p>
    {/if}
  </div>

  <div class="max-w-sm space-y-2.5">
    {#if hasPassword}
      <Input
        type="password"
        autocomplete="current-password"
        bind:value={currentPassword}
        label={m.account_security_currentPasswordLabel()}
        disabled={saving}
      />
    {/if}
    <Input
      type="password"
      autocomplete="new-password"
      bind:value={newPassword}
      label={m.account_security_newPasswordLabel()}
      disabled={saving}
    />
    <Input
      type="password"
      autocomplete="new-password"
      bind:value={confirmPassword}
      label={m.account_security_confirmPasswordLabel()}
      disabled={saving}
    />

    {#if error}
      <p class="text-xs text-destructive">{error}</p>
    {/if}

    <Button variant="secondary" loading={saving} onclick={save}>{m.common_save()}</Button>
  </div>
</div>
