<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { Button } from '$lib/components/ui';
  import { PublicTaskShell } from '$lib/components/ui/foundations';
  import { BadgeCheck, Link2 } from 'lucide-svelte';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData | null } = $props();

  let submitted = $state(false);

  const trackSubmission: SubmitFunction = () => {
    submitted = true;
    return async ({ update }) => {
      try {
        await update();
      } finally {
        submitted = false;
      }
    };
  };
</script>

<svelte:head>
  <title>Link Your Channel — Minion Hub</title>
</svelte:head>

{#snippet taskIcon()}
  {#if form?.success}<BadgeCheck size={20} />{:else}<Link2 size={20} />{/if}
{/snippet}

<PublicTaskShell
  eyebrow={`${data.channelLabel} identity`}
  title={form?.success ? 'Channel linked' : 'Link your channel'}
  description={form?.success
    ? `${data.channelLabel} can now recognize your Minion Hub account.`
    : `Confirm the identity that ${data.channelLabel} should use for this channel.`}
  tone={form?.success ? 'success' : 'default'}
  icon={taskIcon}
  size="medium"
>
  {#if form?.success}
    <div class="flex flex-col gap-4" aria-live="polite">
      <p class="text-sm leading-relaxed text-muted">
        Your {data.channelLabel} number
        <strong class="text-foreground">{data.channelUserId}</strong>
        is now linked to <strong class="text-foreground">{data.userEmail}</strong>.
      </p>
      <p class="text-sm leading-relaxed text-muted-foreground">
        Return to {data.channelLabel} and ask the bot for your connected Google data.
      </p>
      <Button href="/settings" variant="primary" size="touch" class="w-full">Go to settings</Button>
    </div>
  {:else}
    <div class="flex flex-col gap-4">
      <p class="text-sm leading-relaxed text-muted">
        Link <strong class="text-foreground">{data.channelLabel}</strong> identity
        <code
          class="rounded-[var(--radius-sm)] bg-bg3 px-1.5 py-1 font-mono text-xs text-foreground"
          >{data.channelUserId}</code
        >
        to <strong class="text-foreground">{data.userEmail}</strong>.
      </p>
      <p class="text-xs leading-relaxed text-muted-foreground">
        This lets the bot access connected Drive, Gmail, and Calendar services when you message from
        this number.
      </p>
      <form method="POST" use:enhance={trackSubmission}>
        <Button type="submit" variant="primary" size="touch" loading={submitted} class="w-full">
          Yes, link my channel
        </Button>
      </form>
    </div>
  {/if}
</PublicTaskShell>
