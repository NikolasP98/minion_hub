<script lang="ts">
  import { ShieldCheck } from 'lucide-svelte';
  import { deserialize } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import * as m from '$lib/paraglide/messages';
  import { Button, iconSizes, PageHeader, Select } from '$lib/components/ui';
  import { AsyncBoundary, PageBody, PageShell } from '$lib/components/ui/foundations';
  import { createOptimistic } from '$lib/utils/optimistic';
  import { formatDate } from '$lib/utils/format';
  import { toastError } from '$lib/state/ui/toast.svelte';

  const { data } = $props();

  const planOverlay = createOptimistic<string>();
  // svelte-ignore state_referenced_locally
  let selectedId = $state<string | null>(data.orgs[0]?.id ?? null);
  const selected = $derived(data.orgs.find((o) => o.id === selectedId) ?? data.orgs[0] ?? null);

  async function setPlan(orgId: string, planKey: string) {
    const ok = await planOverlay.run(orgId, planKey, async () => {
      const body = new FormData();
      body.set('orgId', orgId);
      body.set('planKey', planKey);
      const res = await fetch('?/setPlan', {
        method: 'POST',
        body,
        headers: { 'x-sveltekit-action': 'true' },
      });
      const accepted = deserialize(await res.text()).type === 'success';
      // Refresh inside the commit so the overlay never flashes the stale plan.
      if (accepted) await invalidateAll();
      return accepted;
    });
    if (!ok) toastError(m.admin_plans_saveFailed());
  }

  // Catalog labels are English source text; the page shows translated names by key.
  const PLAN_LABELS: Record<string, () => string> = {
    base: m.admin_plans_plan_base,
    premium: m.admin_plans_plan_premium,
  };
  const FEATURE_LABELS: Record<string, () => string> = {
    ai: m.admin_plans_feat_ai,
    'ai.chat': m.admin_plans_feat_ai_chat,
    'ai.proactive': m.admin_plans_feat_ai_proactive,
    marketplace: m.admin_plans_feat_marketplace,
  };
  const REASON_LABELS: Record<string, () => string> = {
    ok: m.admin_plans_reason_ok,
    not_in_plan: m.admin_plans_reason_not_in_plan,
    rule_false: m.admin_plans_reason_rule_false,
  };
  const KIND_LABELS: Record<string, () => string> = {
    business: m.admin_plans_kind_business,
    personal: m.admin_plans_kind_personal,
  };
  const planLabel = (k: string) => PLAN_LABELS[k]?.() ?? k;
  const featureLabel = (k: string, fallback: string) => FEATURE_LABELS[k]?.() ?? fallback;
  const reasonLabel = (r: string) => REASON_LABELS[r]?.() ?? r;
  const kindLabel = (k: string) => KIND_LABELS[k]?.() ?? k;

  const when = (iso: string) => formatDate(iso, { dateStyle: 'medium', timeStyle: 'short' });
</script>

<PageShell archetype="collection" scroll="page" labelledBy="org-plans-title">
  <PageHeader
    titleId="org-plans-title"
    title={m.admin_plans_title()}
    subtitle={m.admin_plans_subtitle()}
  >
    {#snippet leading()}<ShieldCheck size={iconSizes.md} class="shrink-0 text-accent" />{/snippet}
  </PageHeader>
  <PageBody width="content">
    <AsyncBoundary
      state={data.orgs.length === 0
        ? { kind: 'empty', title: m.admin_plans_empty(), description: '' }
        : { kind: 'ready' }}
    >
      <ul class="plan-list" aria-label={m.admin_plans_orgsLabel()}>
        {#each data.orgs as org (org.id)}
          <li class="plan-row" class:is-selected={org.id === selected?.id}>
            <Button variant="ghost" class="plan-org" onclick={() => (selectedId = org.id)}>
              <span class="block truncate text-sm font-medium text-foreground">{org.name}</span>
              <span class="block truncate font-mono text-xs text-muted">
                {kindLabel(org.kind)} · {m.admin_plans_members({ count: org.members })} ·
                {org.planSource === 'row' ? m.admin_plans_sourceSet() : m.admin_plans_sourceDefault()}
              </span>
            </Button>
            <Select
              size="sm"
              aria-label={m.admin_plans_planFor({ org: org.name })}
              disabled={planOverlay.isPending(org.id)}
              value={planOverlay.get(org.id, org.plan)}
              options={data.plans.map((p) => ({ value: p.key, label: planLabel(p.key) }))}
              onchange={(v) => setPlan(org.id, String(v))}
            />
          </li>
        {/each}
      </ul>

      {#if selected}
        <section class="panel" aria-labelledby="effective-title">
          <h2 id="effective-title" class="t-heading">
            {m.admin_plans_effective({ org: selected.name })}
          </h2>
          <table class="panel-table text-sm">
            <thead>
              <tr>
                <th>{m.admin_plans_feature()}</th>
                <th>{m.admin_plans_allowed()}</th>
                <th>{m.admin_plans_reason()}</th>
              </tr>
            </thead>
            <tbody>
              {#each selected.effective as f (f.key)}
                <tr>
                  <td>{featureLabel(f.key, f.label)} <span class="font-mono text-xs text-muted">{f.key}</span></td>
                  <td>{f.allowed ? m.admin_plans_yes() : m.admin_plans_no()}</td>
                  <td class="text-muted">{reasonLabel(f.reason)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </section>
      {/if}

      <section class="panel" aria-labelledby="events-title">
        <h2 id="events-title" class="t-heading">{m.admin_plans_events()}</h2>
        {#if data.events.length === 0}
          <p class="text-sm text-muted">{m.admin_plans_noEvents()}</p>
        {:else}
          <ul class="event-list">
            {#each data.events as e (e.id)}
              <li class="text-sm">
                <span class="font-medium text-foreground">{e.orgName}</span>
                {e.fromPlan ? planLabel(e.fromPlan) : '—'} → {planLabel(e.toPlan)}
                <span class="text-muted">
                  · {e.byUser ? m.admin_plans_byAdmin() : m.admin_plans_bySystem()} · {when(e.createdAt)}
                  {#if e.note}· {e.note}{/if}
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    </AsyncBoundary>
  </PageBody>
</PageShell>

<style>
  .plan-list,
  .event-list {
    display: grid;
    gap: var(--space-2, 8px);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .plan-row {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: var(--space-3, 12px);
    padding: var(--space-3, 12px) var(--space-4, 16px);
    border: 1px solid var(--color-border-subtle, var(--hairline));
    border-radius: var(--radius-lg);
    background: var(--color-surface-2, var(--elevation-2-bg));
  }
  .plan-row.is-selected {
    border-color: var(--color-accent);
  }
  :global(.plan-org) {
    min-width: 0;
    flex: 1;
    justify-content: flex-start;
    text-align: left;
  }
  .panel {
    margin-top: var(--space-6, 24px);
    display: grid;
    gap: var(--space-3, 12px);
  }
  .panel-table {
    width: 100%;
    border-collapse: collapse;
  }
  .panel-table th,
  .panel-table td {
    padding: var(--space-2, 8px);
    text-align: left;
    border-bottom: 1px solid var(--color-border-subtle, var(--hairline));
  }
</style>
