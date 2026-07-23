<script lang="ts">
  import { onDestroy } from 'svelte';
  import { invalidate } from '$app/navigation';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
  import ChannelBrandIcon from '$lib/components/channels/ChannelBrandIcon.svelte';
  import { MessageSquare, MoreVertical, Unlink } from 'lucide-svelte';
  import { Button, Dropdown } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import ChannelAccountStateBadge from './ChannelAccountStateBadge.svelte';
  import type { ChannelAccountUiState } from './channel-account-state';

  type Identity = {
    id: string;
    source?: 'turso' | 'supabase';
    provider: string;
    kind: 'oauth' | 'channel';
    externalId: string;
    displayName: string | null;
    verifiedAt: number | null;
  };

  let {
    userId,
    identity,
    accountState,
    canSync,
    onSetupSync,
    onUnclaim,
  }: {
    userId: string;
    identity: Identity | null;
    accountState: ChannelAccountUiState;
    canSync: boolean;
    onSetupSync: () => void;
    onUnclaim: (identity: Identity) => void;
  } = $props();

  let claimOpen = $state(false);
  const displayName = $derived(identity?.displayName?.trim() || null);
  const showDisplayName = $derived(
    !!displayName && displayName.toLowerCase() !== identity?.externalId.toLowerCase(),
  );

  // ---- Tier 1: connect the number via OTP ----
  type Phase = 'idle' | 'sending' | 'otp' | 'verifying' | 'done' | 'error';
  let phase = $state<Phase>('idle');
  let phone = $state('');
  let code = $state('');
  let requestId = $state<string | null>(null);
  let errorMsg = $state<string | null>(null);
  let cooldown = $state(0); // seconds until resend allowed
  let cdTimer: ReturnType<typeof setInterval> | null = null;

  function stopCooldown() {
    if (cdTimer) {
      clearInterval(cdTimer);
      cdTimer = null;
    }
  }
  onDestroy(stopCooldown);

  function startCooldown(ms: number) {
    stopCooldown();
    cooldown = Math.ceil(ms / 1000);
    cdTimer = setInterval(() => {
      cooldown -= 1;
      if (cooldown <= 0) stopCooldown();
    }, 1000);
  }

  async function sendCode(isResend = false) {
    const digits = phone.replace(/[^\d]/g, '');
    if (digits.length < 8) {
      errorMsg = 'Enter your full number including country code.';
      return;
    }
    phase = isResend ? phase : 'sending';
    errorMsg = null;
    try {
      const res = await fetch(`/api/users/${userId}/identities/verify-request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel: 'whatsapp', channelUserId: digits }),
      });
      if (res.status === 429) {
        const d = (await res.json().catch(() => ({}))) as { retryAfterMs?: number };
        startCooldown(d.retryAfterMs ?? 30_000);
        if (phase === 'sending') phase = 'otp';
        return;
      }
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(d.message ?? `send failed (${res.status})`);
      }
      const d = (await res.json()) as { requestId: string; cooldownMs?: number };
      requestId = d.requestId;
      phase = 'otp';
      startCooldown(d.cooldownMs ?? 30_000);
    } catch (e) {
      phase = 'error';
      errorMsg = e instanceof Error ? e.message : 'Could not send code';
      toastError(errorMsg);
    }
  }

  async function verify() {
    if (!requestId || code.replace(/\D/g, '').length !== 6) {
      errorMsg = 'Enter the 6-digit code.';
      return;
    }
    phase = 'verifying';
    errorMsg = null;
    try {
      const res = await fetch(`/api/users/${userId}/identities/verify-confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId, code: code.replace(/\D/g, '') }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(
          res.status === 409
            ? 'This number is already connected to another account.'
            : (d.message ?? 'Verification failed'),
        );
      }
      phase = 'done';
      stopCooldown();
      toastSuccess('WhatsApp connected');
      await invalidate('app:identities');
    } catch (e) {
      phase = 'otp';
      errorMsg = e instanceof Error ? e.message : 'Verification failed';
    }
  }

  function resetTier1() {
    stopCooldown();
    phase = 'idle';
    code = '';
    requestId = null;
    errorMsg = null;
  }
</script>

<div>
  <div class="channel-row flex items-center gap-3 px-3 py-2.5">
    <ChannelBrandIcon channel="whatsapp" class="h-4 w-4 shrink-0" />
    <span class="flex-1 min-w-0">
      <span class="block text-sm text-foreground">WhatsApp</span>
      <span
        class="flex min-w-0 items-center gap-1.5 text-[length:var(--font-size-label)] text-muted-foreground"
      >
        {#if identity}
          <span class="shrink-0 tabular-nums">{identity.externalId}</span>
          {#if showDisplayName}
            <span aria-hidden="true" class="text-muted-strong">·</span>
            <span class="truncate text-foreground">{displayName}</span>
          {/if}
        {:else}
          <span class="truncate">{m.usersui_whatsappClaimHint()}</span>
        {/if}
      </span>
    </span>
    <ChannelAccountStateBadge state={accountState} />
    {#if identity}
      {#if accountState === 'claimed'}
        <Button
          variant="outline"
          size="xs"
          class="shrink-0"
          onclick={onSetupSync}
          disabled={!canSync}
          title={!canSync ? m.usersui_connectGatewayToLinkChannels() : undefined}
        >
          {m.usersui_setupSync()}
        </Button>
      {/if}
      <Dropdown
        items={[
          {
            value: 'unclaim',
            label: m.usersui_unclaimIdentity(),
            icon: Unlink,
            danger: true,
          },
        ]}
        onSelect={(value) => {
          if (value === 'unclaim' && identity) onUnclaim(identity);
        }}
        placement="bottom"
      >
        {#snippet trigger()}
          <span
            class="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
            aria-label={m.usersui_accountActions()}
          >
            <MoreVertical size={15} />
          </span>
        {/snippet}
      </Dropdown>
    {:else}
      <Button
        variant="outline"
        size="xs"
        class="shrink-0"
        aria-expanded={claimOpen}
        aria-controls="whatsapp-claim-form"
        onclick={() => (claimOpen = !claimOpen)}
      >
        {m.usersui_claimAccount()}
      </Button>
    {/if}
  </div>

  {#if claimOpen && !identity}
    <div id="whatsapp-claim-form" class="px-3 pb-3 pt-1 space-y-4">
      <!-- Tier 1: claim the number for attribution/outgoing messaging. -->
      <section class="space-y-2">
        {#if phase === 'done'}
          <div class="flex items-center gap-2 text-sm text-success">
            <span class="w-2 h-2 rounded-full bg-success"></span> Number connected
          </div>
          <Button
            variant="ghost"
            size="xs"
            class="text-[length:var(--font-size-label)] text-muted hover:text-foreground bg-transparent border-none cursor-pointer"
            onclick={resetTier1}
          >
            Use a different number
          </Button>
        {:else if phase === 'idle' || phase === 'sending' || phase === 'error'}
          <div class="flex gap-2">
            <input
              type="tel"
              placeholder="+51 922 286 663"
              bind:value={phone}
              class="flex-1 bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-strong focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <Button
              variant="primary"
              size="sm"
              class="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-accent text-accent-foreground border-none cursor-pointer hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
              onclick={() => sendCode(false)}
              disabled={phase === 'sending'}
            >
              <MessageSquare size={12} /> Send code
            </Button>
          </div>
          {#if errorMsg}<div class="text-xs text-destructive">{errorMsg}</div>{/if}
        {:else}
          <!-- otp / verifying -->
          <p class="text-[length:var(--font-size-label)] text-muted-foreground">
            Enter the 6-digit code we sent to your WhatsApp.
          </p>
          <div class="flex gap-2">
            <input
              inputmode="numeric"
              maxlength="6"
              placeholder="000000"
              bind:value={code}
              class="w-28 bg-bg border border-border rounded px-2.5 py-1.5 text-sm tracking-[0.3em] text-foreground placeholder:text-muted-strong focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <Button
              variant="primary"
              size="sm"
              class="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-accent text-accent-foreground border-none cursor-pointer hover:opacity-90 disabled:opacity-50"
              onclick={verify}
              disabled={phase === 'verifying'}
            >
              Verify
            </Button>
          </div>
          <div class="flex items-center gap-3 text-[length:var(--font-size-label)]">
            <Button
              variant="ghost"
              size="xs"
              class="text-accent hover:underline disabled:opacity-40 disabled:no-underline bg-transparent border-none cursor-pointer"
              onclick={() => sendCode(true)}
              disabled={cooldown > 0}
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              class="text-muted hover:text-foreground bg-transparent border-none cursor-pointer"
              onclick={resetTier1}
            >
              Use a different number
            </Button>
          </div>
          {#if errorMsg}<div class="text-xs text-destructive">{errorMsg}</div>{/if}
        {/if}
      </section>
    </div>
  {/if}
</div>
