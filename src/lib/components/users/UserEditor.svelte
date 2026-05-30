<script lang="ts">
  import { validateAlias, normalizeAlias } from '$lib/utils/alias';
  import { Select } from '$lib/components/ui';
  import IdentityList from './IdentityList.svelte';

  type UserRow = {
    id: string;
    email: string;
    displayName: string | null;
    role: 'user' | 'admin';
    alias: string | null;
    roleId: string | null;
  };

  type AvailabilityState = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

  let {
    user,
    onSave,
    onCancel,
    customRoles = [],
  }: {
    user: UserRow;
    onSave: (patch: Partial<UserRow>) => Promise<void>;
    onCancel: () => void;
    customRoles?: { id: string; name: string; isSystem: boolean }[];
  } = $props();

  // svelte-ignore state_referenced_locally
  let displayName = $state(user.displayName ?? '');
  // svelte-ignore state_referenced_locally
  let email = $state(user.email);
  // svelte-ignore state_referenced_locally
  let alias = $state(user.alias ?? '');
  // svelte-ignore state_referenced_locally
  let role = $state<'user' | 'admin'>(user.role);
  // svelte-ignore state_referenced_locally
  let roleId = $state<string | null>(user.roleId);
  let saving = $state(false);
  let availability = $state<AvailabilityState>('idle');
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const dirty = $derived(
    displayName !== (user.displayName ?? '') ||
      email !== user.email ||
      alias !== (user.alias ?? '') ||
      role !== user.role ||
      roleId !== user.roleId,
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
        roleId,
      });
    } finally {
      saving = false;
    }
  }
</script>

<div class="space-y-3">
  <div class="bg-bg2 border border-border rounded-md p-3 space-y-2">
    <div class="text-[10px] uppercase tracking-wider text-muted font-semibold">Identity</div>
    <label class="grid grid-cols-[80px_1fr] gap-2 items-center text-xs">
      <span class="text-muted">Name</span>
      <input class="bg-bg border border-border rounded px-2 py-1 outline-none focus:border-accent" bind:value={displayName} />
    </label>
    <label class="grid grid-cols-[80px_1fr] gap-2 items-center text-xs">
      <span class="text-muted">Email</span>
      <input type="email" class="bg-bg border border-border rounded px-2 py-1 outline-none focus:border-accent" bind:value={email} />
    </label>
    <label class="grid grid-cols-[80px_1fr_auto] gap-2 items-center text-xs">
      <span class="text-muted">Alias</span>
      <div class="flex items-center gap-1 bg-bg border border-border rounded px-2 py-1 focus-within:border-accent">
        <span class="text-muted">@</span>
        <input class="flex-1 bg-transparent outline-none" bind:value={alias} placeholder="nikolas" />
      </div>
      <span class="text-[10px] w-20 text-right">
        {#if availability === 'checking'}<span class="text-muted">checking…</span>
        {:else if availability === 'available'}<span class="text-green-400">✓ available</span>
        {:else if availability === 'taken'}<span class="text-destructive">✗ taken</span>
        {:else if availability === 'invalid'}<span class="text-destructive">⚠ invalid</span>
        {/if}
      </span>
    </label>
    <label class="grid grid-cols-[80px_1fr] gap-2 items-center text-xs">
      <span class="text-muted">Role</span>
      <Select
        size="sm"
        value={roleId ?? `legacy:${role}`}
        onchange={(v) => {
          const val = String(v);
          if (val.startsWith('legacy:')) {
            role = val.slice(7) as 'user' | 'admin';
            roleId = null;
          } else {
            roleId = val;
          }
        }}
      >
        <optgroup label="Built-in">
          <option value="legacy:user">user</option>
          <option value="legacy:admin">admin</option>
        </optgroup>
        {#if customRoles.filter((r) => !r.isSystem).length > 0}
          <optgroup label="Custom">
            {#each customRoles.filter((r) => !r.isSystem) as r (r.id)}
              <option value={r.id}>{r.name}</option>
            {/each}
          </optgroup>
        {/if}
      </Select>
    </label>
  </div>

  <IdentityList userId={user.id} />

  <div class="flex justify-end gap-2">
    <button type="button" class="text-xs px-3 py-1.5 rounded-md bg-transparent border border-border text-foreground hover:bg-muted/30" onclick={onCancel}>Cancel</button>
    <button type="button"
      class="text-xs px-3 py-1.5 rounded-md bg-accent text-white border-none font-semibold disabled:opacity-50"
      disabled={!dirty || !aliasValid || saving}
      onclick={handleSave}>
      {saving ? 'Saving…' : 'Save'}
    </button>
  </div>
</div>
