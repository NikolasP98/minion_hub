<script lang="ts">
  import { page } from '$app/state';
  import { DoorClosed } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { iconSizes } from '$lib/components/ui';
  import { PublicTaskShell } from '$lib/components/ui/foundations';
</script>

<!-- Public visitors land here (off, unknown or unbuilt doors): no hub chrome, no "back to dashboard". -->
<svelte:head>
  <title>{m.doors_public_unavailable()}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

{#snippet taskIcon()}
  <DoorClosed size={iconSizes.lg} />
{/snippet}

<PublicTaskShell
  eyebrow={String(page.status)}
  title={m.doors_public_unavailable()}
  icon={taskIcon}
  size="medium"
>
  <p class="t-body">{m.doors_public_unavailable_hint()}</p>
</PublicTaskShell>
