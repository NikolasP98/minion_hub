<script lang="ts">
  import { goto } from '$app/navigation';

  // Better Auth email-invitations are retired — invitations are now Supabase
  // join-links (`/join?token=…`). Any legacy `/invite/accept?id=…` link is dead;
  // send the visitor to the self-serve request-access flow instead.
  $effect(() => {
    goto('/join', { replaceState: true });
  });
</script>

<div class="relative z-10 flex items-center justify-center min-h-screen">
  <p class="text-sm font-mono text-muted">Redirecting…</p>
</div>
