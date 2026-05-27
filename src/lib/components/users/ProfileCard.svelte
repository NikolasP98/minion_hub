<script lang="ts">
  import { invalidate } from '$app/navigation';
  import AvatarUpload from './AvatarUpload.svelte';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
  import { Check, Pencil, X, ShieldCheck, Mail, CalendarDays } from 'lucide-svelte';

  interface Props {
    displayName: string | null;
    email: string | null;
    avatarUrl: string | null;
    role: string | null;
    createdAt: string | null;
  }

  let { displayName, email, avatarUrl, role, createdAt }: Props = $props();

  let editing = $state(false);
  let draftName = $state('');
  let saving = $state(false);

  function startEdit() {
    draftName = displayName ?? '';
    editing = true;
  }

  async function save() {
    const name = draftName.trim();
    if (!name) return;
    saving = true;
    try {
      const res = await fetch('/api/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: name }),
      });
      if (!res.ok) throw new Error('save failed');
      toastSuccess('Name updated');
      editing = false;
      await invalidate('app:user');
    } catch (e) {
      toastError((e as Error).message);
    } finally {
      saving = false;
    }
  }

  const memberSince = $derived.by(() => {
    if (!createdAt) return null;
    const d = new Date(createdAt);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  });
</script>

<div class="bg-bg2 border border-border rounded-md p-4 space-y-5">
  <AvatarUpload name={displayName} {email} src={avatarUrl} />

  <div class="space-y-3">
    <!-- Display name (editable) -->
    <div class="flex items-center gap-3">
      <span class="text-[10px] uppercase tracking-wider text-muted font-semibold w-24 shrink-0">Name</span>
      {#if editing}
        <input
          bind:value={draftName}
          placeholder="Your name"
          class="flex-1 bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
          onkeydown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') editing = false; }}
        />
        <button
          class="flex items-center gap-1 text-xs px-2 py-1 rounded bg-accent text-accent-foreground border-none cursor-pointer hover:opacity-90 disabled:opacity-50"
          onclick={save}
          disabled={saving || !draftName.trim()}
        >
          <Check size={12} /> Save
        </button>
        <button
          class="flex items-center gap-1 text-xs px-2 py-1 rounded bg-transparent border border-border text-muted-foreground cursor-pointer hover:text-foreground"
          onclick={() => (editing = false)}
        >
          <X size={12} />
        </button>
      {:else}
        <span class="flex-1 text-sm text-foreground">{displayName ?? '—'}</span>
        <button
          class="flex items-center gap-1 text-xs px-2 py-1 rounded bg-transparent border border-border text-muted-foreground cursor-pointer hover:text-foreground"
          onclick={startEdit}
        >
          <Pencil size={12} /> Edit
        </button>
      {/if}
    </div>

    <!-- Email -->
    <div class="flex items-center gap-3">
      <span class="text-[10px] uppercase tracking-wider text-muted font-semibold w-24 shrink-0">Email</span>
      <span class="flex-1 text-sm text-foreground flex items-center gap-1.5">
        <Mail size={13} class="text-muted-foreground/70" />
        {email ?? '—'}
      </span>
    </div>

    <!-- Role -->
    <div class="flex items-center gap-3">
      <span class="text-[10px] uppercase tracking-wider text-muted font-semibold w-24 shrink-0">Role</span>
      <span class="flex-1">
        <span class="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/20 uppercase tracking-wide">
          <ShieldCheck size={11} /> {role ?? 'user'}
        </span>
      </span>
    </div>

    <!-- Member since -->
    {#if memberSince}
      <div class="flex items-center gap-3">
        <span class="text-[10px] uppercase tracking-wider text-muted font-semibold w-24 shrink-0">Member since</span>
        <span class="flex-1 text-sm text-muted-foreground flex items-center gap-1.5">
          <CalendarDays size={13} class="text-muted-foreground/70" />
          {memberSince}
        </span>
      </div>
    {/if}
  </div>
</div>
