<script lang="ts">
  import { PublicTaskShell } from '$lib/components/ui/foundations';
  import { Send } from 'lucide-svelte';
</script>

<svelte:head>
  <title>Request Sent — Minion Hub</title>
</svelte:head>

{#snippet taskIcon()}<Send size={20} />{/snippet}

<PublicTaskShell
  eyebrow="Workspace access"
  title="Request sent"
  description="Your access request is now in the workspace review queue."
  tone="success"
  icon={taskIcon}
>
  <div
    class="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)] px-4 py-3"
    role="status"
  >
    <p class="text-sm leading-relaxed text-foreground">
      The admin will review it shortly. You’ll receive access once it is approved.
    </p>
    <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
      You can safely close this page and check back later.
    </p>
  </div>
</PublicTaskShell>
