<script lang="ts">
  import type { PageData } from './$types';
  import { invalidate } from '$app/navigation';
  import { PageHeader, Button, Badge, Select, Tabs } from '$lib/components/ui';
  import { AsyncBoundary, PageBody, PageShell } from '$lib/components/ui/foundations';
  import type { TabItem } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { jsonMutation, mutationErrorMessage } from '$lib/api/json-mutation';

  let { data }: { data: PageData } = $props();

  let tab = $state('members');
  const tabs: TabItem[] = $derived([
    { value: 'members', label: 'Members', count: data.members.length },
    ...(data.isAdmin ? [{ value: 'plans', label: 'Plans', count: data.plans.length }] : []),
  ]);

  function planName(id: string) {
    return data.plans.find((p) => p.id === id)?.name ?? id;
  }
  function fmtDate(s: string | Date | null) {
    return s ? new Date(s).toLocaleDateString() : '—';
  }

  // ── New membership ────────────────────────────────────────────────────────────
  let newPlanId = $state('');
  let newCustomer = $state('');
  let busy = $state(false);
  let mutationError = $state<string | null>(null);

  async function createMembership() {
    if (!newPlanId) return;
    busy = true;
    mutationError = null;
    try {
      await jsonMutation({
        input: '/api/memberships',
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ planId: newPlanId, customerName: newCustomer.trim() || null }),
        },
        onSuccess: async () => {
          newCustomer = '';
          await invalidate('memberships:list');
        },
      });
    } catch (error) {
      mutationError = mutationErrorMessage(error, m.common_error());
    } finally {
      busy = false;
    }
  }

  async function setStatus(id: string, status: string) {
    mutationError = null;
    try {
      await jsonMutation({
        input: `/api/memberships/${id}`,
        init: {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status }),
        },
        onSuccess: () => invalidate('memberships:list'),
      });
    } catch (error) {
      mutationError = mutationErrorMessage(error, m.common_error());
    }
  }

  // ── New plan (admin) ────────────────────────────────────────────────────────────
  let pName = $state('');
  let pPrice = $state('');
  let pCurrency = $state('PEN');
  let pUnit = $state('month');
  let pCount = $state(1);

  async function createPlan() {
    if (!pName.trim()) return;
    busy = true;
    mutationError = null;
    try {
      await jsonMutation({
        input: '/api/memberships/plans',
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: pName.trim(),
            price: pPrice ? Number(pPrice) : null,
            currency: pCurrency || null,
            intervalUnit: pUnit,
            intervalCount: Number(pCount) || 1,
          }),
        },
        onSuccess: async () => {
          pName = '';
          pPrice = '';
          await invalidate('memberships:list');
        },
      });
    } catch (error) {
      mutationError = mutationErrorMessage(error, m.common_error());
    } finally {
      busy = false;
    }
  }

  async function togglePlan(id: string, enabled: boolean) {
    mutationError = null;
    try {
      await jsonMutation({
        input: `/api/memberships/plans/${id}`,
        init: {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabled }),
        },
        onSuccess: () => invalidate('memberships:list'),
      });
    } catch (error) {
      mutationError = mutationErrorMessage(error, m.common_error());
    }
  }
</script>

<PageShell archetype="collection" scroll="page" labelledBy="memberships-title">
  <PageHeader
    titleId="memberships-title"
    title="Memberships"
    subtitle="Recurring plans — each cycle spawns a draft sales order for billing"
  />

  <PageBody padding="compact">
    <Tabs id="memberships-tabs" aria-label={m.a11y_tabs_memberships()} {tabs} bind:value={tab} />

    {#if mutationError}
      <p
        class="mx-[var(--space-page-gutter,16px)] mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        role="alert"
      >
        {mutationError}
      </p>
    {/if}

    <div
      id={`memberships-tabs-panel-${tab}`}
      role="tabpanel"
      aria-labelledby={`memberships-tabs-tab-${tab}`}
    >
      {#if tab === 'members'}
        <div class="stack">
          {#if data.plans.length}
            <div class="card row new">
              <Select size="sm" bind:value={newPlanId}>
                <option value="">Choose plan…</option>
                {#each data.plans as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
              </Select>
              <input class="inp" placeholder="Customer name" bind:value={newCustomer} />
              <Button onclick={createMembership} disabled={busy || !newPlanId}>Add member</Button>
            </div>
          {/if}

          {#if data.members.length === 0}
            <AsyncBoundary
              state={{
                kind: 'empty',
                title: 'No memberships yet',
                description: 'Create a plan, then enroll members.',
              }}
              compact
            />
          {:else}
            {#each data.members as m (m.id)}
              <div class="card row">
                <strong>{m.customerName ?? 'Member'}</strong>
                <Badge>{planName(m.planId)}</Badge>
                <span class="muted">{m.status}</span>
                <span class="muted small"
                  >next: {fmtDate(m.nextCycleDate)} · {m.cycleNo} cycles</span
                >
                <div class="spacer"></div>
                {#if m.status === 'active'}
                  <Button size="sm" variant="secondary" onclick={() => setStatus(m.id, 'paused')}
                    >Pause</Button
                  >
                  <Button size="sm" variant="danger" onclick={() => setStatus(m.id, 'cancelled')}
                    >Cancel</Button
                  >
                {:else if m.status === 'paused'}
                  <Button size="sm" variant="secondary" onclick={() => setStatus(m.id, 'active')}
                    >Resume</Button
                  >
                {/if}
              </div>
            {/each}
          {/if}
        </div>
      {:else if tab === 'plans'}
        <div class="stack">
          <div class="card new-plan">
            <h3>New plan</h3>
            <div class="grid">
              <label>Name<input class="inp" bind:value={pName} /></label>
              <label>Price<input class="inp" type="number" bind:value={pPrice} /></label>
              <label>Currency<input class="inp" bind:value={pCurrency} /></label>
              <label
                >Every
                <div class="every">
                  <input class="inp narrow" type="number" min="1" bind:value={pCount} />
                  <Select size="sm" bind:value={pUnit}>
                    <option value="day">day(s)</option>
                    <option value="week">week(s)</option>
                    <option value="month">month(s)</option>
                    <option value="year">year(s)</option>
                  </Select>
                </div>
              </label>
            </div>
            <Button onclick={createPlan} disabled={busy || !pName.trim()}>Create plan</Button>
          </div>

          {#each data.plans as p (p.id)}
            <div class="card row">
              <strong>{p.name}</strong>
              <span class="muted"
                >{p.price ?? '—'}
                {p.currency ?? ''} · every {p.intervalCount}
                {p.intervalUnit}</span
              >
              {#if !p.enabled}<Badge>disabled</Badge>{/if}
              <div class="spacer"></div>
              <Button size="sm" variant="secondary" onclick={() => togglePlan(p.id, !p.enabled)}
                >{p.enabled ? 'Disable' : 'Enable'}</Button
              >
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </PageBody>
</PageShell>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
    padding: var(--space-4, 16px) var(--space-page-gutter, var(--space-4, 16px)) 0;
  }
  .card {
    padding: var(--space-3, 12px) var(--space-4, 16px);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    background: var(--color-bg2);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3, 12px);
  }
  .new {
    flex-wrap: wrap;
  }
  .spacer {
    flex: 1;
  }
  .muted {
    opacity: 0.7;
    font-size: var(--font-size-body, 14px);
  }
  .small {
    font-size: var(--font-size-body, 14px);
  }
  .new-plan h3 {
    margin: 0 0 var(--space-3, 12px);
    font-size: var(--font-size-page-title, 18px);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-3, 12px);
    margin-bottom: var(--space-3, 12px);
  }
  .grid label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 4px);
    font-size: var(--font-size-body, 14px);
    opacity: 0.9;
  }
  .every {
    display: flex;
    gap: var(--space-2, 8px);
  }
  .inp {
    padding: var(--space-2, 8px) var(--space-2, 8px);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    background: var(--color-bg3);
    color: inherit;
    font-size: var(--font-size-body, 14px);
  }
  .narrow {
    width: 4rem;
  }
  @media (max-width: 767.98px) {
    .row:not(.new) {
      align-items: flex-start;
      flex-wrap: wrap;
    }
    .row:not(.new) .spacer {
      display: none;
    }
    .row:not(.new) strong {
      width: 100%;
    }
    .new {
      align-items: stretch;
      flex-direction: column;
    }
    .new .inp {
      width: 100%;
      min-height: var(--control-height-touch, 44px);
    }
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .every {
      align-items: stretch;
      flex-direction: column;
    }
    .narrow {
      width: 100%;
    }
  }
  @media (min-width: 768px) and (max-width: 1279.98px) {
    .grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
