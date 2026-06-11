<script lang="ts">
  import { onDestroy } from 'svelte';
  import { invalidate } from '$app/navigation';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
  import ChannelBrandIcon from '$lib/components/channels/ChannelBrandIcon.svelte';
  import WhatsAppQrPairing from '$lib/components/channels/WhatsAppQrPairing.svelte';
  import { Check, ChevronDown, MessageSquare } from 'lucide-svelte';

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
    serverId,
    identity,
    onDisconnect,
  }: {
    userId: string;
    serverId: string;
    identity: Identity | null;
    onDisconnect: (identity: Identity) => void;
  } = $props();

  const connected = $derived(!!identity);

  let open = $state(false);

  // ---- Tier 1: connect the number via OTP ----
  type Phase = 'idle' | 'sending' | 'otp' | 'verifying' | 'done' | 'error';
  let phase = $state<Phase>('idle');
  let phone = $state('');
  let code = $state('');
  let requestId = $state<string | null>(null);
  let errorMsg = $state<string | null>(null);
  let cooldown = $state(0); // seconds until resend allowed
  let cdTimer: ReturnType<typeof setInterval> | null = null;

  // ---- Tier 2: full integration (QR linked device) ----
  let showFull = $state(false);

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
  <button
    class="w-full flex items-center gap-3 px-3 py-2.5 bg-transparent border-none cursor-pointer text-left hover:bg-bg3/30 transition-colors"
    onclick={() => (open = !open)}
  >
    <ChannelBrandIcon channel="whatsapp" class="h-4 w-4 shrink-0" />
    <span class="flex-1 min-w-0">
      <span class="block text-sm text-foreground">WhatsApp</span>
      <span class="block text-[11px] text-muted-foreground truncate">
        {connected ? (identity?.externalId ?? identity?.displayName ?? 'Connected') : 'Verify your number to link this channel'}
      </span>
    </span>
    {#if connected}
      <span class="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-green-500/12 text-green-400 border border-green-500/20 shrink-0">
        <Check size={10} /> Connected
      </span>
    {:else}
      <span class="text-[11px] text-muted-foreground shrink-0">Connect</span>
    {/if}
    <ChevronDown size={14} class="text-muted shrink-0 transition-transform {open ? 'rotate-180' : ''}" />
  </button>

  {#if open}
    <div class="px-3 pb-3 pt-1 space-y-4">
      {#if connected}
        <!-- Connected summary + manage -->
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs text-muted-foreground">
            Connected as <span class="text-foreground">{identity?.displayName ?? identity?.externalId}</span>
          </span>
          {#if identity}
            <button
              class="text-[11px] text-muted hover:text-destructive bg-transparent border-none cursor-pointer"
              onclick={() => onDisconnect(identity!)}
            >
              Disconnect
            </button>
          {/if}
        </div>
      {:else}
        <!-- Tier 1: connect number -->
        <section class="space-y-2">
          {#if phase === 'done'}
            <div class="flex items-center gap-2 text-sm text-green-400">
              <span class="w-2 h-2 rounded-full bg-green-400"></span> Number connected
            </div>
            <button class="text-[11px] text-muted hover:text-foreground bg-transparent border-none cursor-pointer" onclick={resetTier1}>
              Use a different number
            </button>
          {:else if phase === 'idle' || phase === 'sending' || phase === 'error'}
            <div class="flex gap-2">
              <input
                type="tel"
                placeholder="+51 922 286 663"
                bind:value={phone}
                class="flex-1 bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-strong focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button
                class="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-accent text-accent-foreground border-none cursor-pointer hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
                onclick={() => sendCode(false)}
                disabled={phase === 'sending'}
              >
                <MessageSquare size={12} /> Send code
              </button>
            </div>
            {#if errorMsg}<div class="text-xs text-destructive">{errorMsg}</div>{/if}
          {:else}
            <!-- otp / verifying -->
            <p class="text-[11px] text-muted-foreground">Enter the 6-digit code we sent to your WhatsApp.</p>
            <div class="flex gap-2">
              <input
                inputmode="numeric"
                maxlength="6"
                placeholder="000000"
                bind:value={code}
                class="w-28 bg-bg border border-border rounded px-2.5 py-1.5 text-sm tracking-[0.3em] text-foreground placeholder:text-muted-strong focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button
                class="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-accent text-accent-foreground border-none cursor-pointer hover:opacity-90 disabled:opacity-50"
                onclick={verify}
                disabled={phase === 'verifying'}
              >
                Verify
              </button>
            </div>
            <div class="flex items-center gap-3 text-[11px]">
              <button
                class="text-accent hover:underline disabled:opacity-40 disabled:no-underline bg-transparent border-none cursor-pointer"
                onclick={() => sendCode(true)}
                disabled={cooldown > 0}
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
              </button>
              <button class="text-muted hover:text-foreground bg-transparent border-none cursor-pointer" onclick={resetTier1}>
                Use a different number
              </button>
            </div>
            {#if errorMsg}<div class="text-xs text-destructive">{errorMsg}</div>{/if}
          {/if}
        </section>
      {/if}

      <!-- Tier 2: full integration (available connected or not) -->
      <section class="space-y-2 pt-3 border-t border-border/60">
        <button
          class="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted font-semibold bg-transparent border-none cursor-pointer hover:text-foreground"
          onclick={() => (showFull = !showFull)}
        >
          <MessageSquare size={12} /> Full integration (link device)
          <ChevronDown size={12} class="text-muted-foreground transition-transform {showFull ? 'rotate-180' : ''}" />
        </button>
        {#if showFull}
          <p class="text-[11px] text-muted-foreground">
            Links your WhatsApp as a new device so the hub can read messages for deeper analysis.
          </p>
          <WhatsAppQrPairing
            channelId="pending"
            {serverId}
            onpaired={async () => {
              toastSuccess('WhatsApp linked');
              await invalidate('app:identities');
            }}
          />
        {/if}
      </section>
    </div>
  {/if}
</div>
