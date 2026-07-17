<script lang="ts">
  import { goto } from '$lib/navigation';
  import type { PageData } from './$types';
  import * as m from '$lib/paraglide/messages';
  import { Button, Input } from '$lib/components/ui';
  import { PublicTaskShell } from '$lib/components/ui/foundations';
  import { CircleCheck, KeyRound, ShieldAlert } from 'lucide-svelte';

  let { data }: { data: PageData } = $props();

  let newPassword = $state('');
  let confirmPassword = $state('');
  let saving = $state(false);
  let error = $state<string | null>(null);
  let done = $state(false);

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
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
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tokenHash: data.tokenHash, newPassword }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        error =
          payload.error === 'invalid_token'
            ? m.reset_invalidToken()
            : m.account_security_saveFailed();
        return;
      }

      done = true;
      setTimeout(() => goto('/', { replaceState: true }), 1500);
    } catch {
      error = m.account_security_saveFailed();
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head><title>{m.reset_title()} — Minion Hub</title></svelte:head>

{#snippet taskIcon()}
  {#if !data.ok}<ShieldAlert size={20} />{:else if done}<CircleCheck size={20} />{:else}<KeyRound
      size={20}
    />{/if}
{/snippet}
{#snippet footer()}<span>{m.login_footer()}</span>{/snippet}

<PublicTaskShell
  eyebrow={m.reset_title()}
  title={!data.ok ? 'Reset link unavailable' : done ? 'Password updated' : m.reset_title()}
  description={!data.ok ? m.reset_invalidToken() : done ? m.reset_success() : m.reset_subtitle()}
  tone={!data.ok ? 'danger' : done ? 'success' : 'default'}
  icon={taskIcon}
  {footer}
>
  {#if !data.ok}
    <div class="flex flex-col gap-3">
      <p
        class="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-destructive)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-destructive)_10%,transparent)] px-3 py-2 text-sm text-destructive"
        role="alert"
      >
        {m.reset_invalidToken()}
      </p>
      <Button href="/login/forgot" variant="primary" size="touch" class="w-full">
        {m.reset_requestNew()}
      </Button>
    </div>
  {:else if done}
    <p
      class="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)] px-3 py-2 text-sm text-success"
      aria-live="polite"
    >
      {m.reset_success()}
    </p>
  {:else}
    <form onsubmit={handleSubmit} class="flex flex-col gap-3">
      <Input
        id="reset-password"
        type="password"
        autocomplete="new-password"
        label={m.reset_newPasswordLabel()}
        bind:value={newPassword}
        placeholder="••••••••"
        helper="Use at least eight characters."
        error={error && newPassword.length < 8 ? error : undefined}
        size="touch"
        required
      />
      <Input
        id="reset-confirm"
        type="password"
        autocomplete="new-password"
        label={m.reset_confirmPasswordLabel()}
        bind:value={confirmPassword}
        placeholder="••••••••"
        error={error && newPassword !== confirmPassword ? error : undefined}
        size="touch"
        required
      />

      {#if error && newPassword.length >= 8 && newPassword === confirmPassword}
        <p
          class="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-destructive)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-destructive)_10%,transparent)] px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      {/if}

      <Button type="submit" variant="primary" size="touch" loading={saving} class="w-full">
        {m.reset_submit()}
      </Button>
    </form>
  {/if}
</PublicTaskShell>
