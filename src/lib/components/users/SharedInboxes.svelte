<script lang="ts">
  import { invalidate } from '$app/navigation';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
  import { Check, Building2 } from 'lucide-svelte';

  type SharedIdentity = {
    identityId: string;
    provider: string;
    externalId: string;
    displayName: string | null;
    ownerName: string | null;
    organizationId: string;
    subscribed: boolean;
  };

  let { sharedIdentities }: { sharedIdentities: SharedIdentity[] } = $props();

  let busy = $state<string | null>(null);

  async function toggle(s: SharedIdentity) {
    busy = s.identityId;
    try {
      const res = s.subscribed
        ? await fetch(`/api/shared-identities/${s.identityId}`, { method: 'DELETE' })
        : await fetch('/api/shared-identities', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ identityId: s.identityId }),
          });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'failed');
      toastSuccess(s.subscribed ? 'Removed from your feed' : 'Added to your feed');
      await invalidate('app:shared-identities');
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Could not update');
    } finally {
      busy = null;
    }
  }
</script>

{#if sharedIdentities.length > 0}
  <div class="bg-bg2 border border-border rounded-md overflow-hidden">
    <div class="px-3 py-2.5 border-b border-border">
      <div class="text-[10px] uppercase tracking-wider text-muted font-semibold">Shared inboxes</div>
      <div class="text-[11px] text-muted-foreground mt-0.5">
        Business accounts you can add to your feed (emails &amp; events).
      </div>
    </div>
    <div class="divide-y divide-border/60">
      {#each sharedIdentities as s (s.identityId)}
        <div class="flex items-center gap-3 px-3 py-2.5">
          <span class="grid place-items-center h-6 w-6 rounded-full bg-bg3/50 text-muted shrink-0">
            <Building2 size={13} />
          </span>
          <span class="flex-1 min-w-0">
            <span class="block text-sm text-foreground truncate">
              {s.displayName ?? s.ownerName ?? s.externalId}
            </span>
            <span class="block text-[11px] text-muted-foreground truncate">{s.externalId}</span>
          </span>
          <button
            class="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md cursor-pointer border disabled:opacity-50
              {s.subscribed
                ? 'bg-accent/15 text-accent border-accent/30 hover:bg-accent/25'
                : 'bg-transparent text-foreground border-border hover:bg-muted/30'}"
            disabled={busy === s.identityId}
            onclick={() => toggle(s)}
          >
            {#if s.subscribed}<Check size={12} /> In your feed{:else}Add to feed{/if}
          </button>
        </div>
      {/each}
    </div>
  </div>
{/if}
