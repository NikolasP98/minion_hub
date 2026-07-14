<script lang="ts">
  import { goto } from '$app/navigation';
  import { PublicTaskShell } from '$lib/components/ui/foundations';
  import { LoaderCircle } from 'lucide-svelte';

  // Better Auth email-invitations are retired — invitations are now Supabase
  // join-links (`/join?token=…`). Any legacy `/invite/accept?id=…` link is dead;
  // send the visitor to the self-serve request-access flow instead.
  $effect(() => {
    goto('/join', { replaceState: true });
  });
</script>

<svelte:head><title>Invitation — Minion Hub</title></svelte:head>

{#snippet taskIcon()}<LoaderCircle size={20} class="animate-spin" />{/snippet}

<PublicTaskShell
  eyebrow="Legacy invitation"
  title="Redirecting to workspace access"
  description="Invitation links now continue through Minion’s organization access flow."
  icon={taskIcon}
>
  <p class="text-sm text-muted" role="status" aria-live="polite">Redirecting…</p>
</PublicTaskShell>
