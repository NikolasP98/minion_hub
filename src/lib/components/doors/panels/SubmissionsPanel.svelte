<script lang="ts" module>
  import type { DoorKind } from '$lib/doors/types';
  export const kinds: DoorKind[] = ['form'];
</script>

<script lang="ts">
  import { Inbox, Lock, User } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { iconSizes, Button, EmptyState, Skeleton } from '$lib/components/ui';
  import { formatDate } from '$lib/utils/format';
  import type { DoorPanelProps } from '$lib/doors/types';
  import type { FormField, SubmissionRow } from '$lib/doors/kinds/form';

  let { door, canManage }: DoorPanelProps = $props();

  // Submissions can hold clinical free text: owner/admin only (crm:manage).
  let rows = $state<SubmissionRow[]>([]);
  let nextCursor = $state<string | null>(null);
  let loaded = $state(false);
  let loading = $state(false);
  let denied = $state(false);
  let failed = $state(false);

  const fields = $derived.by((): FormField[] => {
    const f = (door.config as { fields?: unknown } | null)?.fields;
    return Array.isArray(f) ? (f as FormField[]) : [];
  });

  async function load(cursor: string | null) {
    loading = true;
    failed = false;
    try {
      const qs = new URLSearchParams({ limit: '20' });
      if (cursor) qs.set('cursor', cursor);
      const res = await fetch(`/api/crm/doors/${encodeURIComponent(door.id)}/submissions?${qs}`);
      if (res.status === 403) {
        denied = true;
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const page = (await res.json()) as { rows: SubmissionRow[]; nextCursor: string | null };
      rows = cursor ? [...rows, ...page.rows] : page.rows;
      nextCursor = page.nextCursor;
      loaded = true;
    } catch {
      failed = true;
    } finally {
      loading = false;
    }
  }

  // Load once per door: a save re-hands the same door, which must not blank the list.
  let loadedFor = '';
  $effect(() => {
    if (!canManage || door.id === loadedFor) return;
    loadedFor = door.id;
    rows = [];
    nextCursor = null;
    loaded = false;
    denied = false;
    void load(null);
  });

  /** Answers in the form's current field order; keys no longer in the form follow. */
  function answers(values: Record<string, unknown>): Array<{ label: string; value: string }> {
    const known = fields.filter((f) => f.key in values);
    const extra = Object.keys(values).filter((k) => !fields.some((f) => f.key === k));
    const show = (v: unknown) =>
      v === true ? m.doors_form_yes() : v === false ? m.doors_form_no() : String(v ?? '');
    return [
      ...known.map((f) => ({ label: f.label, value: show(values[f.key]) })),
      ...extra.map((k) => ({ label: k, value: show(values[k]) })),
    ];
  }

  const when = (iso: string) => formatDate(iso, { dateStyle: 'medium', timeStyle: 'short' });

  const origin = (a: SubmissionRow['attribution']) =>
    [a.utm_source, a.utm_medium, a.utm_campaign, a.referrer_host].filter(Boolean).join(' / ');
</script>

<section class="card" aria-labelledby="door-submissions">
  <div class="card-h" id="door-submissions">
    <span><Inbox size={iconSizes.sm} /> {m.doors_form_submissions_title()}</span>
  </div>

  {#if !canManage || denied}
    <p class="t-body muted lock">
      <Lock size={iconSizes.sm} />
      {m.doors_form_submissions_no_permission()}
    </p>
  {:else if !loaded && !failed}
    <div class="stack">
      <Skeleton height="var(--control-height-lg)" />
      <Skeleton height="var(--control-height-lg)" />
    </div>
  {:else if !loaded && failed}
    <EmptyState compact tone="error" title={m.doors_form_submissions_error()}>
      {#snippet action()}
        <Button size="sm" variant="secondary" onclick={() => load(null)}>
          {m.doors_form_submissions_retry()}
        </Button>
      {/snippet}
    </EmptyState>
  {:else if loaded && rows.length === 0}
    <EmptyState compact icon={Inbox} title={m.doors_form_submissions_empty()} />
  {:else}
    <ol class="subs">
      {#each rows as row (row.id)}
        <li class="sub">
          <div class="sub-h">
            <span class="t-caption muted">{when(row.createdAt)}</span>
            {#if row.contactId}
              <a class="contact" href={`/crm/${row.contactId}`}>
                <User size={iconSizes.xs} />{row.contactName ?? row.contactId.slice(0, 8)}
              </a>
            {:else}
              <span class="t-caption muted">{m.doors_form_submission_no_contact()}</span>
            {/if}
          </div>
          <dl class="kv">
            {#each answers(row.values) as a, i (i)}
              <dt>{a.label}</dt>
              <dd>{a.value}</dd>
            {/each}
          </dl>
          <p class="t-caption muted meta">
            {row.consent
              ? m.doors_form_submission_consent_yes()
              : m.doors_form_submission_consent_no()}
            {#if origin(row.attribution)}
              · {m.doors_form_submission_origin({ origin: origin(row.attribution) })}
            {/if}
          </p>
        </li>
      {/each}
    </ol>
    {#if failed}
      <p class="t-caption error" role="alert">{m.doors_form_submissions_error()}</p>
    {/if}
    {#if nextCursor}
      <div>
        <Button size="sm" variant="secondary" {loading} onclick={() => load(nextCursor)}>
          {m.doors_form_submissions_more()}
        </Button>
      </div>
    {/if}
  {/if}
</section>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-card);
  }
  .card-h {
    text-transform: uppercase;
    font-size: var(--font-size-caption);
    font-weight: 600;
    letter-spacing: 0.03em;
    color: var(--color-text-secondary);
  }
  .card-h span,
  .lock,
  .contact {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }
  .muted {
    margin: 0;
    color: var(--color-text-secondary);
  }
  .error {
    margin: 0;
    color: var(--color-danger-fg);
  }
  .stack,
  .subs {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .subs {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .sub {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-card-compact);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
  }
  .sub-h {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
  }
  .contact {
    color: var(--color-accent);
    font-size: var(--font-size-caption);
    text-decoration: none;
  }
  .contact:hover {
    text-decoration: underline;
  }
  .kv {
    display: grid;
    grid-template-columns: minmax(8rem, max-content) minmax(0, 1fr);
    gap: var(--space-1) var(--space-3);
    margin: 0;
    font-size: var(--font-size-caption);
  }
  .kv dt {
    color: var(--color-text-secondary);
  }
  .kv dd {
    margin: 0;
    color: var(--color-text-primary);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  @media (max-width: 640px) {
    .kv {
      grid-template-columns: minmax(0, 1fr);
    }
    .kv dd {
      margin-bottom: var(--space-1);
    }
  }
</style>
