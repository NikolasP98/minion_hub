<script lang="ts" module>
  import type { DoorKind } from '$lib/doors/types';
  export const kinds: DoorKind[] = ['form'];
</script>

<script lang="ts">
  import { MessageCircle } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { iconSizes, Button, Chip, Input, Select, Toggle } from '$lib/components/ui';
  import type { ChipStatus } from '$lib/components/ui';
  import { FormField } from '$lib/components/ui/foundations';
  import { toastSuccess } from '$lib/state/ui/toast.svelte';
  import { formatDate } from '$lib/utils/format';
  import type { DoorPanelProps } from '$lib/doors/types';

  let { door, canManage }: DoorPanelProps = $props();

  type FollowUp = { enabled: boolean; delayMinutes: number; accountId: string; template: string };
  type Row = {
    id: string;
    contactId: string;
    contactName: string | null;
    status: 'sending' | 'sent' | 'failed' | 'skipped';
    reason: string | null;
    error: string | null;
    createdAt: string;
  };
  type View = {
    followUp: FollowUp | null;
    accounts: { accountId: string; name: string | null; phone: string | null }[] | null;
    counts: { sent: number; failed: number; skipped: number };
    rows: Row[];
  };

  // The number input binds a string; the PUT sends a number.
  type Draft = Omit<FollowUp, 'delayMinutes'> & { delayMinutes: string };
  const DEFAULTS: Draft = { enabled: false, delayMinutes: '60', accountId: '', template: '' };

  let view = $state<View | null>(null);
  let loadError = $state(false);
  let draft = $state<Draft>({ ...DEFAULTS });
  let saving = $state(false);
  let saveError = $state<string | null>(null);

  async function load() {
    loadError = false;
    try {
      const res = await fetch(`/api/crm/doors/${encodeURIComponent(door.id)}/follow-up`);
      if (!res.ok) throw new Error(String(res.status));
      view = (await res.json()) as View;
      const saved = view.followUp;
      // Copy only the editable fields: the server-stamped `enabledAt` must not be PUT back.
      draft = saved
        ? {
            enabled: saved.enabled,
            delayMinutes: String(saved.delayMinutes),
            accountId: saved.accountId,
            template: saved.template,
          }
        : { ...DEFAULTS };
    } catch {
      loadError = true;
    }
  }

  // Only owners/admins (crm:manage) may read who submitted the form.
  $effect(() => {
    if (canManage && door.id) void load();
  });

  const accountOptions = $derived([
    { value: '', label: m.doors_followup_choose() },
    ...(view?.accounts ?? []).map((a) => ({
      value: a.accountId,
      label: [a.name, a.phone].filter(Boolean).join(' · ') || a.accountId,
    })),
  ]);

  const statusChip: Record<Row['status'], ChipStatus> = {
    sending: 'info',
    sent: 'success',
    failed: 'danger',
    skipped: 'warning',
  };
  const statusLabel = (s: Row['status']) =>
    ({
      sending: m.doors_followup_status_sending,
      sent: m.doors_followup_status_sent,
      failed: m.doors_followup_status_failed,
      skipped: m.doors_followup_status_skipped,
    })[s]();
  const reasonLabel = (r: string | null) =>
    (
      ({
        opted_out: m.doors_followup_reason_opted_out,
        no_identity: m.doors_followup_reason_no_identity,
        bought: m.doors_followup_reason_bought,
        booked: m.doors_followup_reason_booked,
        replied: m.doors_followup_reason_replied,
      }) as Record<string, () => string>
    )[r ?? '']?.() ?? null;

  async function save() {
    if (!canManage || saving) return;
    saving = true;
    saveError = null;
    try {
      const res = await fetch(`/api/crm/doors/${encodeURIComponent(door.id)}/follow-up`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...draft, delayMinutes: Number(draft.delayMinutes) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        saveError =
          res.status === 403
            ? m.doors_followup_no_permission()
            : body.error === 'account_not_available'
              ? m.doors_followup_account_invalid()
              : body.error === 'gateway_unavailable'
                ? m.doors_followup_unreachable()
                : res.status === 400
                  ? m.doors_followup_invalid()
                  : m.doors_followup_save_error();
        // The switch must show what is actually saved, not the rejected change.
        draft.enabled = view?.followUp?.enabled ?? false;
        return;
      }
      toastSuccess(m.doors_followup_saved());
      await load();
    } catch {
      saveError = m.doors_followup_save_error();
    } finally {
      saving = false;
    }
  }
</script>

<section class="card" aria-labelledby="door-followup">
  <div class="card-h" id="door-followup">
    <span><MessageCircle size={iconSizes.sm} /> {m.doors_followup_title()}</span>
  </div>

  {#if !canManage}
    <p class="t-caption muted">{m.doors_followup_no_permission()}</p>
  {:else if loadError}
    <p class="t-caption muted" role="alert">{m.doors_followup_load_error()}</p>
  {:else if view}
    <div class="fields">
      <p class="t-caption muted">{m.doors_followup_desc()}</p>
      <Toggle
        checked={draft.enabled}
        disabled={saving}
        label={m.doors_followup_enabled()}
        onchange={(checked) => (draft.enabled = checked)}
      />
      <FormField
        label={m.doors_followup_delay()}
        helper={m.doors_followup_delay_hint()}
        required
        disabled={saving}
      >
        {#snippet children(p)}<Input
            {...p}
            type="number"
            min={15}
            max={10080}
            bind:value={draft.delayMinutes}
          />{/snippet}
      </FormField>
      <Select
        label={m.doors_followup_account()}
        helper={view.accounts === null
          ? m.doors_followup_unreachable()
          : view.accounts.length === 0
            ? m.doors_followup_account_none()
            : undefined}
        value={draft.accountId}
        options={accountOptions}
        disabled={saving || !view.accounts?.length}
        onchange={(v) => (draft.accountId = String(v ?? ''))}
      />
      <FormField
        label={m.doors_followup_template()}
        helper={m.doors_followup_template_hint({ token: '{nombre}' })}
        required
        disabled={saving}
      >
        {#snippet children(p)}<textarea
            {...p}
            class="ta"
            rows="3"
            maxlength={1000}
            bind:value={draft.template}></textarea>{/snippet}
      </FormField>
      {#if saveError}
        <p class="save-error" role="alert">{saveError}</p>
      {/if}
      <div class="actions">
        <Button size="sm" onclick={save} loading={saving}>{m.doors_save()}</Button>
      </div>
    </div>

    <div class="counts">
      <Chip status="success" count={view.counts.sent}>{m.doors_followup_count_sent()}</Chip>
      <Chip status="danger" count={view.counts.failed}>{m.doors_followup_count_failed()}</Chip>
      <Chip status="warning" count={view.counts.skipped}>{m.doors_followup_count_skipped()}</Chip>
    </div>

    <h3 class="t-caption muted recent">{m.doors_followup_recent()}</h3>
    {#if view.rows.length === 0}
      <p class="t-caption muted">{m.doors_followup_empty()}</p>
    {:else}
      <ul class="rows">
        {#each view.rows as row (row.id)}
          <li>
            <a href={`/crm/${row.contactId}`}>{row.contactName ?? m.doors_followup_unnamed()}</a>
            <Chip status={statusChip[row.status]}>{statusLabel(row.status)}</Chip>
            <span class="t-caption muted detail">{reasonLabel(row.reason) ?? row.error ?? ''}</span>
            <time class="t-caption muted" datetime={row.createdAt}
              >{formatDate(row.createdAt, { dateStyle: 'short', timeStyle: 'short' })}</time
            >
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<style>
  .card {
    background: var(--color-surface-1);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-card);
  }
  .card-h {
    display: flex;
    align-items: center;
    margin-bottom: var(--space-3);
    text-transform: uppercase;
    font-size: var(--font-size-caption);
    font-weight: 600;
    letter-spacing: 0.03em;
    color: var(--color-text-secondary);
  }
  .card-h span {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }
  .fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .muted {
    color: var(--color-text-secondary);
    margin: 0;
  }
  .ta {
    width: 100%;
    min-height: 4.5rem;
    padding: var(--space-2);
    font: inherit;
    line-height: 1.4;
    resize: vertical;
    color: var(--color-text-primary);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
  }
  .counts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-4);
  }
  .recent {
    margin-top: var(--space-4);
    margin-bottom: var(--space-2);
    font-weight: 600;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .rows li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .rows a {
    color: var(--color-text-primary);
    font-weight: 500;
  }
  .rows a:hover {
    color: var(--color-accent);
  }
  .detail {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .save-error {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-danger-border);
    border-radius: var(--radius-md);
    color: var(--color-danger-fg);
    background: var(--color-danger-surface);
    font-size: var(--font-size-caption);
  }
</style>
