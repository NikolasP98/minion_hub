<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { Button, Input } from '$lib/components/ui';
  import { PublicTaskShell } from '$lib/components/ui/foundations';
  import { CircleCheck, KeyRound } from 'lucide-svelte';

  let identifier = $state('');
  let loading = $state(false);
  let sent = $state(false);

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (loading) return;
    loading = true;
    try {
      // Always 200 per spec (no account-existence enumeration) — the request
      // itself never surfaces an error to the caller.
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier }),
      });
      sent = true;
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head><title>{m.login_forgot_title()} — Minion Hub</title></svelte:head>

{#snippet taskIcon()}
  {#if sent}<CircleCheck size={20} />{:else}<KeyRound size={20} />{/if}
{/snippet}
{#snippet footer()}<span>{m.login_footer()}</span>{/snippet}

<PublicTaskShell
  eyebrow={m.login_forgot_title()}
  title={sent ? 'Check your inbox' : m.login_forgot_title()}
  description={sent ? m.login_forgot_sent() : m.login_forgot_subtitle()}
  tone={sent ? 'success' : 'default'}
  icon={taskIcon}
  {footer}
>
  {#if sent}
    <div class="flex flex-col gap-3" aria-live="polite">
      <p
        class="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)] px-3 py-2 text-sm text-success"
      >
        {m.login_forgot_sent()}
      </p>
      <Button href="/login" variant="secondary" size="touch" class="w-full">
        {m.login_forgot_backToLogin()}
      </Button>
    </div>
  {:else}
    <form onsubmit={handleSubmit} class="flex flex-col gap-3">
      <Input
        id="forgot-identifier"
        type="text"
        autocomplete="username"
        label={m.login_identifierLabel()}
        bind:value={identifier}
        placeholder="admin@minion.hub"
        size="touch"
        required
      />

      <Button type="submit" variant="primary" size="touch" {loading} class="w-full">
        {m.login_forgot_submit()}
      </Button>
      <Button href="/login" variant="ghost" size="md" class="w-full">
        {m.login_forgot_backToLogin()}
      </Button>
    </form>
  {/if}
</PublicTaskShell>
