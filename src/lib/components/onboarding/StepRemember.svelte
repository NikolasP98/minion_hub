<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { submitOnEnter } from '$lib/hotkeys';
  import { Button, Input, Select } from '$lib/components/ui';
  import { FormField, type FormControlProps } from '$lib/components/ui/foundations';
  interface Props {
    userName: string;
    timezone: string;
    language: string;
    userContext: string;
    next: () => void;
    prev: () => void;
  }
  let {
    userName = $bindable(''),
    timezone = $bindable('America/Lima'),
    language = $bindable('es'),
    userContext = $bindable(''),
    next,
    prev,
  }: Props = $props();

  const timezoneIds = [
    'America/Lima',
    'America/Bogota',
    'America/Mexico_City',
    'America/Argentina/Buenos_Aires',
    'America/Santiago',
    'America/New_York',
    'America/Chicago',
    'America/Los_Angeles',
    'Europe/London',
    'Europe/Madrid',
    'Europe/Paris',
    'Europe/Berlin',
    'Asia/Tokyo',
    'Asia/Shanghai',
    'Asia/Kolkata',
  ];
  const languages = [
    { value: 'es', label: 'Español' },
    { value: 'en', label: 'English' },
    { value: 'pt', label: 'Português' },
    { value: 'fr', label: 'Français' },
    { value: 'de', label: 'Deutsch' },
  ];
  const timezones = timezoneIds.map((value) => ({
    value,
    label: value
      .replace('America/', '')
      .replace('Europe/', '')
      .replace('Asia/', '')
      .replace('_', ' '),
  }));
</script>

<div class="flex flex-col gap-5">
  <div>
    <h2 class="text-base font-semibold text-foreground">{m.step_title()}</h2>
    <p class="mt-1 text-sm leading-relaxed text-muted-foreground">{m.step_subtitle()}</p>
  </div>

  <Input
    id="onboarding-user-name"
    type="text"
    label={m.step_yourName()}
    bind:value={userName}
    placeholder={m.step_namePlaceholder()}
    maxlength={64}
    size="touch"
  />

  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <Select
      id="onboarding-timezone"
      label={m.step_timezone()}
      bind:value={timezone}
      options={timezones}
      class="min-w-0"
    />
    <Select
      id="onboarding-language"
      label={m.step_language()}
      bind:value={language}
      options={languages}
      class="min-w-0"
    />
  </div>

  {#snippet contextControl(control: FormControlProps)}
    <textarea
      {...control}
      bind:value={userContext}
      placeholder={m.step_contextPlaceholder()}
      rows={4}
      maxlength={500}
      class="min-h-28 w-full resize-y rounded-[var(--radius-md)] border border-border bg-bg px-3 py-2 text-sm leading-relaxed text-foreground outline-none transition-[border-color,box-shadow] duration-[var(--duration-fast)] placeholder:text-muted-foreground focus-visible:border-accent focus-visible:shadow-[var(--shadow-focus)]"
      {@attach submitOnEnter(() => next())}></textarea>
  {/snippet}
  <FormField
    id="onboarding-context"
    label={m.step_context()}
    helper={`${userContext.length}/500`}
    children={contextControl}
  />

  <div class="flex flex-col-reverse gap-2 sm:flex-row">
    <Button type="button" variant="secondary" size="touch" onclick={prev} class="sm:w-auto">
      ← {m.common_back()}
    </Button>
    <Button type="button" variant="primary" size="touch" onclick={next} class="flex-1">
      {m.step_continue()} →
    </Button>
  </div>
</div>
