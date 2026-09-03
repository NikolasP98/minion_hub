<script lang="ts">
  import type { PageData } from './$types';
  import { Sparkles, Plus, Trash2, Pencil, CalendarPlus } from 'lucide-svelte';
  import { invalidate } from '$app/navigation';
  import { PageHeader, Card, Button, Badge, EmptyState, iconSizes } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';
  import EventTypeEditor from '$lib/components/scheduling/EventTypeEditor.svelte';
  import { canAct } from '$lib/access/can.svelte';
  import { buildServiceRows } from '$lib/components/scheduling/service-rows';

  let { data }: { data: PageData } = $props();

  // 'new' | eventTypeId | null; `preset` seeds the editor for a dormant catalog service.
  let editing = $state<string | null>(null);
  let preset = $state<{ title: string; productId: string } | null>(null);

  const resourceOpts = $derived(
    data.resources.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      email: r.email,
      active: r.active,
    })),
  );
  const rows = $derived(buildServiceRows(data.services, data.eventTypes));
  const canEdit = $derived(canAct('scheduling', 'edit'));

  function enable(service: { id: string; name: string }) {
    preset = { title: service.name, productId: service.id };
    editing = 'new';
  }
  function close() {
    editing = null;
    preset = null;
  }

  function editorModel(id: string) {
    const et = data.eventTypes.find((e) => e.id === id);
    if (!et) return null;
    return {
      id: et.id,
      slug: et.slug,
      title: et.title,
      description: et.description,
      length: et.length,
      slotInterval: et.slotInterval,
      beforeBuffer: et.beforeBuffer,
      afterBuffer: et.afterBuffer,
      minimumBookingNotice: et.minimumBookingNotice,
      periodDays: et.periodDays,
      schedulingType: et.schedulingType,
      useCustomSchedule: et.useCustomSchedule,
      scheduleRules:
        (et.scheduleRules as Array<{ days: number[]; startTime: string; endTime: string }>) ?? [],
      requiresConfirmation: et.requiresConfirmation,
      public: et.public,
      productId: et.productId,
      resourceIds: et.resourceIds,
    };
  }

  async function onsaved() {
    close();
    await invalidate('scheduling:data');
  }
  async function remove(id: string) {
    await fetch(`/api/scheduling/event-types/${id}`, { method: 'DELETE' });
    await invalidate('scheduling:data');
  }
</script>

<svelte:head><title>{m.sched_eventTypes_title()} · {m.nav_scheduling()}</title></svelte:head>

<PageShell
  archetype="collection"
  scroll="region"
  labelledBy="scheduling-event-types-title"
  class="scheduling-event-types-surface"
>
  <PageHeader
    titleId="scheduling-event-types-title"
    title={m.sched_eventTypes_title()}
    subtitle={m.sched_dashboard_subtitle()}
  >
    {#snippet leading()}
      <Sparkles size={iconSizes.md} class="text-accent shrink-0" />
    {/snippet}
    {#snippet actions()}
      <Button
        size="sm"
        disabled={!canAct('scheduling', 'edit')}
        title={canAct('scheduling', 'edit') ? undefined : m.no_permission()}
        onclick={() => {
          preset = null;
          editing = 'new';
        }}><Plus size={iconSizes.sm} /> {m.sched_eventType_new()}</Button
      >
    {/snippet}
  </PageHeader>

  <PageBody padding="compact" scroll="region" class="flex flex-col gap-3">
    {#if editing === 'new'}
      <Card padding="lg">
        <EventTypeEditor
          {preset}
          resources={resourceOpts}
          products={data.services}
          {onsaved}
          oncancel={close}
        />
      </Card>
    {/if}

    {#if rows.length === 0 && editing !== 'new'}
      <EmptyState title={m.sched_empty_eventTypes()} />
    {:else}
      <p class="t-caption">{m.sched_service_dormant_help()}</p>
      {#each rows as row (row.key)}
        {@const et = row.eventType}
        <Card padding="md" class={et ? '' : 'service-dormant'}>
          {#if et && editing === et.id}
            <EventTypeEditor
              eventType={editorModel(et.id)}
              resources={resourceOpts}
              products={data.services}
              {onsaved}
              oncancel={close}
            />
          {:else if et}
            <div class="flex items-center gap-3">
              <div class="flex-1 min-w-0">
                <div class="font-medium truncate">
                  {et.title}
                  <Badge variant="semantic" value="success" size="sm"
                    >{m.sched_service_configured()}</Badge
                  >
                  {#if !row.service}<Badge>{m.sched_service_unlinked()}</Badge>{/if}
                  {#if !et.public}<Badge>private</Badge>{/if}
                  {#if !et.active}<Badge>off</Badge>{/if}
                </div>
                <div class="t-caption truncate">
                  /{et.slug} · {et.length}m · {et.resourceIds.length}
                  {m.sched_nav_resources()}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                class="icon-btn"
                disabled={!canEdit}
                title={canEdit ? undefined : m.no_permission()}
                onclick={() => (editing = et.id)}
                aria-label={m.sched_save()}
              >
                <Pencil size={iconSizes.sm} />
              </Button>
              {#if canAct('scheduling', 'delete')}
                <Button
                  variant="ghost"
                  size="sm"
                  class="icon-btn del"
                  onclick={() => remove(et.id)}
                  aria-label={m.sched_delete()}
                >
                  <Trash2 size={iconSizes.sm} />
                </Button>
              {/if}
            </div>
          {:else if row.service}
            <div class="flex items-center gap-3">
              <div class="flex-1 min-w-0">
                <div class="font-medium truncate">
                  {row.title}
                  <Badge>{m.sched_service_dormant()}</Badge>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={!canEdit}
                title={canEdit ? undefined : m.no_permission()}
                onclick={() => enable(row.service!)}
              >
                <CalendarPlus size={iconSizes.sm} />
                {m.sched_service_enable()}
              </Button>
            </div>
          {/if}
        </Card>
      {/each}
    {/if}
  </PageBody>
</PageShell>

<style>
  :global(.scheduling-event-types-surface .service-dormant) {
    color: var(--color-text-tertiary);
    background: var(--color-surface-1);
  }
</style>
