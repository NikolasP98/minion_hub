<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import * as m from '$lib/paraglide/messages';
  import { Button } from '$lib/components/ui';
  import {
    FormField,
    PublicTaskShell,
    type FormControlProps,
  } from '$lib/components/ui/foundations';
  import { KeyRound, TicketCheck, TriangleAlert } from 'lucide-svelte';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData | null } = $props();
  let message = $state('');
  let submitting = $state(false);

  const trackSubmission: SubmitFunction = () => {
    submitting = true;
    return async ({ update }) => {
      try {
        await update();
      } finally {
        submitting = false;
      }
    };
  };
</script>

<svelte:head>
  <title>Request Access — Minion Hub</title>
</svelte:head>

{#snippet taskIcon()}
  {#if data.mode === 'link' && data.linkError}
    <TriangleAlert size={20} />
  {:else if data.mode === 'link'}
    <TicketCheck size={20} />
  {:else}
    <KeyRound size={20} />
  {/if}
{/snippet}

<PublicTaskShell
  eyebrow={data.mode === 'link' ? 'Organization invitation' : 'Workspace access'}
  title={data.mode === 'link'
    ? data.linkError
      ? m.join_inviteUnavailable()
      : m.join_joinOrg({ org: data.orgName ?? '' })
    : m.join_requestAccess()}
  description={data.mode === 'link'
    ? (data.linkError ?? m.join_invitedToJoin({ org: data.orgName ?? '', role: data.role ?? '' }))
    : m.join_notMemberSubtitle({ email: data.email })}
  tone={data.mode === 'link' && data.linkError ? 'warning' : 'default'}
  icon={taskIcon}
  size="medium"
>
  {#if data.mode === 'link'}
    {#if data.linkError}
      <Button href="/join" variant="primary" size="touch" class="w-full">
        {m.join_requestAccessInstead()}
      </Button>
    {:else}
      <form
        method="POST"
        action="?/consume"
        use:enhance={trackSubmission}
        class="flex flex-col gap-3"
      >
        <input type="hidden" name="token" value={data.token} />
        <Button type="submit" variant="primary" size="touch" loading={submitting} class="w-full">
          {m.join_joinOrgButton({ org: data.orgName ?? '' })}
        </Button>
        {#if form?.error}
          <p
            class="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-destructive)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-destructive)_10%,transparent)] px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {form.error}
          </p>
        {/if}
      </form>
    {/if}
  {:else}
    <form
      method="POST"
      action="?/request"
      use:enhance={trackSubmission}
      class="flex flex-col gap-4"
    >
      {#snippet messageControl(control: FormControlProps)}
        <textarea
          {...control}
          name="message"
          bind:value={message}
          placeholder={m.join_messagePlaceholder()}
          rows={4}
          maxlength={500}
          class="min-h-28 w-full resize-y rounded-[var(--radius-md)] border border-border bg-bg px-3 py-2 text-sm leading-relaxed text-foreground outline-none transition-[border-color,box-shadow] duration-[var(--duration-fast)] placeholder:text-muted-foreground focus-visible:border-accent focus-visible:shadow-[var(--shadow-focus)]"
        ></textarea>
      {/snippet}
      <FormField
        id="join-message"
        label={m.join_messageLabel()}
        helper={`${message.length}/500`}
        children={messageControl}
      />

      <Button type="submit" variant="primary" size="touch" loading={submitting} class="w-full">
        {m.join_submitRequest()}
      </Button>
      {#if form?.error}
        <p
          class="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-destructive)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-destructive)_10%,transparent)] px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {form.error}
        </p>
      {/if}
    </form>
  {/if}
</PublicTaskShell>
