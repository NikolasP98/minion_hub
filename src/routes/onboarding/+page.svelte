<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import * as m from '$lib/paraglide/messages';
  import { Button, Input, Select } from '$lib/components/ui';
  import { PublicTaskShell } from '$lib/components/ui/foundations';
  import { Building2, UserRound } from 'lucide-svelte';
  import { iconSizes } from '$lib/components/ui/icon-sizes';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData | null } = $props();

  // No local field state on purpose: the browser owns these controls and the
  // action reads them off `formData`. The org action re-runs this load to flip
  // `data.scope` to 'user' without remounting, and seeded `$state` would keep
  // the stale (empty) org-step values.
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

  /** Native language names — a language picker never translates its own options. */
  const LANGUAGE_LABELS: Record<string, string> = { en: 'English', es: 'Español' };

  const kindOptions = [
    { value: 'business', label: m.onboarding_orgKindBusiness() },
    { value: 'personal', label: m.onboarding_orgKindPersonal() },
  ];
  const timezoneOptions = $derived(
    data.scope === 'org'
      ? data.timezones.map((value) => ({
          value,
          label: value.replace(/^[^/]+\//, '').replace(/_/g, ' '),
        }))
      : [],
  );
  const currencyOptions = $derived(
    data.scope === 'org' ? data.currencies.map((value) => ({ value, label: value })) : [],
  );
  const languageOptions = $derived(
    data.scope === 'user'
      ? data.languages.map((value) => ({ value, label: LANGUAGE_LABELS[value] ?? value }))
      : [],
  );
  const eyebrow = $derived(
    data.scope === 'org' ? m.onboarding_orgEyebrow() : m.onboarding_userEyebrow(),
  );
</script>

<svelte:head>
  <title>{eyebrow} — Minion Hub</title>
</svelte:head>

{#snippet taskIcon()}
  {#if data.scope === 'org'}<Building2 size={iconSizes.lg} />{:else}<UserRound
      size={iconSizes.lg}
    />{/if}
{/snippet}

<PublicTaskShell
  {eyebrow}
  title={data.scope === 'org'
    ? m.onboarding_orgTitle({ org: data.org.name })
    : m.onboarding_userTitle()}
  description={data.scope === 'org' ? m.onboarding_orgSubtitle() : m.onboarding_userSubtitle()}
  icon={taskIcon}
  size="medium"
>
  <form
    method="POST"
    action={data.scope === 'org' ? '?/org' : '?/user'}
    use:enhance={trackSubmission}
    class="flex flex-col gap-4"
  >
    {#if data.scope === 'org'}
      <Select
        id="onboarding-org-kind"
        name="kind"
        label={m.onboarding_orgKind()}
        value={data.org.kind}
        options={kindOptions}
      />
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select
          id="onboarding-org-timezone"
          name="timezone"
          label={m.step_timezone()}
          value={data.org.timezone}
          options={timezoneOptions}
          fieldClass="min-w-0"
        />
        <Select
          id="onboarding-org-currency"
          name="currency"
          label={m.onboarding_currency()}
          value={data.org.currency}
          options={currencyOptions}
          fieldClass="min-w-0"
        />
      </div>
    {:else}
      <Input
        id="onboarding-display-name"
        name="displayName"
        type="text"
        label={m.step_yourName()}
        value={data.user.displayName}
        placeholder={data.user.email}
        maxlength={120}
        size="touch"
        required
      />
      <Select
        id="onboarding-language"
        name="language"
        label={m.step_language()}
        value={data.languages[0] ?? 'en'}
        options={languageOptions}
      />
    {/if}

    <Button type="submit" variant="primary" size="touch" loading={submitting} class="w-full">
      {data.scope === 'org' ? m.step_continue() : m.onboarding_finish()}
    </Button>
    <Button
      type="submit"
      name="skip"
      value="1"
      formnovalidate
      variant="ghost"
      size="touch"
      disabled={submitting}
      class="w-full"
    >
      {m.onboarding_skip()}
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
</PublicTaskShell>
