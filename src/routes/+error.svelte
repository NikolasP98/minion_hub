<script lang="ts">
  import { page } from '$app/state';
  import { logout } from '$lib/state/features/user.svelte';
  import { Button } from '$lib/components/ui';
  import { PublicTaskShell } from '$lib/components/ui/foundations';
  import { CircleAlert, SearchX, ShieldAlert } from 'lucide-svelte';

  const status = $derived(page.status);
  const isNoOrg = $derived(
    status === 403 && /organization membership/i.test(page.error?.message ?? ''),
  );

  const title = $derived(
    isNoOrg
      ? "You're not in a workspace yet"
      : status === 403
        ? 'Access denied'
        : status === 404
          ? 'Page not found'
          : 'Something went wrong',
  );

  const blurb = $derived(
    isNoOrg
      ? "Your account is signed in, but it hasn't been added to a workspace. An admin needs to invite you before you can use the hub."
      : status === 403
        ? "You don't have permission to view this page."
        : status === 404
          ? "We couldn't find what you were looking for."
          : (page.error?.message ?? 'An unexpected error occurred.'),
  );
</script>

<svelte:head><title>{title} — Minion Hub</title></svelte:head>

{#snippet taskIcon()}
  {#if status === 403}<ShieldAlert size={20} />{:else if status === 404}<SearchX
      size={20}
    />{:else}<CircleAlert size={20} />{/if}
{/snippet}

<PublicTaskShell
  eyebrow={`Error ${status}`}
  {title}
  description={blurb}
  tone={status === 403 ? 'warning' : 'danger'}
  icon={taskIcon}
  size="medium"
>
  <div class="flex flex-col gap-3">
    {#if isNoOrg}
      <Button
        href="mailto:admin@minion-ai.org?subject=Workspace%20access%20request"
        variant="primary"
        size="touch"
        class="w-full"
      >
        Request access
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="touch"
        onclick={() => logout()}
        class="w-full"
      >
        Sign out
      </Button>
    {:else}
      <Button
        type="button"
        variant="primary"
        size="touch"
        onclick={() => location.reload()}
        class="w-full"
      >
        Retry
      </Button>
      <Button href="/" variant="secondary" size="touch" class="w-full">Back to dashboard</Button>
    {/if}
  </div>
</PublicTaskShell>
