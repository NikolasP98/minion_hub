<script lang="ts">
  import { onMount } from 'svelte';
  import { ArrowLeft, ArrowRight, CalendarClock, Check } from 'lucide-svelte';
  import type { PageData } from './$types';
  import * as m from '$lib/paraglide/messages';
  import { Button, Input, Spinner } from '$lib/components/ui';
  import { PublicTaskShell } from '$lib/components/ui/foundations';

  let { data }: { data: PageData } = $props();

  type Step = 'service' | 'time' | 'details' | 'done';
  type Slot = { start: string; end: string };

  // svelte-ignore state_referenced_locally
  let step = $state<Step>(data.eventTypes.length === 1 ? 'time' : 'service');
  // svelte-ignore state_referenced_locally
  let eventTypeId = $state(data.eventTypes.length === 1 ? data.eventTypes[0].id : '');
  let windowSlots = $state<Slot[]>([]);
  let selectedDay = $state('');
  let customDate = $state('');
  let slot = $state('');
  let loading = $state(false);
  let name = $state('');
  let email = $state('');
  let phone = $state('');
  let err = $state<string | null>(null);
  let doneStatus = $state('accepted');

  const chosenService = $derived(data.eventTypes.find((eventType) => eventType.id === eventTypeId));

  const byDay = $derived.by(() => {
    const map = new Map<string, Slot[]>();
    for (const availableSlot of windowSlots) {
      const key = dayKey(availableSlot.start);
      const slots = map.get(key) ?? [];
      slots.push(availableSlot);
      map.set(key, slots);
    }
    return map;
  });
  const availableDays = $derived([...byDay.keys()].sort());
  const quickDays = $derived(availableDays.slice(0, 5));
  const daySlots = $derived(byDay.get(selectedDay) ?? []);

  const steps = $derived(
    (data.eventTypes.length > 1
      ? [
          { key: 'service', label: m.sched_book_step_service() },
          { key: 'time', label: m.sched_book_step_time() },
          { key: 'details', label: m.sched_book_step_details() },
          { key: 'done', label: m.sched_book_step_done() },
        ]
      : [
          { key: 'time', label: m.sched_book_step_time() },
          { key: 'details', label: m.sched_book_step_details() },
          { key: 'done', label: m.sched_book_step_done() },
        ]) as Array<{ key: Step; label: string }>,
  );
  const currentStepIndex = $derived(steps.findIndex((candidate) => candidate.key === step));

  function dayKey(iso: string): string {
    const date = new Date(iso);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function formatDay(key: string): { weekday: string; day: string } {
    const date = new Date(`${key}T00:00:00`);
    return {
      weekday: date.toLocaleDateString(undefined, { weekday: 'short' }),
      day: date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
    };
  }

  function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function formatDateTime(iso: string): string {
    return new Date(iso).toLocaleString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function selectService(id: string) {
    eventTypeId = id;
    step = 'time';
    void loadWindow();
  }

  async function loadWindow() {
    if (!eventTypeId) return;
    loading = true;
    err = null;
    slot = '';
    const from = new Date();
    const to = new Date(from.getTime() + 30 * 86_400_000);
    try {
      const response = await fetch(
        `/api/scheduling/public/${data.slug}/slots?eventTypeId=${eventTypeId}&from=${from.toISOString()}&to=${to.toISOString()}`,
      );
      if (!response.ok) throw new Error(`Availability request failed (${response.status})`);
      windowSlots = ((await response.json()).slots ?? []) as Slot[];
      const days = [
        ...new Set(windowSlots.map((availableSlot) => dayKey(availableSlot.start))),
      ].sort();
      if (!days.includes(selectedDay)) selectedDay = days[0] ?? '';
    } catch {
      windowSlots = [];
      selectedDay = '';
      err = 'We could not load availability. Please try again.';
    } finally {
      loading = false;
    }
  }

  async function loadCustomDay() {
    if (!customDate || !eventTypeId) return;
    slot = '';
    selectedDay = customDate;
    if (byDay.has(customDate)) return;

    loading = true;
    err = null;
    const from = new Date(`${customDate}T00:00:00`);
    const to = new Date(from.getTime() + 86_400_000);
    try {
      const response = await fetch(
        `/api/scheduling/public/${data.slug}/slots?eventTypeId=${eventTypeId}&from=${from.toISOString()}&to=${to.toISOString()}`,
      );
      if (!response.ok) throw new Error(`Availability request failed (${response.status})`);
      const fresh = ((await response.json()).slots ?? []) as Slot[];
      const seen = new Set(windowSlots.map((availableSlot) => availableSlot.start));
      windowSlots = [
        ...windowSlots,
        ...fresh.filter((availableSlot) => !seen.has(availableSlot.start)),
      ];
    } catch {
      err = 'We could not load that date. Please try another day.';
    } finally {
      loading = false;
    }
  }

  async function confirm() {
    if (!slot || !name.trim()) {
      err = 'Choose a time and enter your name.';
      return;
    }
    loading = true;
    err = null;
    try {
      const response = await fetch(`/api/scheduling/public/${data.slug}/book`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventTypeId,
          start: slot,
          name,
          email: email || null,
          phone: phone || null,
        }),
      });
      if (response.status === 409) {
        step = 'time';
        await loadWindow();
        err = m.sched_book_unavailable();
        return;
      }
      if (!response.ok) throw new Error(`Booking request failed (${response.status})`);
      const result = (await response.json()) as { status?: string };
      doneStatus = result.status ?? 'accepted';
      step = 'done';
    } catch (error) {
      err = error instanceof Error ? error.message : 'We could not complete this booking.';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    if (eventTypeId) void loadWindow();
  });
</script>

<svelte:head><title>{data.title}</title></svelte:head>

{#snippet taskIcon()}<CalendarClock size={20} />{/snippet}

<PublicTaskShell
  eyebrow={data.eventTypes.length > 0
    ? `${currentStepIndex + 1} / ${steps.length} · ${steps[currentStepIndex]?.label ?? ''}`
    : 'Public booking'}
  title={data.title}
  description={data.description ?? 'Choose a service and reserve an available time.'}
  tone={step === 'done' ? 'success' : 'default'}
  icon={taskIcon}
  size="medium"
>
  {#if data.eventTypes.length > 0}
    <ol class="mb-5 flex items-center" aria-label="Booking progress">
      {#each steps as progressStep, index (progressStep.key)}
        <li
          class="flex min-w-0 flex-1 items-center"
          aria-current={index === currentStepIndex ? 'step' : undefined}
        >
          <span
            class="flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-full)] border text-xs font-semibold
              {index <= currentStepIndex
              ? 'border-accent bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)] text-accent'
              : 'border-border bg-bg3 text-muted-foreground'}"
          >
            {#if index < currentStepIndex}<Check size={13} />{:else}{index + 1}{/if}
          </span>
          <span
            class="ml-2 hidden truncate text-xs sm:inline {index === currentStepIndex
              ? 'font-semibold text-foreground'
              : 'text-muted-foreground'}">{progressStep.label}</span
          >
          {#if index < steps.length - 1}
            <span
              class="mx-2 h-px min-w-3 flex-1 {index < currentStepIndex
                ? 'bg-accent'
                : 'bg-border'}"
              aria-hidden="true"
            ></span>
          {/if}
        </li>
      {/each}
    </ol>
  {/if}

  {#if step === 'done'}
    <div class="flex flex-col items-center gap-4 text-center" aria-live="polite">
      <span
        class="flex size-14 items-center justify-center rounded-[var(--radius-full)] border border-[color-mix(in_srgb,var(--color-success)_36%,transparent)] bg-[color-mix(in_srgb,var(--color-success)_12%,transparent)] text-success"
        aria-hidden="true"
      >
        <Check size={26} />
      </span>
      <div>
        <h2 class="text-base font-semibold text-foreground">
          {doneStatus === 'pending' ? m.sched_book_success_pending() : m.sched_book_done_title()}
        </h2>
        <p class="mt-1 text-sm leading-relaxed text-muted-foreground">
          {doneStatus === 'pending' ? m.sched_book_done_note_pending() : m.sched_book_done_note()}
        </p>
      </div>
      <dl
        class="w-full divide-y divide-border rounded-[var(--radius-lg)] border border-border bg-bg/50 px-4"
      >
        <div class="flex justify-between gap-4 py-3 text-left text-sm">
          <dt class="text-muted-foreground">{m.sched_book_step_service()}</dt>
          <dd class="text-right font-medium text-foreground">
            {chosenService?.title} · {chosenService?.length} min
          </dd>
        </div>
        <div class="flex justify-between gap-4 py-3 text-left text-sm">
          <dt class="text-muted-foreground">{m.sched_book_when()}</dt>
          <dd class="text-right font-medium text-foreground">{formatDateTime(slot)}</dd>
        </div>
        <div class="flex justify-between gap-4 py-3 text-left text-sm">
          <dt class="text-muted-foreground">{m.sched_book_name()}</dt>
          <dd class="text-right font-medium text-foreground">{name}</dd>
        </div>
      </dl>
    </div>
  {:else if data.eventTypes.length === 0}
    <div
      class="rounded-[var(--radius-md)] border border-border bg-bg/50 px-4 py-4 text-sm text-muted"
      role="status"
    >
      {m.sched_book_no_slots()}
    </div>
  {:else if step === 'service'}
    <div class="flex flex-col gap-3">
      <div>
        <h2 class="text-base font-semibold text-foreground">{m.sched_book_choose_service()}</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          Select the appointment you want to reserve.
        </p>
      </div>
      <div class="flex flex-col gap-2">
        {#each data.eventTypes as eventType (eventType.id)}
          <Button
            type="button"
            variant="secondary"
            size="touch"
            class="h-auto min-h-[var(--control-height-touch)] w-full whitespace-normal py-3"
            onclick={() => selectService(eventType.id)}
          >
            <span class="flex w-full min-w-0 items-center justify-between gap-3 text-left">
              <span class="truncate font-medium text-foreground">{eventType.title}</span>
              <span class="shrink-0 text-xs text-muted-foreground">{eventType.length} min</span>
            </span>
          </Button>
        {/each}
      </div>
    </div>
  {:else if step === 'time'}
    <div class="flex flex-col gap-4">
      <div>
        <h2 class="text-base font-semibold text-foreground">{m.sched_book_pick_time()}</h2>
        {#if chosenService}
          <p class="mt-1 text-sm text-muted-foreground">
            {chosenService.title} · {chosenService.length} min
          </p>
        {/if}
      </div>

      {#if loading && windowSlots.length === 0}
        <div class="flex min-h-28 items-center justify-center gap-2" role="status">
          <Spinner size="md" />
          <span class="text-sm text-muted-foreground">{m.sched_book_loading()}</span>
        </div>
      {:else}
        {#if quickDays.length > 0}
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {#each quickDays as key (key)}
              {@const day = formatDay(key)}
              <Button
                type="button"
                variant={selectedDay === key ? 'outline' : 'secondary'}
                size="touch"
                class="h-auto min-h-[var(--control-height-touch)] w-full whitespace-normal py-2"
                aria-pressed={selectedDay === key}
                onclick={() => {
                  selectedDay = key;
                  customDate = '';
                  slot = '';
                  err = null;
                }}
              >
                <span class="flex flex-col items-center gap-1">
                  <span class="text-xs uppercase tracking-wider text-muted-foreground"
                    >{day.weekday}</span
                  >
                  <span class="text-sm font-semibold text-foreground">{day.day}</span>
                </span>
              </Button>
            {/each}
          </div>
        {/if}

        <div class="flex flex-col gap-2">
          <label for="booking-custom-date" class="text-xs font-medium text-muted">
            {m.sched_book_other_date()}
          </label>
          <input
            id="booking-custom-date"
            type="date"
            bind:value={customDate}
            onchange={loadCustomDay}
            class="h-[var(--control-height-touch)] w-full rounded-[var(--radius-md)] border border-border bg-bg px-3 text-sm text-foreground outline-none transition-[border-color,box-shadow] duration-[var(--duration-fast)] focus-visible:border-accent focus-visible:shadow-[var(--shadow-focus)]"
          />
        </div>

        {#if loading}
          <div class="flex items-center gap-2 py-3" role="status">
            <Spinner size="sm" />
            <span class="text-xs text-muted-foreground">{m.sched_book_loading()}</span>
          </div>
        {:else if daySlots.length === 0}
          <p
            class="rounded-[var(--radius-md)] border border-border bg-bg/50 px-3 py-3 text-sm text-muted-foreground"
            role="status"
          >
            {m.sched_book_no_slots()}
          </p>
        {:else}
          <div class="grid max-h-60 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
            {#each daySlots as availableSlot (availableSlot.start)}
              <Button
                type="button"
                variant={slot === availableSlot.start ? 'primary' : 'secondary'}
                size="touch"
                aria-pressed={slot === availableSlot.start}
                onclick={() => {
                  slot = availableSlot.start;
                  err = null;
                }}
              >
                {formatTime(availableSlot.start)}
              </Button>
            {/each}
          </div>
        {/if}
      {/if}

      {#if err}
        <div
          class="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-destructive)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-destructive)_10%,transparent)] px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          <p>{err}</p>
          {#if windowSlots.length === 0}
            <Button type="button" variant="ghost" size="sm" onclick={loadWindow} class="mt-2">
              Retry availability
            </Button>
          {/if}
        </div>
      {/if}

      <div class="flex flex-col-reverse gap-2 sm:flex-row">
        {#if data.eventTypes.length > 1}
          <Button type="button" variant="secondary" size="touch" onclick={() => (step = 'service')}>
            <ArrowLeft size={16} />{m.sched_book_back()}
          </Button>
        {/if}
        <Button
          type="button"
          variant="primary"
          size="touch"
          disabled={!slot}
          onclick={() => (step = 'details')}
          class="flex-1"
        >
          {m.sched_book_continue()}<ArrowRight size={16} />
        </Button>
      </div>
    </div>
  {:else if step === 'details'}
    <form
      class="flex flex-col gap-4"
      onsubmit={(event) => {
        event.preventDefault();
        void confirm();
      }}
    >
      <div>
        <h2 class="text-base font-semibold text-foreground">{m.sched_book_your_details()}</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          {chosenService?.title} · {formatDateTime(slot)}
        </p>
      </div>
      <Input
        label={m.sched_book_name()}
        bind:value={name}
        autocomplete="name"
        size="touch"
        required
      />
      <Input
        label={m.sched_book_email()}
        bind:value={email}
        type="email"
        autocomplete="email"
        size="touch"
      />
      <Input
        label={m.sched_book_phone()}
        bind:value={phone}
        type="tel"
        autocomplete="tel"
        size="touch"
      />

      {#if err}
        <p
          class="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-destructive)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-destructive)_10%,transparent)] px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {err}
        </p>
      {/if}

      <div class="flex flex-col-reverse gap-2 sm:flex-row">
        <Button type="button" variant="secondary" size="touch" onclick={() => (step = 'time')}>
          <ArrowLeft size={16} />{m.sched_book_back()}
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="touch"
          {loading}
          disabled={!name.trim()}
          class="flex-1"
        >
          <Check size={16} />{m.sched_book_confirm()}
        </Button>
      </div>
    </form>
  {/if}
</PublicTaskShell>
