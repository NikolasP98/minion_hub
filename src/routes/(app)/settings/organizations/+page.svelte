<script lang="ts">
  import { Building2, CheckCircle2, RotateCcw } from 'lucide-svelte';
  import { Button, Card, Input, PageHeader, Spinner, StatusDot, iconSizes } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';

  type ProvisionStep = {
    id: string;
    status: 'complete' | 'failed' | 'skipped';
    durationMs: number;
    detail: string;
  };
  type ProvisionResult = {
    ok: boolean;
    organization: { id: string; name: string; slug: string } | null;
    steps: ProvisionStep[];
    startedAt: string;
    completedAt: string;
  };

  const { data } = $props();
  // Seeded once from the load, then appended to optimistically after a provision.
  // svelte-ignore state_referenced_locally
  let organizations = $state(data.organizations);
  let name = $state('');
  let existingWorkforceCompanyId = $state('');
  let submitting = $state(false);
  let result = $state<ProvisionResult | null>(null);
  let requestError = $state<string | null>(null);

  const stepLabels: Record<string, string> = {
    organization: m.orgProvision_stepOrganization(),
    membership: m.orgProvision_stepMembership(),
    rbac: m.orgProvision_stepRbac(),
    workforce: m.orgProvision_stepWorkforce(),
    gateway: m.orgProvision_stepGateway(),
    workstation: m.orgProvision_stepWorkstation(),
    readiness: m.orgProvision_stepReadiness(),
  };

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!name.trim() || submitting) return;
    submitting = true;
    requestError = null;
    result = null;
    try {
      const response = await fetch('/api/organizations/provision', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          existingWorkforceCompanyId: existingWorkforceCompanyId.trim() || undefined,
        }),
      });
      const payload = (await response.json()) as ProvisionResult & { message?: string };
      if (!payload.steps) throw new Error(payload.message ?? m.orgProvision_unknownError());
      result = payload;
      if (payload.organization && !organizations.some((org) => org.id === payload.organization?.id)) {
        organizations = [...organizations, { ...payload.organization, members: 1 }].sort((a, b) =>
          a.name.localeCompare(b.name),
        );
      }
    } catch (error) {
      requestError = error instanceof Error ? error.message : m.orgProvision_unknownError();
    } finally {
      submitting = false;
    }
  }
</script>

<PageShell archetype="form" scroll="page" labelledBy="organization-provision-title">
  <PageHeader
    titleId="organization-provision-title"
    title={m.orgProvision_title()}
    subtitle={m.orgProvision_subtitle()}
  >
    {#snippet leading()}<Building2 size={iconSizes.md} class="shrink-0 text-accent" />{/snippet}
  </PageHeader>

  <PageBody width="content">
    <div class="provision-grid">
      <Card elevation={2} padding="lg">
        <form class="provision-form" onsubmit={submit}>
          <div>
            <h2 class="t-title">{m.orgProvision_formTitle()}</h2>
            <p class="t-body form-copy">{m.orgProvision_formDescription()}</p>
          </div>
          <Input
            id="organization-name"
            label={m.orgProvision_nameLabel()}
            placeholder={m.orgProvision_namePlaceholder()}
            bind:value={name}
            required
            maxlength={80}
            autocomplete="organization"
            disabled={submitting}
          />
          <Input
            id="workforce-company-id"
            label={m.orgProvision_workforceIdLabel()}
            helper={m.orgProvision_workforceIdHelper()}
            placeholder="00000000-0000-0000-0000-000000000000"
            bind:value={existingWorkforceCompanyId}
            disabled={submitting}
          />
          {#if requestError}<p class="error-message" role="alert">{requestError}</p>{/if}
          <Button type="submit" variant="primary" disabled={submitting || !name.trim()}>
            {#if submitting}
              <Spinner size="xs" />
              {m.orgProvision_running()}
            {:else if result && !result.ok}
              <RotateCcw size={iconSizes.sm} />
              {m.orgProvision_retry()}
            {:else}
              <Building2 size={iconSizes.sm} />
              {m.orgProvision_action()}
            {/if}
          </Button>
        </form>
      </Card>

      <Card elevation={2} padding="lg">
        <div class="trace-header">
          <div>
            <h2 class="t-title">{m.orgProvision_traceTitle()}</h2>
            <p class="t-body form-copy">{m.orgProvision_traceDescription()}</p>
          </div>
          {#if result?.ok}<CheckCircle2 size={iconSizes.lg} class="success-icon" aria-hidden="true" />{/if}
        </div>
        {#if result}
          <ol class="trace-list" aria-label={m.orgProvision_traceTitle()}>
            {#each result.steps as step (step.id)}
              <li class="trace-step">
                <StatusDot
                  status={step.status === 'complete' ? 'running' : step.status === 'failed' ? 'aborted' : 'idle'}
                  size="sm"
                />
                <span class="trace-copy">
                  <strong class="t-label">{stepLabels[step.id] ?? step.id}</strong>
                  <span class="t-caption">{step.detail}</span>
                </span>
                <span class="t-mono trace-time">{step.durationMs} ms</span>
              </li>
            {/each}
          </ol>
        {:else}
          <p class="empty-trace t-body">{m.orgProvision_traceEmpty()}</p>
        {/if}
      </Card>
    </div>

    <Card elevation={1} padding="lg">
      <h2 class="t-title">{m.orgProvision_existingTitle()}</h2>
      <ul class="organization-list" aria-label={m.orgProvision_existingTitle()}>
        {#each organizations as organization (organization.id)}
          <li>
            <span class="t-label">{organization.name}</span>
            <span class="t-caption">{organization.slug} · {organization.members}</span>
          </li>
        {/each}
      </ul>
    </Card>
  </PageBody>
</PageShell>

<style>
  .provision-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-card);
    margin-bottom: var(--space-section);
  }
  .provision-form {
    display: grid;
    gap: var(--space-field-gap);
  }
  .form-copy,
  .empty-trace,
  .trace-step .t-caption,
  .organization-list .t-caption {
    color: var(--color-text-secondary);
  }
  .trace-header,
  .trace-step,
  .organization-list li {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .trace-header {
    justify-content: space-between;
    margin-bottom: var(--space-4);
  }
  /* `class` forwarded to a component never matches a plain scoped selector — it
     compiles and ships dead. Anchor on the scoped ancestor + :global. */
  .trace-header :global(.success-icon) {
    color: var(--color-success-fg);
  }
  .trace-list,
  .organization-list {
    display: grid;
    gap: var(--space-2);
    padding: 0;
    margin: 0;
    list-style: none;
  }
  .trace-step,
  .organization-list li {
    padding: var(--space-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
  }
  .trace-copy {
    display: grid;
    min-width: 0;
    flex: 1;
  }
  .trace-time {
    color: var(--color-text-tertiary);
  }
  .empty-trace {
    padding: var(--space-8) var(--space-4);
    text-align: center;
  }
  .error-message {
    padding: var(--space-3);
    border: 1px solid var(--color-danger-border);
    border-radius: var(--radius-md);
    color: var(--color-danger-fg);
    background: var(--color-danger-surface);
  }
  .organization-list {
    margin-top: var(--space-4);
  }
  .organization-list li {
    justify-content: space-between;
  }
  @media (max-width: 48rem) {
    .provision-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
