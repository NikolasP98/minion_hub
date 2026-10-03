<script lang="ts">
  // Legacy arbitrary-table rules and the durable event worker have separate,
  // explicitly labelled delivery status until the legacy path is qualified.
  import type { PageData } from './$types';
  import { invalidate } from '$app/navigation';
  import { page } from '$app/state';
  import { onDestroy, tick, untrack } from 'svelte';
  import { PageHeader, Badge, Button, Card, Select } from '$lib/components/ui';
  import NotificationWorkerHealthPanel from '$lib/components/notifications/NotificationWorkerHealthPanel.svelte';
  import { createNotificationHealthController } from '$lib/components/notifications/notification-health.svelte';
  import { tryUseActions } from '$lib/services/actions/context';
  import {
    requireOk,
    runCheckedMutation,
    runTrackedCommand,
  } from '$lib/services/actions/mutations';
  import { checkedRefresh } from '$lib/services/actions/refresh';
  import * as m from '$lib/paraglide/messages';

  let { data }: { data: PageData } = $props();
  const health = createNotificationHealthController(
    untrack(() => ({ actorId: data.user.supabaseId, orgId: data.activeOrgId })),
    untrack(() => data.healthSeed),
  );
  const actions = tryUseActions();
  const mutationControllers = new Set<AbortController>();
  let formOwnerKey = untrack(() => ownerKey(data.user.supabaseId, data.activeOrgId));
  let ownerVersion = 0;
  let nextMutationId = 0;
  let activeMutationId = 0;

  function ownerKey(actorId: string | null | undefined, orgId: string | null | undefined): string | null {
    return actorId && orgId ? JSON.stringify([actorId, orgId]) : null;
  }

  $effect.pre(() => {
    const identity = { actorId: data.user.supabaseId, orgId: data.activeOrgId };
    const seed = data.healthSeed;
    const nextOwnerKey = ownerKey(identity.actorId, identity.orgId);
    untrack(() => {
      if (nextOwnerKey !== formOwnerKey) {
        formOwnerKey = nextOwnerKey;
        ownerVersion += 1;
        activeMutationId = ++nextMutationId;
        for (const controller of mutationControllers) controller.abort();
        mutationControllers.clear();
        resetForOwnerChange(nextOwnerKey);
      }
      health.reconcile(identity, seed);
    });
  });

  onDestroy(() => {
    ownerVersion += 1;
    activeMutationId = ++nextMutationId;
    for (const controller of mutationControllers) controller.abort();
    mutationControllers.clear();
    health.dispose();
  });

  const EVENTS = ['insert', 'update', 'date_offset'];
  const CHANNELS = ['whatsapp', 'telegram', 'email'];
  const TABLE_LABEL: Record<string, string> = {
    support_issues: m.notif_table_supportIssues(),
    sales_orders: m.notif_table_salesOrders(),
    crm_contacts: m.notif_table_crmContacts(),
    sched_bookings: m.notif_table_schedBookings(),
    fin_invoices: m.notif_table_finInvoices(),
  };

  let editId = $state<string | null>(null);
  let name = $state('');
  let enabled = $state(true);
  let triggerTable = $state('support_issues');
  let triggerEvent = $state('insert');
  let dateField = $state('');
  let dateOffsetMins = $state(0);
  let channel = $state('whatsapp');
  let accountId = $state('');
  let conditionText = $state('[]');
  let recipientsText = $state('[{ "type": "static", "value": "" }]');
  let template = $state('');
  let err = $state(formOwnerKey === null ? m.notif_identityUnavailable() : '');
  let busy = $state(false);
  let mutationBlocked = $state(formOwnerKey === null);
  let editorCard: HTMLDivElement | undefined;
  let nameInput: HTMLInputElement | undefined;
  let editTrigger: HTMLButtonElement | null = null;

  const dateFields = $derived(data.tables.find((t) => t.table === triggerTable)?.dateFields ?? []);

  function reset() {
    editTrigger = null;
    editId = null;
    name = '';
    enabled = true;
    triggerTable = 'support_issues';
    triggerEvent = 'insert';
    dateField = '';
    dateOffsetMins = 0;
    channel = 'whatsapp';
    accountId = '';
    conditionText = '[]';
    recipientsText = '[{ "type": "static", "value": "" }]';
    template = '';
    err = '';
  }

  function resetForOwnerChange(nextOwnerKey: string | null): void {
    reset();
    busy = false;
    mutationBlocked = nextOwnerKey === null;
    if (nextOwnerKey === null) err = m.notif_identityUnavailable();
    nameInput?.blur();
  }

  function prefersReducedMotion(): boolean {
    return (
      typeof globalThis.matchMedia === 'function' &&
      globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  async function revealEditor(
    capturedOwnerKey: string,
    capturedOwnerVersion: number,
    capturedEditId: string,
    capturedTrigger: HTMLButtonElement,
  ): Promise<void> {
    await tick();
    if (
      formOwnerKey !== capturedOwnerKey ||
      ownerVersion !== capturedOwnerVersion ||
      editId !== capturedEditId ||
      editTrigger !== capturedTrigger
    )
      return;
    editorCard?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start',
    });
    nameInput?.focus({ preventScroll: true });
  }

  function loadRule(r: (typeof data.rules)[number], event: MouseEvent) {
    const trigger = event.currentTarget;
    if (!(trigger instanceof HTMLButtonElement)) return;
    if (formOwnerKey === null) {
      err = m.notif_identityUnavailable();
      return;
    }
    const capturedOwnerKey = formOwnerKey;
    editTrigger = trigger;
    editId = r.id;
    name = r.name;
    enabled = r.enabled;
    triggerTable = r.triggerTable;
    triggerEvent = r.triggerEvent;
    dateField = r.dateField ?? '';
    dateOffsetMins = r.dateOffsetMins ?? 0;
    channel = r.channel;
    accountId = r.accountId ?? '';
    conditionText = JSON.stringify(r.condition ?? [], null, 2);
    recipientsText = JSON.stringify(r.recipients ?? [], null, 2);
    template = r.template;
    err = '';
    void revealEditor(capturedOwnerKey, ownerVersion, r.id, trigger);
  }

  async function cancelEdit(): Promise<void> {
    const capturedOwnerKey = formOwnerKey;
    const capturedOwnerVersion = ownerVersion;
    const trigger = editTrigger;
    reset();
    await tick();
    if (
      formOwnerKey !== capturedOwnerKey ||
      ownerVersion !== capturedOwnerVersion ||
      editId !== null ||
      editTrigger !== null ||
      !trigger?.isConnected
    )
      return;
    trigger.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'center',
    });
    trigger.focus({ preventScroll: true });
  }

  function mutationIsCurrent(
    capturedOwnerKey: string,
    capturedOwnerVersion: number,
    mutationId: number,
    actionScopeVersion: number | undefined,
  ): boolean {
    return (
      formOwnerKey === capturedOwnerKey &&
      ownerKey(data.user.supabaseId, data.activeOrgId) === capturedOwnerKey &&
      ownerVersion === capturedOwnerVersion &&
      activeMutationId === mutationId &&
      actions?.scopeVersion === actionScopeVersion
    );
  }

  async function mutateRule(
    kind: 'save' | 'delete',
    input: string,
    init: RequestInit,
    onCommitted: () => void,
  ): Promise<void> {
    if (busy || mutationBlocked || formOwnerKey === null) {
      if (formOwnerKey === null) err = m.notif_identityUnavailable();
      return;
    }
    const capturedOwnerKey = formOwnerKey;
    const capturedOwnerVersion = ownerVersion;
    const mutationId = ++nextMutationId;
    const actionScopeVersion = actions?.scopeVersion;
    activeMutationId = mutationId;
    const controller = new AbortController();
    mutationControllers.add(controller);
    busy = true;
    err = '';
    const current = () =>
      mutationIsCurrent(capturedOwnerKey, capturedOwnerVersion, mutationId, actionScopeVersion);
    try {
      const outcome = await runTrackedCommand(
        actions,
        `settings.notification-rule.${kind}`,
        (context) =>
          runCheckedMutation({
            context,
            attemptId: `settings.notification-rule.${kind}.write`,
            mutate: async (signal) => {
              const requestSignal = signal
                ? AbortSignal.any([signal, controller.signal])
                : controller.signal;
              const response = await fetch(input, { ...init, signal: requestSignal });
              await requireOk(response, m.common_error());
            },
            onCommitted: () => {
              if (current()) onCommitted();
            },
            refresh: async () => {
              if (!current()) return;
              await checkedRefresh(
                () => invalidate('settings:notifications'),
                () => page,
              );
            },
            refreshAttemptId: `settings.notification-rule.${kind}.refresh`,
          }),
      );
      if (!current()) return;
      if (outcome.status === 'succeeded') return;
      if (outcome.status === 'committed-refreshing') {
        mutationBlocked = true;
        err = m.asyncAction_refreshing();
      } else if (outcome.status === 'unknown') {
        mutationBlocked = true;
        err = m.asyncAction_unknown();
      } else if (outcome.status === 'partial') {
        mutationBlocked = true;
        err = m.asyncAction_partial();
      } else {
        err = outcome.error instanceof Error ? outcome.error.message : m.common_error();
      }
    } finally {
      mutationControllers.delete(controller);
      if (current()) busy = false;
    }
  }

  async function save() {
    err = '';
    let condition: unknown, recipients: unknown;
    try {
      condition = JSON.parse(conditionText);
      recipients = JSON.parse(recipientsText);
      if (!Array.isArray(condition) || !Array.isArray(recipients))
        throw new Error('condition and recipients must be arrays');
    } catch (e) {
      err = m.notif_errInvalidJson({ message: e instanceof Error ? e.message : String(e) });
      return;
    }
    if (!name.trim() || !template.trim()) {
      err = m.notif_errNameTemplate();
      return;
    }
    const payload = {
      name,
      enabled,
      triggerTable,
      triggerEvent,
      channel,
      accountId: accountId.trim() || null,
      dateField: triggerEvent === 'date_offset' ? dateField || null : null,
      dateOffsetMins: triggerEvent === 'date_offset' ? Number(dateOffsetMins) : null,
      condition,
      recipients,
      template,
    };
    const ruleId = editId;
    await mutateRule(
      'save',
      ruleId ? `/api/notifications/rules/${ruleId}` : '/api/notifications/rules',
      {
        method: ruleId ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      },
      reset,
    );
  }

  async function remove(id: string) {
    await mutateRule('delete', `/api/notifications/rules/${id}`, { method: 'DELETE' }, () => {
      if (editId === id) reset();
    });
  }
</script>

<PageHeader title={m.notif_title()} subtitle={m.notif_subtitle()} />

<div class="wrap">
  <NotificationWorkerHealthPanel {health} />

  <Card elevation={1} padding="md" class="legacy-context">
    <strong>{m.notif_legacyDeliveryUnverified()}</strong>
    <span class="t-caption text-muted">{m.notif_legacyDeliveryDetail()}</span>
  </Card>

  <div class="card editor" bind:this={editorCard}>
    <h3>{editId ? m.notif_editRule() : m.notif_newRule()}</h3>
    <div class="grid">
      <label
        >{m.notif_name()}<input
          class="inp"
          bind:this={nameInput}
          bind:value={name}
          placeholder="Urgent ticket → on-call"
        /></label
      >
      <label
        >{m.notif_channel()}
        <Select size="sm" bind:value={channel}
          >{#each CHANNELS as c (c)}<option value={c}>{c}</option>{/each}</Select
        >
      </label>
      <label
        >{m.notif_whenTable()}
        <Select size="sm" bind:value={triggerTable}
          >{#each data.tables as t (t.table)}<option value={t.table}
              >{TABLE_LABEL[t.table] ?? t.table}</option
            >{/each}</Select
        >
      </label>
      <label
        >{m.notif_event()}
        <Select size="sm" bind:value={triggerEvent}
          >{#each EVENTS as e (e)}<option value={e}>{e}</option>{/each}</Select
        >
      </label>
    </div>

    {#if triggerEvent === 'date_offset'}
      <div class="grid">
        <label
          >{m.notif_dateField()}
          <Select size="sm" bind:value={dateField}>
            <option value="">—</option>
            {#each dateFields as f (f)}<option value={f}>{f}</option>{/each}
          </Select>
        </label>
        <label
          >{m.notif_offsetMins()}<input
            class="inp"
            type="number"
            bind:value={dateOffsetMins}
          /></label
        >
      </div>
    {/if}

    <label class="block">{m.notif_accountId()}<input class="inp" bind:value={accountId} /></label>
    <label class="block"
      >{m.notif_condition()} (JSON:
      <code>[{`{ "field": "priority", "op": "eq", "value": "urgent" }`}]</code>)
      <textarea class="inp ta" rows="3" bind:value={conditionText}></textarea>
    </label>
    <label class="block"
      >{m.notif_recipients()} (JSON:
      <code>[{`{ "type": "field"|"static", "value": "phone"|"+51..." }`}]</code>)
      <textarea class="inp ta" rows="3" bind:value={recipientsText}></textarea>
    </label>
    <label class="block"
      >{m.notif_template()} (<code>{`{{field}}`}</code>
      {m.notif_templateHint()})
      <textarea
        class="inp ta"
        rows="3"
        bind:value={template}
        placeholder={'Ticket {{subject}} is now {{status}}'}></textarea>
    </label>
    <label class="row"><input type="checkbox" bind:checked={enabled} /> {m.notif_enabled()}</label>
    {#if err}<p class="err">{err}</p>{/if}
    <div class="actions">
      <Button onclick={save} disabled={busy || mutationBlocked || !name.trim()}
        >{editId ? m.notif_updateRule() : m.notif_createRule()}</Button
      >
      {#if editId}<Button variant="ghost" disabled={busy} onclick={() => void cancelEdit()}
          >{m.common_cancel()}</Button
        >{/if}
    </div>
  </div>

  {#each data.rules as r (r.id)}
    <div class="card def">
      <div class="def-head">
        <strong>{r.name}</strong>
        {#if r.enabled}
          <Badge variant="semantic" value="success" size="sm">{m.notif_enabled()}</Badge>
          {#if health.warning}
            <span class="rule-health-warning" role="status">{m.notif_legacyWorkerWarning()}</span>
          {/if}
        {:else}
          <Badge variant="neutral" size="sm">{m.notif_disabled()}</Badge>
        {/if}
        <div class="spacer"></div>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || mutationBlocked}
          onclick={(event) => loadRule(r, event)}>{m.common_edit()}</Button
        >
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || mutationBlocked}
          onclick={() => remove(r.id)}>{m.common_delete()}</Button
        >
      </div>
      <div class="muted small">
        {TABLE_LABEL[r.triggerTable] ?? r.triggerTable} · {r.triggerEvent} → {r.channel}
      </div>
    </div>
  {:else}
    <p class="muted small">{m.notif_empty()}</p>
  {/each}
</div>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4) var(--space-page-gutter, 16px);
    max-width: calc(720px + var(--space-page-gutter, 16px) + var(--space-page-gutter, 16px));
  }
  :global(.legacy-context) {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .card {
    padding: var(--space-4) var(--space-4);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    background: var(--color-bg2);
  }
  .card h3 {
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-page-title);
  }
  .editor {
    scroll-margin-block-start: calc(var(--page-header-height, 56px) + var(--space-4));
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--font-size-body);
    opacity: 0.9;
  }
  .block {
    margin-bottom: var(--space-2);
  }
  .row {
    flex-direction: row;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }
  .inp {
    padding: var(--space-2) var(--space-2);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    background: var(--color-bg3);
    color: inherit;
    font-size: var(--font-size-body);
  }
  .ta {
    font-family: var(--font-mono, monospace);
    font-size: var(--font-size-body);
  }
  .actions {
    display: flex;
    gap: var(--space-2);
  }
  .def-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .spacer {
    flex: 1;
  }
  .muted {
    opacity: 0.7;
  }
  .small {
    font-size: var(--font-size-body);
    margin-top: var(--space-1);
  }
  .err {
    color: var(--color-danger-fg);
    font-size: var(--font-size-body);
  }
  .rule-health-warning {
    color: var(--color-warning-fg);
    font-size: var(--font-size-caption);
  }
  code {
    font-size: var(--font-size-caption);
    opacity: 0.8;
  }
  @media (max-width: 767.98px) {
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .actions,
    .def-head {
      align-items: stretch;
      flex-wrap: wrap;
    }
    .def-head .spacer {
      display: none;
    }
    .def-head strong {
      width: 100%;
    }
    .actions :global(button),
    .def-head :global(button) {
      min-height: var(--control-height-touch);
    }
  }
</style>
