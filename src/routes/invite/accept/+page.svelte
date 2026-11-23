<script lang="ts">
  import { getBranding } from '$lib/branding.svelte';
  import * as m from '$lib/paraglide/messages';
  import { goto } from '$lib/navigation';
  import { PublicTaskShell } from '$lib/components/ui/foundations';
  import { Spinner } from '$lib/components/ui';

  // Better Auth email-invitations are retired — invitations are now Supabase
  // join-links (`/join?token=…`). Any legacy `/invite/accept?id=…` link is dead;
  // send the visitor to the self-serve request-access flow instead.
  $effect(() => {
    goto('/join', { replaceState: true });
  });
</script>

<svelte:head><title>Invitation — {getBranding().fullName}</title></svelte:head>

{#snippet taskIcon()}<Spinner size="lg" />{/snippet}

<PublicTaskShell
  eyebrow="Legacy invitation"
  title="Redirecting to workspace access"
  description={m.invite_accessFlowDescription({ hubName: getBranding().name })}
  icon={taskIcon}
>
  <p class="text-sm text-muted" role="status" aria-live="polite">Redirecting…</p>
</PublicTaskShell>
