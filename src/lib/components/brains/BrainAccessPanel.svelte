<script lang="ts">
  import { invalidate } from '$app/navigation';
  import { Plus, Trash2 } from 'lucide-svelte';
  import { Button, Select } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import type { BrainAccessRowDTO } from '$lib/types/brains';

  // Local editable copy — a working draft the user edits row-by-row before
  // hitting "Save access"; distinct type from BrainAccessRowDTO so this file
  // isn't coupled to its exact field set.
  interface AccessRowEdit {
    principalType: string;
    principalId: string;
    level: string;
  }

  let {
    brainId,
    visibility,
    access,
    roles,
  }: {
    brainId: string;
    visibility: string;
    access: BrainAccessRowDTO[];
    roles: { key: string; name: string }[];
  } = $props();

  // svelte-ignore state_referenced_locally -- seeding the editable draft once
  // from the loaded `access` prop; converting to $derived would wipe in-progress edits.
  let rows = $state<AccessRowEdit[]>(
    access.map((r) => ({ principalType: r.principalType, principalId: r.principalId, level: r.level })),
  );
  let savingAccess = $state(false);
  let savingVisibility = $state(false);
  let error = $state('');

  async function changeVisibility(value: string) {
    savingVisibility = true;
    try {
      await fetch(`/api/brains/${encodeURIComponent(brainId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ visibility: value }),
      });
      await invalidate('brains:detail');
    } finally {
      savingVisibility = false;
    }
  }

  function addRow() {
    rows = [...rows, { principalType: 'role', principalId: '', level: 'read' }];
  }

  function removeRow(i: number) {
    rows = rows.filter((_, idx) => idx !== i);
  }

  async function save() {
    savingAccess = true;
    error = '';
    try {
      const payload = rows
        .filter((r) => r.principalId.trim().length > 0)
        .map((r) => ({ principalType: r.principalType, principalId: r.principalId.trim(), level: r.level }));
      const res = await fetch(`/api/brains/${encodeURIComponent(brainId)}/access`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rows: payload }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        error = (body as { message?: string }).message ?? `Error ${res.status}`;
        return;
      }
      await invalidate('brains:detail');
    } finally {
      savingAccess = false;
    }
  }
</script>

<div class="flex flex-col gap-5">
  <div class="max-w-xs">
    <Select
      label={m.brains_access_visibility()}
      value={visibility}
      disabled={savingVisibility}
      onchange={(v) => changeVisibility(String(v))}
      options={[
        { value: 'org', label: m.brains_visibility_org() },
        { value: 'private', label: m.brains_visibility_private() },
      ]}
    />
  </div>

  <div class="flex flex-col gap-2">
    <div class="flex items-center justify-between">
      <span class="text-xs font-medium text-muted-foreground">{m.brains_access_rows()}</span>
      <Button variant="secondary" size="sm" onclick={addRow}>
        {#snippet icon()}<Plus size={14} />{/snippet}
        {m.brains_access_add()}
      </Button>
    </div>

    {#if rows.length === 0}
      <p class="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
        {m.brains_access_empty()}
      </p>
    {:else}
      <div class="flex flex-col gap-2">
        {#each rows as row, i (i)}
          <div class="flex items-center gap-2 rounded-lg border border-border bg-bg3 p-2">
            <Select
              size="sm"
              fieldClass="w-28 shrink-0"
              bind:value={row.principalType}
              options={[
                { value: 'role', label: m.brains_access_type_role() },
                { value: 'user', label: m.brains_access_type_user() },
                { value: 'agent', label: m.brains_access_type_agent() },
              ]}
            />
            {#if row.principalType === 'role'}
              <Select size="sm" fieldClass="min-w-0 flex-1" bind:value={row.principalId}>
                <option value="">{m.brains_access_principal_ph()}</option>
                {#each roles as r (r.key)}<option value={r.key}>{r.name}</option>{/each}
              </Select>
            {:else}
              <input
                type="text"
                bind:value={row.principalId}
                placeholder={m.brains_access_principal_ph()}
                class="min-w-0 flex-1 rounded-lg border border-border bg-bg3 px-2.5 py-1.5 text-xs text-accent-foreground placeholder-white/30 outline-none focus:hover:border-[var(--color-border-strong)] focus:ring-0"
              />
            {/if}
            <Select
              size="sm"
              fieldClass="w-24 shrink-0"
              bind:value={row.level}
              options={[
                { value: 'read', label: m.brains_access_level_read() },
                { value: 'write', label: m.brains_access_level_write() },
              ]}
            />
            <Button variant="ghost" size="xs"
              type="button"
              class="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              aria-label={m.brains_access_remove()}
              onclick={() => removeRow(i)}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        {/each}
      </div>
    {/if}

    {#if error}
      <p class="text-xs text-destructive">{error}</p>
    {/if}

    <div class="flex justify-end">
      <Button variant="primary" size="sm" loading={savingAccess} onclick={save}>{m.brains_access_save()}</Button>
    </div>
  </div>
</div>
