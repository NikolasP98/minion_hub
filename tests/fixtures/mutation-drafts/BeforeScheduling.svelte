<script lang="ts">
  import type { PageData } from './$types';
  import { Settings, Plus, Trash2, Star } from 'lucide-svelte';
  import { invalidate } from '$app/navigation';
  import { page } from '$app/state';
  import { PageHeader, Card, Button, iconSizes } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';
  import { canAct } from '$lib/access/can.svelte';
  import { CRM_TAG_COLORS } from '$lib/components/crm/tag-colors';
  import { tryUseActions } from '$lib/services/actions/context';
  import { checkedRefresh } from '$lib/services/actions/refresh';
  import {
    requireOk,
    runCheckedMutation,
    runTrackedCommand,
  } from '$lib/services/actions/mutations';
  import { toastError } from '$lib/state/ui/toast.svelte';

  let { data }: { data: PageData } = $props();
  const kinds = $derived(data.kinds);
  const canEdit = $derived(canAct('scheduling', 'edit'));

  let busyId = $state<string | null>(null);
  let mutationError = $state<string | null>(null);
  const actions = tryUseActions();
  let commandScopeVersion = actions?.scopeVersion;
  let newName = $state('');
  // svelte-ignore state_referenced_locally -- seeded once, rotates after each add
  let newColor = $state<string>(CRM_TAG_COLORS[0]);

  $effect(() => {
    const scopeVersion = actions?.scopeVersion;
    if (scopeVersion === commandScopeVersion) return;
    commandScopeVersion = scopeVersion;
    busyId = null;
    mutationError = null;
  });

  async function mutateKind(
    commandId: 'create' | 'update' | 'delete',
    busyKey: string,
    request: (signal?: AbortSignal) => Promise<Response>,
    onCommitted?: () => void,
  ) {
    if (busyId) return;
    busyId = busyKey;
    mutationError = null;
    const scopeVersion = actions?.scopeVersion;
    try {
      const outcome = await runTrackedCommand(
        actions,
        `scheduling.event-kind.${commandId}`,
        (context) =>
          runCheckedMutation({
            context,
            attemptId: `scheduling.event-kind.${commandId}.write`,
            mutate: async (signal) => {
              const response = await request(signal);
              await requireOk(response, m.data_table_save_failed());
            },
            onCommitted,
            refresh: () =>
              checkedRefresh(
                () => invalidate('scheduling:data'),
                () => page,
              ),
            refreshAttemptId: `scheduling.event-kind.${commandId}.refresh`,
          }),
      );
      if (actions && actions.scopeVersion !== scopeVersion) return;
      if (outcome.status === 'succeeded') return;
      mutationError =
        outcome.status === 'committed-refreshing'
          ? m.asyncAction_refreshing()
          : outcome.status === 'unknown'
            ? m.asyncAction_unknown()
            : outcome.status === 'partial'
              ? m.asyncAction_partial()
              : outcome.error instanceof Error
                ? outcome.error.message
                : m.data_table_save_failed();
      toastError(mutationError);
    } finally {
      if (!actions || actions.scopeVersion === scopeVersion) busyId = null;
    }
  }
  async function patch(id: string, body: Record<string, unknown>) {
    await mutateKind('update', id, (signal) =>
      fetch(`/api/scheduling/event-kinds/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      }),
    );
  }
  function rename(id: string, name: string) {
    if (name.trim()) void patch(id, { name: name.trim() });
  }
  const recolor = (id: string, color: string) => patch(id, { color });
  const setDefault = (id: string) => patch(id, { isDefault: true });

  async function remove(id: string) {
    await mutateKind('delete', id, (signal) =>
      fetch(`/api/scheduling/event-kinds/${id}`, { method: 'DELETE', signal }),
    );
  }
  async function add() {
    const name = newName.trim();
    if (!name) return;
    const color = newColor;
    await mutateKind(
      'create',
      'new',
      (signal) =>
        fetch('/api/scheduling/event-kinds', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, color }),
          signal,
        }),
      () => {
        newName = '';
        newColor = CRM_TAG_COLORS[kinds.length % CRM_TAG_COLORS.length];
      },
    );
  }
</script>

<svelte:head><title>{m.sched_nav_settings()} · {m.nav_scheduling()}</title></svelte:head>

<PageShell archetype="form" scroll="region" labelledBy="scheduling-settings-title">
  <PageHeader
    titleId="scheduling-settings-title"
    title={m.sched_nav_settings()}
    subtitle={m.nav_scheduling()}
  >
    {#snippet leading()}
      <Settings size={16} class="text-accent shrink-0" />
    {/snippet}
  </PageHeader>
  <PageBody padding="compact" scroll="region" class="flex flex-col gap-3">
    <Card padding="lg" class="max-w-xl">
      <p class="text-sm text-[var(--color-muted-foreground)]">
        {m.sched_module_scheduling_desc()}
      </p>
      <p class="mt-3 text-sm">
        <a href="/settings/modules" class="text-accent underline">{m.settings_modules()}</a>
      </p>
    </Card>

    <Card padding="lg" class="max-w-xl kinds-card">
      <header class="card-h">{m.sched_kinds_title()}</header>
      {#if mutationError}
        <p class="mutation-error t-caption" role="alert">{mutationError}</p>
      {/if}
      <ul class="kinds-list">
        {#each kinds as k (k.id)}
          <li class="kind-row">
            <input
              type="color"
              class="swatch"
              value={k.color}
              disabled={!canEdit || busyId === k.id}
              aria-label={m.sched_kind_color_label()}
              onchange={(e) => recolor(k.id, e.currentTarget.value)}
            />
            <input
              class="txt"
              value={k.name}
              disabled={!canEdit || busyId === k.id}
              onblur={(e) => rename(k.id, e.currentTarget.value)}
              onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
            {#if k.isDefault}
              <span class="default-badge">{m.sched_kind_default_badge()}</span>
            {:else}
              <Button
                variant="ghost"
                size="sm"
                disabled={!canEdit || busyId === k.id}
                onclick={() => setDefault(k.id)}
              >
                <Star size={iconSizes.sm} />
                {m.sched_kind_set_default()}
              </Button>
            {/if}
            <Button
              variant="ghost"
              size="sm"
              disabled={!canEdit || k.isDefault || busyId === k.id}
              title={k.isDefault ? m.sched_kind_delete_disabled() : undefined}
              aria-label={m.sched_delete()}
              onclick={() => remove(k.id)}
            >
              <Trash2 size={iconSizes.sm} />
            </Button>
          </li>
        {/each}
      </ul>
      {#if canEdit}
        <div class="kind-add">
          <input
            type="color"
            class="swatch"
            bind:value={newColor}
            aria-label={m.sched_kind_color_label()}
          />
          <input
            class="txt"
            placeholder={m.sched_kind_name_placeholder()}
            bind:value={newName}
            onkeydown={(e) => e.key === 'Enter' && add()}
          />
          <Button size="sm" onclick={add} disabled={busyId === 'new' || !newName.trim()}>
            <Plus size={iconSizes.sm} />
            {m.sched_kind_add()}
          </Button>
        </div>
      {/if}
    </Card>
  </PageBody>
</PageShell>

<style>
  .card-h {
    font-weight: 600;
    margin-bottom: var(--space-3);
  }
  .kinds-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .mutation-error {
    color: var(--color-danger-fg);
    margin-bottom: var(--space-2);
  }
  .kind-row,
  .kind-add {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .kind-add {
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--hairline);
  }
  .swatch {
    width: 1.75rem;
    height: 1.75rem;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: none;
    flex-shrink: 0;
  }
  .txt {
    flex: 1;
    min-width: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-2);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font-size: var(--font-size-body);
  }
  .default-badge {
    font-size: var(--font-size-caption, 12px);
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 14%, transparent);
    border-radius: var(--radius-full);
    padding: var(--space-0-5, 2px) var(--space-2);
    white-space: nowrap;
  }
</style>
