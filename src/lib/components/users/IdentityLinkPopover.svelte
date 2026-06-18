<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { toastError } from '$lib/state/ui/toast.svelte';
  import { Select } from '$lib/components/ui';

  let { userId, onCancel, onLinked }: { userId: string; onCancel: () => void; onLinked: () => void } = $props();

  const CHANNELS = ['whatsapp', 'telegram', 'discord', 'email'] as const;
  let tab = $state<'manual' | 'verify'>('manual');
  let channel = $state<string>('telegram');
  let channelUserId = $state('');
  let displayName = $state('');
  let busy = $state(false);

  let requestId = $state<string | null>(null);
  let code = $state('');

  async function attachManual() {
    busy = true;
    try {
      const res = await fetch(`/api/users/${userId}/identities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, channelUserId, displayName }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toastError((d as { message?: string }).message ?? `HTTP ${res.status}`);
        return;
      }
      onLinked();
    } finally {
      busy = false;
    }
  }

  async function sendCode() {
    busy = true;
    try {
      const res = await fetch(`/api/users/${userId}/identities/verify-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, channelUserId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toastError((d as { message?: string }).message ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { requestId: string };
      requestId = data.requestId;
    } finally {
      busy = false;
    }
  }

  async function confirmCode() {
    if (!requestId) return;
    busy = true;
    try {
      const res = await fetch(`/api/users/${userId}/identities/verify-confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, code }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toastError((d as { message?: string }).message ?? `HTTP ${res.status}`);
        return;
      }
      onLinked();
    } finally {
      busy = false;
    }
  }
</script>

<div class="bg-card border border-border rounded-md p-3 w-80 shadow-lg space-y-2">
  <div class="flex gap-2 text-[10px] uppercase tracking-wider">
    <button class="px-2 py-1 rounded {tab === 'manual' ? 'bg-accent text-white' : 'text-muted'}" onclick={() => (tab = 'manual')}>{m.usersui_manual()}</button>
    <button class="px-2 py-1 rounded {tab === 'verify' ? 'bg-accent text-white' : 'text-muted'}" onclick={() => (tab = 'verify')}>{m.usersui_verifyCode()}</button>
    <button class="ml-auto text-muted text-xs" onclick={onCancel}>✕</button>
  </div>

  <label class="grid grid-cols-[80px_1fr] gap-2 items-center text-xs">
    <span class="text-muted">{m.usersui_channel()}</span>
    <Select bind:value={channel} size="sm">
      {#each CHANNELS as c (c)}<option value={c}>{c}</option>{/each}
    </Select>
  </label>
  <label class="grid grid-cols-[80px_1fr] gap-2 items-center text-xs">
    <span class="text-muted">{m.usersui_userId()}</span>
    <input class="bg-bg border border-border rounded px-2 py-1" bind:value={channelUserId} placeholder={m.usersui_userIdPlaceholder()} />
  </label>

  {#if tab === 'manual'}
    <label class="grid grid-cols-[80px_1fr] gap-2 items-center text-xs">
      <span class="text-muted">{m.usersui_display()}</span>
      <input class="bg-bg border border-border rounded px-2 py-1" bind:value={displayName} />
    </label>
    <button class="w-full text-xs px-3 py-1.5 rounded bg-accent text-white disabled:opacity-50" disabled={busy || !channelUserId} onclick={attachManual}>{m.usersui_attach()}</button>
  {:else}
    {#if !requestId}
      <button class="w-full text-xs px-3 py-1.5 rounded bg-accent text-white disabled:opacity-50" disabled={busy || !channelUserId} onclick={sendCode}>{m.usersui_sendCode()}</button>
    {:else}
      <label class="grid grid-cols-[80px_1fr] gap-2 items-center text-xs">
        <span class="text-muted">{m.usersui_code()}</span>
        <input class="bg-bg border border-border rounded px-2 py-1 tracking-widest" bind:value={code} placeholder="000000" />
      </label>
      <button class="w-full text-xs px-3 py-1.5 rounded bg-accent text-white disabled:opacity-50" disabled={busy || code.length !== 6} onclick={confirmCode}>{m.usersui_confirmCode()}</button>
    {/if}
  {/if}
</div>
