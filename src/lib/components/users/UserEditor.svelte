<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { validateAlias, normalizeAlias } from '$lib/utils/alias';
  import { Select } from '$lib/components/ui';
  import IdentityList from './IdentityList.svelte';

  type UserRow = {
    id: string;
    email: string;
    displayName: string | null;
    role: 'user' | 'admin';
    alias: string | null;
  };

  type AvailabilityState = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

  let {
    user,
    onSave,
    onCancel,
  }: {
    user: UserRow;
    onSave: (patch: Partial<UserRow>) => Promise<void>;
    onCancel: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let displayName = $state(user.displayName ?? '');
  // svelte-ignore state_referenced_locally
  let email = $state(user.email);
  // svelte-ignore state_referenced_locally
  let alias = $state(user.alias ?? '');
  // svelte-ignore state_referenced_locally
  let role = $state<'user' | 'admin'>(user.role);
  let saving = $state(false);
  let availability = $state<AvailabilityState>('idle');
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const dirty = $derived(
    displayName !== (user.displayName ?? '') ||
      email !== user.email ||
      alias !== (user.alias ?? '') ||
      role !== user.role,
  );

  const aliasValid = $derived(
    alias === '' ||
      (validateAlias(normalizeAlias(alias) ?? '').ok && availability !== 'taken'),
  );

  $effect(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    const normalized = normalizeAlias(alias);
    if (!normalized || normalized === user.alias) {
      availability = 'idle';
      return;
    }
    if (!validateAlias(normalized).ok) {
      availability = 'invalid';
      return;
    }
    availability = 'checking';
    debounceTimer = setTimeout(async () => {
      const res = await fetch(`/api/users/aliases?check=${encodeURIComponent(normalized)}`);
      const data = (await res.json()) as { available: boolean; reason?: string };
      availability = data.available ? 'available' : ((data.reason as AvailabilityState) ?? 'taken');
    }, 300);
  });

  async function handleSave() {
    if (!dirty || !aliasValid) return;
    saving = true;
    try {
      await onSave({
        displayName: displayName.trim(),
        email: email.trim(),
        alias: normalizeAlias(alias),
        role,
      });
    } finally {
      saving = false;
    }
  }
</script>

<div class="space-y-3">
  <div class="bg-bg2 border border-border rounded-md p-3 space-y-2">
    <div class="text-[10px] uppercase tracking-wider text-muted font-semibold">{m.usersui_identity()}</div>
    <label class="grid grid-cols-[80px_1fr] gap-2 items-center text-xs">
      <span class="text-muted">{m.usersui_name()}</span>
      <input class="bg-bg border border-border rounded px-2 py-1 outline-none focus:border-accent" bind:value={displayName} />
    </label>
    <label class="grid grid-cols-[80px_1fr] gap-2 items-center text-xs">
      <span class="text-muted">{m.usersui_email()}</span>
      <input type="email" class="bg-bg border border-border rounded px-2 py-1 outline-none focus:border-accent" bind:value={email} />
    </label>
    <label class="grid grid-cols-[80px_1fr_auto] gap-2 items-center text-xs">
      <span class="text-muted">{m.usersui_alias()}</span>
      <div class="flex items-center gap-1 bg-bg border border-border rounded px-2 py-1 focus-within:border-accent">
        <span class="text-muted">@</span>
        <input class="flex-1 bg-transparent outline-none" bind:value={alias} placeholder={m.usersui_aliasPlaceholder()} />
      </div>
      <span class="text-[10px] w-20 text-right">
        {#if availability === 'checking'}<span class="text-muted">{m.usersui_checking()}</span>
        {:else if availability === 'available'}<span class="text-green-400">✓ {m.usersui_available()}</span>
        {:else if availability === 'taken'}<span class="text-destructive">✗ {m.usersui_taken()}</span>
        {:else if availability === 'invalid'}<span class="text-destructive">⚠ {m.usersui_invalid()}</span>
        {/if}
      </span>
    </label>
    <label class="grid grid-cols-[80px_1fr] gap-2 items-center text-xs">
      <span class="text-muted">{m.usersui_role()}</span>
      <Select size="sm" value={role} onchange={(v) => (role = String(v) as 'user' | 'admin')}>
        <option value="user">{m.usersui_roleUser()}</option>
        <option value="admin">{m.usersui_roleAdmin()}</option>
      </Select>
    </label>
  </div>

  <IdentityList userId={user.id} />

  <div class="flex justify-end gap-2">
    <button type="button" class="text-xs px-3 py-1.5 rounded-md bg-transparent border border-border text-foreground hover:bg-muted/30" onclick={onCancel}>{m.common_cancel()}</button>
    <button type="button"
      class="text-xs px-3 py-1.5 rounded-md bg-accent text-white border-none font-semibold disabled:opacity-50"
      disabled={!dirty || !aliasValid || saving}
      onclick={handleSave}>
      {saving ? m.usersui_saving() : m.common_save()}
    </button>
  </div>
</div>
